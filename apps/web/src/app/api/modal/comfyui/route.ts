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
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { getComfyUserDataPath, getComfyUIPath } from "@/lib/providerSettings";

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

const log = (...args: unknown[]) => console.log("[modal-comfyui]", ...args);
const logError = (...args: unknown[]) =>
  console.error("[modal-comfyui]", ...args);

export async function GET(req: NextRequest) {
  const user = getRequestUser(req);
  if (!user) {
    log("GET — unauthorized (no session)");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const instances = getModalComfyInstances();
  log(
    `GET — returning ${instances.length} instance(s):`,
    instances.map((i) => `${i.id}(${i.status})`).join(", ") || "(none)",
  );
  return NextResponse.json({ instances });
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export async function POST(req: NextRequest) {
  const user = getRequestUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;
  log(`POST — action="${action}"`, JSON.stringify(body));

  if (action === "deploy") {
    const { gpu, name } = body as { gpu: string; name: string };
    log(`DEPLOY — name="${name}" gpu="${gpu}"`);

    if (!gpu || !validateGpuTier(gpu)) {
      log(`DEPLOY — rejected: invalid GPU tier "${gpu}"`);
      return NextResponse.json({ error: "Invalid GPU tier" }, { status: 400 });
    }
    if (!name || !NAME_RE.test(name)) {
      log(`DEPLOY — rejected: invalid name "${name}" (must match ${NAME_RE})`);
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    const existing = getModalComfyInstances();
    log(
      `DEPLOY — existing instances: [${existing.map((i) => i.id).join(", ")}]`,
    );
    if (existing.some((i) => i.name === name)) {
      log(`DEPLOY — rejected: name "${name}" already exists`);
      return NextResponse.json(
        { error: "Name already exists" },
        { status: 409 },
      );
    }
    if (isModalComfyDeploying()) {
      log("DEPLOY — rejected: another deployment already in progress");
      return NextResponse.json(
        { error: "Another deployment in progress" },
        { status: 409 },
      );
    }

    const virtualPort = allocateVirtualPort();
    const appName = `flowscale-${name}`;
    log(`DEPLOY — allocated virtualPort=${virtualPort}, appName="${appName}"`);

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
    log(`DEPLOY — instance record created, starting background deploy...`);

    // Fire and forget — scan local ComfyUI, generate config, deploy via helper
    const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
    const comfyuiPath = getComfyUserDataPath();
    const pythonCmd = getPythonCommand();

    (async () => {
      try {
        // Step 1: Scan local ComfyUI for custom nodes
        log(
          `DEPLOY[${name}] — Step 1: scanning local ComfyUI at "${comfyuiPath}"...`,
        );
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
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.on("close", (code) => {
            log(
              `DEPLOY[${name}] — scan-comfyui exited code=${code}, stdout length=${out.length}`,
            );
            resolve(out.trim());
          });
          proc.on("error", (err) => {
            logError(`DEPLOY[${name}] — scan-comfyui spawn error:`, err);
            reject(err);
          });
        });

        log(
          `DEPLOY[${name}] — parsing scan result (first 200 chars): ${scanResult.slice(0, 200)}`,
        );
        const scanData = JSON.parse(scanResult);
        log(
          `DEPLOY[${name}] — scan found ${scanData.customNodes?.length ?? 0} custom nodes, ${scanData.models?.length ?? 0} models`,
        );

        // Step 2: Write config to temp file (too large for CLI args)
        const configFile = join(
          tmpdir(),
          `flowscale-comfyui-config-${Date.now()}.json`,
        );
        writeFileSync(configFile, JSON.stringify(scanData), "utf-8");
        log(
          `DEPLOY[${name}] — Step 2: deploying via modal-helper deploy-comfyui, configFile="${configFile}"`,
        );

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
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.on("close", (code) => {
            log(
              `DEPLOY[${name}] — deploy-comfyui exited code=${code}, stdout length=${out.length}`,
            );
            resolve(out.trim());
          });
          proc.on("error", (err) => {
            logError(`DEPLOY[${name}] — deploy-comfyui spawn error:`, err);
            reject(err);
          });
        });

        log(
          `DEPLOY[${name}] — parsing deploy result (first 300 chars): ${deployResult.slice(0, 300)}`,
        );
        const result = JSON.parse(deployResult);
        if (result.success) {
          log(
            `DEPLOY[${name}] — SUCCESS — url="${result.url}", updating instance to deployed`,
          );
          updateModalComfyInstance(name, {
            status: "deployed",
            url: result.url || "",
          });
        } else {
          logError(`DEPLOY[${name}] — FAILED — error="${result.error}"`);
          updateModalComfyInstance(name, {
            status: "error",
            errorMessage: result.error || "Deploy failed",
          });
        }
      } catch (err) {
        logError(`DEPLOY[${name}] — EXCEPTION:`, err);
        updateModalComfyInstance(name, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    log(`DEPLOY — returning 202 (background deploy started)`);
    return NextResponse.json(
      { status: "deploying", name, gpu, virtualPort },
      { status: 202 },
    );
  }

  if (action === "resync") {
    const { instanceId } = body as { instanceId: string };
    log(`RESYNC — instanceId="${instanceId}"`);
    if (!instanceId)
      return NextResponse.json(
        { error: "instanceId required" },
        { status: 400 },
      );

    const instance = getModalComfyById(instanceId);
    if (!instance) {
      log(`RESYNC — instance "${instanceId}" not found in JSON file`);
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );
    }
    log(
      `RESYNC — found instance: name="${instance.name}", gpu="${instance.gpu}", appName="${instance.appName}"`,
    );

    updateModalComfyInstance(instanceId, {
      status: "deploying",
      errorMessage: undefined,
    });

    const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
    const comfyuiPath = getComfyUserDataPath();
    const pythonCmd = getPythonCommand();

    (async () => {
      try {
        log(`RESYNC[${instanceId}] — Step 1: scanning local ComfyUI...`);
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
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.on("close", (code) => {
            log(`RESYNC[${instanceId}] — scan exited code=${code}`);
            resolve(out.trim());
          });
          proc.on("error", reject);
        });
        const scanData = JSON.parse(scanResult);
        log(
          `RESYNC[${instanceId}] — scan found ${scanData.customNodes?.length ?? 0} custom nodes`,
        );

        const configFile = join(
          tmpdir(),
          `flowscale-comfyui-resync-${Date.now()}.json`,
        );
        writeFileSync(configFile, JSON.stringify(scanData), "utf-8");
        log(`RESYNC[${instanceId}] — Step 2: redeploying via modal-helper...`);

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
          proc.stdout.on("data", (d: Buffer) => {
            out += d.toString();
          });
          proc.on("close", (code) => {
            log(`RESYNC[${instanceId}] — deploy exited code=${code}`);
            resolve(out.trim());
          });
          proc.on("error", reject);
        });

        log(
          `RESYNC[${instanceId}] — parsing deploy result (first 300 chars): ${deployResult.slice(0, 300)}`,
        );
        const result = JSON.parse(deployResult);
        if (result.success) {
          log(`RESYNC[${instanceId}] — SUCCESS — url="${result.url}"`);
          updateModalComfyInstance(instanceId, {
            status: "deployed",
            url: result.url || instance.url,
          });
        } else {
          logError(`RESYNC[${instanceId}] — FAILED — error="${result.error}"`);
          updateModalComfyInstance(instanceId, {
            status: "error",
            errorMessage: result.error || "Resync failed",
          });
        }
      } catch (err) {
        logError(`RESYNC[${instanceId}] — EXCEPTION:`, err);
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
    log(`UNDEPLOY — instanceId="${instanceId}"`);
    if (!instanceId) {
      log("UNDEPLOY — rejected: no instanceId provided");
      return NextResponse.json(
        { error: "instanceId required" },
        { status: 400 },
      );
    }

    const instance = getModalComfyById(instanceId);
    if (!instance) {
      logError(`UNDEPLOY — instance "${instanceId}" NOT FOUND in JSON file`);
      return NextResponse.json(
        { error: "Instance not found" },
        { status: 404 },
      );
    }
    log(
      `UNDEPLOY — found instance: name="${instance.name}", appName="${instance.appName}", status="${instance.status}"`,
    );

    const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
    const pythonCmd = getPythonCommand();
    log(
      `UNDEPLOY — calling modal-helper undeploy for appName="${instance.appName}"...`,
    );
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const proc = spawn(
          pythonCmd,
          [helperScript, "undeploy", instance.appName],
          {
            ...getPythonSpawnOptions(),
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 60_000,
          },
        );
        let stderr = "";
        proc.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        proc.on("close", (code) => {
          log(
            `UNDEPLOY — modal-helper undeploy exited code=${code}${stderr ? `, stderr="${stderr.trim()}"` : ""}`,
          );
          resolve(code);
        });
        proc.on("error", (err) => {
          logError(`UNDEPLOY — modal-helper spawn error:`, err);
          reject(err);
        });
      });
      log(`UNDEPLOY — modal CLI finished with code=${exitCode}`);
    } catch (err) {
      logError(`UNDEPLOY — modal CLI failed (best-effort, continuing):`, err);
    }

    log(`UNDEPLOY — removing instance "${instanceId}" from JSON file`);
    removeModalComfyInstance(instanceId);
    log(`UNDEPLOY — done, returning success`);
    return NextResponse.json({ success: true });
  }

  // ── Download model from URL directly to Modal Volume ──────────────────────
  // ── Add custom node: clone locally + trigger Modal resync ─────────────────
  if (action === "add-custom-node") {
    const { repoUrl, instanceId } = body as { repoUrl: string; instanceId?: string }

    if (!repoUrl) {
      return NextResponse.json(
        { error: "repoUrl is required" },
        { status: 400 },
      )
    }

    // Validate URL
    try {
      const parsed = new URL(repoUrl)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return NextResponse.json(
          { error: "Only http/https URLs are supported" },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
    }

    // Derive node name from repo URL (e.g., "ComfyUI-Impact-Pack" from the URL)
    const cleanUrl = repoUrl.replace(/\.git\/?$/, "").replace(/\/$/, "")
    const nodeName = cleanUrl.split("/").pop()
    if (!nodeName) {
      return NextResponse.json(
        { error: "Could not derive node name from URL" },
        { status: 400 },
      )
    }

    log(`ADD-CUSTOM-NODE — repo="${repoUrl}", nodeName="${nodeName}", instanceId="${instanceId ?? "none"}"`)

    // Step 1: Clone locally into ComfyUI custom_nodes
    const comfyPath = getComfyUIPath()
    if (!comfyPath) {
      return NextResponse.json(
        { error: "ComfyUI path not configured" },
        { status: 400 },
      )
    }

    const customNodesDir = join(comfyPath, "custom_nodes")
    const nodeDir = join(customNodesDir, nodeName)

    if (existsSync(nodeDir)) {
      log(`ADD-CUSTOM-NODE — "${nodeName}" already exists locally, pulling latest`)
      try {
        execFileSync("git", ["pull"], { cwd: nodeDir, stdio: "pipe", timeout: 60_000 })
      } catch (err) {
        log(`ADD-CUSTOM-NODE — git pull failed (non-fatal):`, err)
      }
    } else {
      log(`ADD-CUSTOM-NODE — cloning "${repoUrl}" into ${nodeDir}`)
      try {
        mkdirSync(customNodesDir, { recursive: true })
        execFileSync("git", ["clone", "--depth", "1", cleanUrl, nodeDir], {
          stdio: "pipe",
          timeout: 120_000,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Git clone failed"
        logError(`ADD-CUSTOM-NODE — clone failed:`, err)
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    }

    log(`ADD-CUSTOM-NODE — local clone done`)

    // Step 2: If an instanceId is provided, trigger a resync so Modal picks up the new node
    let resyncTriggered = false
    if (instanceId) {
      const instance = getModalComfyById(instanceId)
      if (instance && instance.status === "deployed") {
        log(`ADD-CUSTOM-NODE — triggering resync for instance "${instanceId}"`)
        // Fire resync in the background (same as the resync action)
        // We don't await this — it runs as a background deployment
        fetch(`http://127.0.0.1:${process.env.PORT ?? 14173}/api/modal/comfyui`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resync", instanceId }),
        }).catch((err) => logError("ADD-CUSTOM-NODE — resync trigger failed:", err))
        resyncTriggered = true
      }
    }

    return NextResponse.json({
      success: true,
      nodeName,
      localPath: nodeDir,
      resyncTriggered,
    })
  }

  if (action === "download-model") {
    const { url: modelUrl, modelType, filename, apiKey } = body as {
      url: string
      modelType: string
      filename: string
      apiKey?: string
    }

    if (!modelUrl || !modelType || !filename) {
      return NextResponse.json(
        { error: "url, modelType, and filename are required" },
        { status: 400 },
      )
    }

    // Basic URL validation
    try {
      const parsed = new URL(modelUrl)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return NextResponse.json(
          { error: "Only http/https URLs are supported" },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
    }

    // Sanitize filename
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    if (!safeName) {
      return NextResponse.json(
        { error: "Invalid filename" },
        { status: 400 },
      )
    }

    log(`DOWNLOAD-MODEL — url="${modelUrl}", type="${modelType}", filename="${safeName}"`)

    const helperScript = join(process.cwd(), "scripts", "modal-helper.py")
    const pythonCmd = getPythonCommand()

    try {
      const result = await new Promise<{ success: boolean; error?: string; remotePath?: string; sizeMB?: number }>(
        (resolve, reject) => {
          const spawnOpts = getPythonSpawnOptions()
          // Pass API key via env var so it doesn't appear in process args
          if (apiKey) {
            spawnOpts.env = { ...spawnOpts.env ?? process.env, FLOWSCALE_MODEL_API_KEY: apiKey }
          }
          const proc = spawn(
            pythonCmd,
            [helperScript, "download-model", modelUrl, modelType, safeName],
            {
              ...spawnOpts,
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 1200_000, // 20 min for large models
            },
          )

          let stdout = ""
          let stderr = ""
          proc.stdout?.on("data", (d: Buffer) => {
            const s = d.toString()
            stdout += s
            log(`DOWNLOAD-MODEL stdout: ${s.trim()}`)
          })
          proc.stderr?.on("data", (d: Buffer) => {
            stderr += d.toString()
          })
          proc.on("close", (code) => {
            log(`DOWNLOAD-MODEL — exited code=${code}`)
            try {
              const json = JSON.parse(extractJson(stdout))
              resolve(json)
            } catch {
              reject(
                new Error(
                  stderr.trim() ||
                    stdout.trim() ||
                    `Process exited with code ${code}`,
                ),
              )
            }
          })
          proc.on("error", reject)
        },
      )

      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? "Download failed" },
          { status: 500 },
        )
      }

      log(`DOWNLOAD-MODEL — success: ${result.remotePath} (${result.sizeMB} MB)`)
      return NextResponse.json({
        success: true,
        remotePath: result.remotePath,
        sizeMB: result.sizeMB,
      })
    } catch (err) {
      logError("DOWNLOAD-MODEL — error:", err)
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Model download failed",
        },
        { status: 500 },
      )
    }
  }

  log(`POST — unknown action="${action}"`);
  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
