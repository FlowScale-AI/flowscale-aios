/**
 * POST /api/comfy/setup/install
 *
 * Body (optional): { targetPath?: string }
 *
 * - If `targetPath` is provided and already contains main.py + pyproject.toml,
 *   we skip clone/venv/pip and just persist the path.  This handles the
 *   macOS/Windows ComfyUI Desktop App whose bundled install is ready to use.
 * - Otherwise clones ComfyUI from GitHub into ~/.flowscale/comfyui, creates a
 *   venv, and installs requirements.
 *
 * Streams progress as SSE (text/event-stream).
 * Each event is JSON: { msg?: string; done?: boolean; error?: string; path?: string }
 */

import { NextResponse } from "next/server";
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import {
  setComfyManagedPath,
  setComfyInstallType,
  setComfyInstances,
  getComfyManagedPort,
  type ComfyInstanceConfig,
} from "@/lib/providerSettings";
import { isValidComfyInstall } from "../utils";
import { detectGpus, clearGpuCache } from "@/lib/gpu-detect";

/** Detect GPU type for PyTorch installation. */
function detectGpuType(): "cuda" | "rocm" | "cpu" {
  // Try NVIDIA
  try {
    execSync("nvidia-smi", { stdio: "ignore", timeout: 5000 });
    return "cuda";
  } catch {
    /* not nvidia */
  }
  // Try AMD ROCm
  try {
    execSync("rocm-smi", { stdio: "ignore", timeout: 5000 });
    return "rocm";
  } catch {
    /* not rocm */
  }
  return "cpu";
}

