import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import {
  getModalComfyInstances,
  getModalComfyById,
  addModalComfyInstance,
  removeModalComfyInstance,
  updateModalComfyInstance,
  allocateVirtualPort,
  isModalComfyDeploying,
} from "@/lib/modal-comfyui";
import { validateGpuTier } from "@/lib/modal-deploy";
import { getPythonCommand, getPythonSpawnOptions } from "@/lib/modal-manager";
import { spawn } from "child_process";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { getComfyUIPath } from "@/lib/providerSettings";

/**
 * Extract the last JSON object/array from a multi-line string.
 * The Python helper outputs a single JSON line to stdout, but stray warnings
 * or progress messages may appear before it. We take the last line that
 * starts with `{` or `[` so we always parse the intended payload.
 */
function extractJson(raw: string): string {
  const lines = raw.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith("{") || l.startsWith("[")) return l;
  }
  return raw.trim(); // fallback — let JSON.parse show the real error
}

export async function GET(req: NextRequest) {
  const user = getRequestUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const instances = getModalComfyInstances();
  return NextResponse.json({ instances });
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export async function POST(req: NextRequest) {
  const user = getRequestUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  if (action === "deploy") {
    const { gpu, name } = body as { gpu: string; name: string };

    if (!gpu || !validateGpuTier(gpu)) {
      return NextResponse.json({ error: "Invalid GPU tier" }, { status: 400 });
    }
    if (!name || !NAME_RE.test(name)) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    const existing = getModalComfyInstances();
    if (existing.some((i) => i.name === name)) {
      return NextResponse.json(
        { error: "Name already exists" },
        { status: 409 },
      );
    }
    if (isModalComfyDeploying()) {
      return NextResponse.json(
        { error: "Another deployment in progress" },
        { status: 409 },
      );
    }

    const virtualPort = allocateVirtualPort();
    const appName = `flowscale-${name}`;

    addModalComfyInstance({
      id: name,
      name,
      status: "deploying",
      gpu,
      virtualPort,
      appName,
      url: "",
      deployedAt: Date.now(),
    });

    // Fire and forget — scan local ComfyUI, generate config, deploy via helper
    const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
    const comfyuiPath = getComfyUIPath();
    const pythonCmd = getPythonCommand();

    (async () => {
      try {
        // Step 1: Scan local ComfyUI for custom nodes
        const scanResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn(
            pythonCmd,
            [helperScript, "scan-comfyui", comfyuiPath || ""],
            {
              ...getPythonSpawnOptions(),
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 30_000,
            },
          );
          let out = "";
          let err = "";
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.stderr.on("data", (d: Buffer) => {
            err += d.toString();
          });
          proc.on("close", (code) => {
            if (code !== 0 || !out.trim()) {
              reject(
                new Error(
                  err.trim() || `scan-comfyui exited with code ${code}`,
                ),
              );
            } else {
              resolve(out.trim());
            }
          });
          proc.on("error", reject);
        });

        const scanData = JSON.parse(extractJson(scanResult));

        // Step 2: Write config to temp file (too large for CLI args)
        const configFile = join(
          tmpdir(),
          `flowscale-comfyui-config-${Date.now()}.json`,
        );
        writeFileSync(configFile, JSON.stringify(scanData), "utf-8");

        const deployResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn(
            pythonCmd,
            [helperScript, "deploy-comfyui", configFile, gpu, appName],
            {
              ...getPythonSpawnOptions(),
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 660_000,
            },
          );
          let out = "";
          let err = "";
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.stderr.on("data", (d: Buffer) => {
            err += d.toString();
          });
          proc.on("close", (code) => {
            if (code !== 0 || !out.trim()) {
              reject(
                new Error(
                  err.trim() || `deploy-comfyui exited with code ${code}`,
                ),
              );
            } else {
              resolve(out.trim());
            }
          });
          proc.on("error", reject);
        });

        const result = JSON.parse(extractJson(deployResult));
        if (result.success) {
          updateModalComfyInstance(name, {
            status: "deployed",
            url: result.url || "",
          });
        } else {
          updateModalComfyInstance(name, {
            status: "error",
            errorMessage: result.error || "Deploy failed",
          });
        }
      } catch (err) {
        console.error(`Modal ComfyUI deploy failed for ${name}:`, err);
        updateModalComfyInstance(name, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return NextResponse.json(
      { status: "deploying", name, gpu, virtualPort },
      { status: 202 },
    );
  }

  if (action === "resync") {
    // Re-scan local ComfyUI, rebuild image with updated custom nodes, re-sync models
    const { instanceId } = body as { instanceId: string };
    if (!instanceId)
      return NextResponse.json(
        { error: "instanceId required" },
        { status: 400 },
      );

    const instance = getModalComfyById(instanceId);
    if (!instance)
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );

    // Mark as deploying (redeploying)
    updateModalComfyInstance(instanceId, {
      status: "deploying",
      errorMessage: undefined,
    });

    const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
    const comfyuiPath = getComfyUIPath();
    const pythonCmd = getPythonCommand();

    (async () => {
      try {
        // Step 1: Scan
        const scanResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn(
            pythonCmd,
            [helperScript, "scan-comfyui", comfyuiPath || ""],
            {
              ...getPythonSpawnOptions(),
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 30_000,
            },
          );
          let out = "";
          let err = "";
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.stderr.on("data", (d: Buffer) => {
            err += d.toString();
          });
          proc.on("close", (code) => {
            if (code !== 0 || !out.trim()) {
              reject(
                new Error(
                  err.trim() || `scan-comfyui exited with code ${code}`,
                ),
              );
            } else {
              resolve(out.trim());
            }
          });
          proc.on("error", reject);
        });
        const scanData = JSON.parse(extractJson(scanResult));

        // Step 2: Write config to temp file and redeploy
        const configFile = join(
          tmpdir(),
          `flowscale-comfyui-resync-${Date.now()}.json`,
        );
        writeFileSync(configFile, JSON.stringify(scanData), "utf-8");

        const deployResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn(
            pythonCmd,
            [
              helperScript,
              "deploy-comfyui",
              configFile,
              instance.gpu,
              instance.appName,
            ],
            {
              ...getPythonSpawnOptions(),
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 660_000,
            },
          );
          let out = "";
          let err = "";
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.stderr.on("data", (d: Buffer) => {
            err += d.toString();
          });
          proc.on("close", (code) => {
            if (code !== 0 || !out.trim()) {
              reject(
                new Error(
                  err.trim() || `deploy-comfyui exited with code ${code}`,
                ),
              );
            } else {
              resolve(out.trim());
            }
          });
          proc.on("error", reject);
        });

        const result = JSON.parse(extractJson(deployResult));
        if (result.success) {
          updateModalComfyInstance(instanceId, {
            status: "deployed",
            url: result.url || instance.url,
          });
        } else {
          updateModalComfyInstance(instanceId, {
            status: "error",
            errorMessage: result.error || "Resync failed",
          });
        }
      } catch (err) {
        console.error(`Modal ComfyUI resync failed for ${instanceId}:`, err);
        updateModalComfyInstance(instanceId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return NextResponse.json(
      { status: "resyncing", instanceId },
      { status: 202 },
    );
  }

  if (action === "undeploy") {
    const { instanceId } = body as { instanceId: string };
    if (!instanceId)
      return NextResponse.json(
        { error: "instanceId required" },
        { status: 400 },
      );

    const instance = getModalComfyById(instanceId);
    if (!instance)
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );

    // Call modal helper to undeploy, then remove record
    const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
    const pythonCmd = getPythonCommand();
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          pythonCmd,
          [helperScript, "undeploy", instance.appName],
          {
            ...getPythonSpawnOptions(),
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 60_000,
          },
        );
        proc.on("close", () => resolve());
        proc.on("error", reject);
      });
    } catch {
      /* best effort */
    }
    removeModalComfyInstance(instanceId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
