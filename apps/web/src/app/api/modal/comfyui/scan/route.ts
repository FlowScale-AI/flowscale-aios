import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getPythonCommand, getPythonSpawnOptions } from "@/lib/modal-manager";
import { spawn } from "child_process";
import { join } from "path";
import { getComfyUserDataPath } from "@/lib/providerSettings";

export async function GET(req: NextRequest) {
  const user = getRequestUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const comfyuiPath = getComfyUserDataPath();
  if (!comfyuiPath)
    return NextResponse.json(
      { error: "ComfyUI path not configured" },
      { status: 400 },
    );

  // Call modal-helper.py scan-comfyui
  const helperScript = join(process.cwd(), "scripts", "modal-helper.py");
  const pythonCmd = getPythonCommand();

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn(pythonCmd, [helperScript, "scan-comfyui", comfyuiPath], {
      ...getPythonSpawnOptions(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve(
          NextResponse.json(
            { error: stderr.trim() || `scan-comfyui exited with code ${code}` },
            { status: 500 },
          ),
        );
        return;
      }
      try {
        resolve(NextResponse.json(JSON.parse(stdout.trim())));
      } catch {
        resolve(
          NextResponse.json(
            { error: stderr.trim() || "Failed to parse scan result" },
            { status: 500 },
          ),
        );
      }
    });
    proc.on("error", (err) => {
      resolve(
        NextResponse.json(
          { error: err.message || "Failed to run scanner" },
          { status: 500 },
        ),
      );
    });
  });
}