/** Check if PyTorch is installed in the given venv. */
function isPyTorchInstalled(venvPath: string): boolean {
  const pythonBin =
    process.platform === "win32"
      ? path.join(venvPath, "Scripts", "python.exe")
      : path.join(venvPath, "bin", "python");
  if (!fs.existsSync(pythonBin)) return false;
  try {
    execSync(`"${pythonBin}" -c "import torch"`, {
      stdio: "ignore",
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

const FLOWSCALE_COMFY_PATH = path.join(os.homedir(), ".flowscale", "comfyui");
const COMFYUI_REPO = "https://github.com/comfyanonymous/ComfyUI.git";

function runStreamed(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "pipe",
      env: { ...process.env },
    });

    const onData = (buf: Buffer): void => {
      buf.toString().split("\n").filter(Boolean).forEach(onLine);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`"${cmd} ${args.join(" ")}" exited with code ${code}`),
        );
    });
    child.on("error", reject);
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { targetPath?: string };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>): void => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      try {
        const targetPath = body.targetPath ?? FLOWSCALE_COMFY_PATH;

        // ── Fast path: existing valid ComfyUI installation ─────────────────────
        if (isValidComfyInstall(targetPath)) {
          send({
            msg: `Found existing ComfyUI installation at ${targetPath}.`,
          });

          // Check if PyTorch is missing and install if needed
          const venvPath = path.join(targetPath, "venv");
          if (fs.existsSync(venvPath) && !isPyTorchInstalled(venvPath)) {
            send({
              msg: "PyTorch not installed in existing venv — installing now.",
            });

            const pipBin =
              process.platform === "win32"
                ? path.join(venvPath, "Scripts", "pip.exe")
                : path.join(venvPath, "bin", "pip");

            const gpuType = detectGpuType();
            send({ msg: `Detected GPU type: ${gpuType}` });

            const torchIndexUrl =
              gpuType === "rocm"
                ? "https://download.pytorch.org/whl/rocm6.3"
                : gpuType === "cuda"
                  ? "https://download.pytorch.org/whl/cu124"
                  : "https://download.pytorch.org/whl/cpu";

            send({
              msg: `Installing PyTorch (${gpuType === "cpu" ? "CPU only" : `with ${gpuType.toUpperCase()} support`})…`,
            });
            await runStreamed(
              pipBin,
              [
                "install",
                "torch",
                "torchvision",
                "torchaudio",
                "--index-url",
                torchIndexUrl,
              ],
              targetPath,
              (line) => send({ msg: line }),
            );
            send({ msg: "PyTorch installed." });
          }

          // Auto-detect GPUs and configure instances for existing install
          send({ msg: "Detecting GPUs and configuring instances…" });
          clearGpuCache();
          const existingGpus = detectGpus();
          const existingBasePort = getComfyManagedPort();
          const existingInstances: ComfyInstanceConfig[] = [];

          for (let i = 0; i < existingGpus.length; i++) {
            const gpu = existingGpus[i];
            const devicePrefix = gpu.backend === "rocm" ? "rocm" : "cuda";
            existingInstances.push({
              id: `gpu-${gpu.index}`,
              port: existingBasePort + i,
              device: `${devicePrefix}:${gpu.index}`,
              label: `GPU ${gpu.index} — ${gpu.name}`,
            });
          }
          existingInstances.push({
            id: "cpu",
            port: existingBasePort + existingGpus.length,
            device: "cpu",
            label: "CPU",
          });
          setComfyInstances(existingInstances);
          send({
            msg: `Found ${existingGpus.length} GPU(s). Configured ${existingInstances.length} instance(s).`,
          });

          setComfyManagedPath(targetPath);
          setComfyInstallType(
            targetPath === FLOWSCALE_COMFY_PATH
              ? "flowscale-managed"
              : "desktop-app",
          );
          send({ msg: "ComfyUI ready.", done: true, path: targetPath });
          return;
        }

        // ── Full install: clone → venv → pip ───────────────────────────────────
        const installPath = FLOWSCALE_COMFY_PATH; // always install into .flowscale

        // Step 1: Clone
        if (fs.existsSync(installPath) && isValidComfyInstall(installPath)) {
          send({
            msg: `Directory already exists at ${installPath} — skipping clone.`,
          });
        } else {
          send({ msg: "Cloning ComfyUI from GitHub…" });
          fs.mkdirSync(path.dirname(installPath), { recursive: true });
          await runStreamed(
            "git",
            ["clone", "--depth", "1", COMFYUI_REPO, installPath],
            os.homedir(),
            (line) => send({ msg: line }),
          );
          send({ msg: "Clone complete." });
        }

        // Step 2: Create venv
        const venvPath = path.join(installPath, "venv");
        if (fs.existsSync(venvPath)) {
          send({ msg: "Virtual environment already exists — skipping." });
        } else {
          send({ msg: "Creating Python virtual environment…" });
          const pythonBin = process.platform === "win32" ? "python" : "python3";
          await runStreamed(
            pythonBin,
            ["-m", "venv", venvPath],
            installPath,
            (line) => send({ msg: line }),
          );
          send({ msg: "Virtual environment created." });
        }

        // Step 3: Install PyTorch with GPU support (if not already installed)
        const pipBin =
          process.platform === "win32"
            ? path.join(venvPath, "Scripts", "pip.exe")
            : path.join(venvPath, "bin", "pip");

        const gpuType = detectGpuType();
        send({ msg: `Detected GPU type: ${gpuType}` });

        // Check if PyTorch is already installed
        if (isPyTorchInstalled(venvPath)) {
          send({ msg: "PyTorch already installed — skipping." });
        } else {
          const torchIndexUrl =
            gpuType === "rocm"
              ? "https://download.pytorch.org/whl/rocm6.3"
              : gpuType === "cuda"
                ? "https://download.pytorch.org/whl/cu124"
                : "https://download.pytorch.org/whl/cpu";

          send({
            msg: `Installing PyTorch (${gpuType === "cpu" ? "CPU only" : `with ${gpuType.toUpperCase()} support`})…`,
          });
          await runStreamed(
            pipBin,
            [
              "install",
              "torch",
              "torchvision",
              "torchaudio",
              "--index-url",
              torchIndexUrl,
            ],
            installPath,
            (line) => send({ msg: line }),
          );
          send({ msg: "PyTorch installed." });
        }

        // Step 4: Install requirements

        send({
          msg: "Installing Python dependencies (this may take a few minutes)…",
        });
        await runStreamed(
          pipBin,
          ["install", "-r", path.join(installPath, "requirements.txt")],
          installPath,
          (line) => send({ msg: line }),
        );
        send({ msg: "Dependencies installed." });

        // Step 5: Auto-detect GPUs and configure instances
        send({ msg: "Detecting GPUs and configuring instances…" });
        clearGpuCache();
        const gpus = detectGpus();
        const basePort = getComfyManagedPort();
        const instances: ComfyInstanceConfig[] = [];

        for (let i = 0; i < gpus.length; i++) {
          const gpu = gpus[i];
          const devicePrefix = gpu.backend === "rocm" ? "rocm" : "cuda";
          instances.push({
            id: `gpu-${gpu.index}`,
            port: basePort + i,
            device: `${devicePrefix}:${gpu.index}`,
            label: `GPU ${gpu.index} — ${gpu.name}`,
          });
        }
        // Always add a CPU instance
        instances.push({
          id: "cpu",
          port: basePort + gpus.length,
          device: "cpu",
          label: "CPU",
        });
        setComfyInstances(instances);
        send({
          msg: `Found ${gpus.length} GPU(s). Configured ${instances.length} instance(s).`,
        });

        setComfyManagedPath(installPath);
        setComfyInstallType("flowscale-managed");
        send({
          msg: "ComfyUI installation complete!",
          done: true,
          path: installPath,
        });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
