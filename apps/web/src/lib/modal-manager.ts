/**
 * Modal CLI wrapper for install, auth, and status management.
 *
 * Follows the same patterns as comfyui-manager.ts — uses child_process
 * for CLI interaction and PID/toml files for persistent state.
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let authProcess: ChildProcess | null = null;

function getModalTomlPath(): string {
  return join(homedir(), ".modal.toml");
}

/**
 * Get the Python command for the current platform.
 * On Windows, resolves the full path to avoid shell quoting issues.
 * On Unix, uses 'python3' or 'python'.
 */
export function getPythonCommand(): string {
  const isWin = process.platform === "win32";
  const candidates = isWin
    ? ["py", "python", "python3"]
    : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      // On Windows, use 'where' to get the full path; on Unix use 'which'
      const findCmd = isWin ? "where" : "which";
      const results = execSync(`${findCmd} ${cmd}`, {
        timeout: 5000,
        stdio: "pipe",
      })
        .toString()
        .trim()
        .split(/\r?\n/);

      // Filter results - skip WindowsApps stubs (they don't work with spawn)
      for (const result of results) {
        const trimmed = result.trim();
        if (!trimmed) continue;
        // Skip Windows Store app aliases - they're stubs that don't work with spawn()
        if (isWin && trimmed.includes("WindowsApps")) continue;
        if (existsSync(trimmed)) {
          return trimmed;
        }
      }
      // Fallback: just verify the command works (will use shell in this case)
      execSync(`${cmd} --version`, { timeout: 5000, stdio: "pipe" });
      return cmd;
    } catch {}
  }

  return isWin ? "python" : "python3";
}

/**
 * Spawn options for Python scripts.
 * If getPythonCommand returns a full path, shell is not needed.
 * If it returns just a command name (fallback), we need shell on Windows.
 */
export function getPythonSpawnOptions(
  extraOpts: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    shell: false,
    ...extraOpts,
  };
}

/**
 * Resolve the full path to the `modal` binary.
 * pip installs to user-local bin dirs that may not be in the Next.js server PATH,
 * so we check common locations explicitly.
 */
function findModalBin(): string {
  const isWin = process.platform === "win32";

  // 1. Check if `modal` is already on PATH
  try {
    const whichCmd = isWin ? "where modal" : "which modal";
    const found = execSync(whichCmd, { timeout: 5000, stdio: "pipe" })
      .toString()
      .trim();
    // `where` on Windows can return multiple lines; take the first
    const firstLine = found.split(/\r?\n/)[0];
    if (firstLine) return firstLine;
  } catch {}

  // 2. On Windows, ask Python for its scripts directory (most reliable)
  if (isWin) {
    try {
      // Try py launcher first, then python
      for (const pyCmd of ["py", "python", "python3"]) {
        try {
          const scriptsDir = execSync(
            `${pyCmd} -c "import sysconfig; print(sysconfig.get_path('scripts'))"`,
            { timeout: 5000, stdio: "pipe" },
          )
            .toString()
            .trim();
          const modalPath = join(scriptsDir, "modal.exe");
          if (existsSync(modalPath)) return modalPath;
        } catch {}
      }
    } catch {}
  }

  // 3. Check common pip user-install locations
  const home = homedir();
  const candidates: string[] = isWin
    ? [
        join(home, "AppData", "Roaming", "Python", "Scripts", "modal.exe"),
        join(
          home,
          "AppData",
          "Local",
          "Programs",
          "Python",
          "Python39",
          "Scripts",
          "modal.exe",
        ),
        join(
          home,
          "AppData",
          "Local",
          "Programs",
          "Python",
          "Python310",
          "Scripts",
          "modal.exe",
        ),
        join(
          home,
          "AppData",
          "Local",
          "Programs",
          "Python",
          "Python311",
          "Scripts",
          "modal.exe",
        ),
        join(
          home,
          "AppData",
          "Local",
          "Programs",
          "Python",
          "Python312",
          "Scripts",
          "modal.exe",
        ),
        join(
          home,
          "AppData",
          "Local",
          "Programs",
          "Python",
          "Python313",
          "Scripts",
          "modal.exe",
        ),
        join(
          home,
          "AppData",
          "Local",
          "Programs",
          "Python",
          "Python314",
          "Scripts",
          "modal.exe",
        ),
      ]
    : [
        join(home, "Library", "Python", "3.9", "bin", "modal"), // macOS pip3 --user
        join(home, "Library", "Python", "3.10", "bin", "modal"),
        join(home, "Library", "Python", "3.11", "bin", "modal"),
        join(home, "Library", "Python", "3.12", "bin", "modal"),
        join(home, "Library", "Python", "3.13", "bin", "modal"),
        join(home, ".local", "bin", "modal"), // Linux pip --user
        "/usr/local/bin/modal",
        "/opt/homebrew/bin/modal",
      ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return "modal"; // fallback — hope it's on PATH
}

/** Cached modal binary path. */
let _modalBin: string | null = null;
export function modalBin(): string {
  if (!_modalBin) _modalBin = findModalBin();
  return _modalBin;
}

function findPipExec(): string {
  const isWin = process.platform === "win32";

  // Try direct pip commands first
  for (const cmd of ["pip3 --version", "pip --version"]) {
    try {
      execSync(cmd, { timeout: 5000, stdio: "pipe" });
      return cmd.split(" ")[0];
    } catch {}
  }

  // Try python -m pip variants (especially important on Windows where pip may not be on PATH)
  const pythonCmds = isWin
    ? [
        "py -m pip --version",
        "python -m pip --version",
        "python3 -m pip --version",
      ]
    : ["python3 -m pip --version", "python -m pip --version"];
  for (const cmd of pythonCmds) {
    try {
      execSync(cmd, { timeout: 5000, stdio: "pipe" });
      // Return the "python -m pip" prefix (everything before " --version")
      return cmd.replace(" --version", "");
    } catch {}
  }

  return "pip";
}

export function isModalInstalled(): boolean {
  try {
    execSync(`${modalBin()} --version`, { timeout: 10000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function installModal(): Promise<{
  success: boolean;
  error?: string;
  logs?: string;
}> {
  return new Promise((resolve) => {
    const pip = findPipExec();
    // pip may be "py -m pip" or "python -m pip", so split into command + args
    const parts = pip.split(" ");
    const cmd = parts[0];
    const args = [...parts.slice(1), "install", "modal"];
    const proc = spawn(cmd, args, {
      stdio: "pipe",
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => resolve({ success: false, error: err.message }));
    proc.on("close", (code) => {
      // Clear cached modal binary path so it's re-detected after install
      _modalBin = null;
      if (code === 0) {
        resolve({ success: true, logs: stdout });
      } else {
        resolve({
          success: false,
          error: stderr || `pip exited with code ${code}`,
          logs: stdout,
        });
      }
    });
  });
}

export function getModalStatus(): {
  installed: boolean;
  authenticated: boolean;
  workspace?: string;
} {
  const installed = isModalInstalled();
  if (!installed) return { installed: false, authenticated: false };

  const tomlExists = existsSync(getModalTomlPath());
  if (!tomlExists) return { installed: true, authenticated: false };

  // Try to get workspace info
  try {
    const output = execSync(`${modalBin()} profile current`, {
      timeout: 10000,
      stdio: "pipe",
    })
      .toString()
      .trim();
    // modal profile current outputs the workspace name
    if (output) {
      return { installed: true, authenticated: true, workspace: output };
    }
  } catch {
    // Token exists but may be invalid — fall back to checking file existence
    return { installed: true, authenticated: true, workspace: "default" };
  }

  return { installed: true, authenticated: tomlExists };
}

/** Pending auth URL extracted from `modal token new` output. */
let pendingAuthUrl: string | null = null;
/** Captured output from the last modal auth attempt, for debugging. */
let authOutput: string = "";
/** Error from spawn, if any. */
let authError: string | null = null;

export function getAuthDebugInfo(): {
  url: string | null;
  output: string;
  error: string | null;
  processRunning: boolean;
  modalBin: string;
} {
  return {
    url: pendingAuthUrl,
    output: authOutput,
    error: authError,
    processRunning: authProcess != null && !authProcess.killed,
    modalBin: modalBin(),
  };
}

export function startModalAuth(): {
  started: boolean;
  error?: string;
  url?: string | null;
} {
  if (authProcess && !authProcess.killed) {
    return { started: true, url: pendingAuthUrl };
  }

  pendingAuthUrl = null;
  authOutput = "";
  authError = null;

  try {
    const isWin = process.platform === "win32";
    const bin = modalBin();
    console.log("[Modal Auth] Starting auth with binary:", bin);
    console.log("[Modal Auth] Platform:", process.platform, "shell:", isWin);

    // On Windows: shell: true is required because pip installs modal as a .cmd wrapper.
    // BROWSER='echo' only works on Unix (echo is a shell builtin on Windows, not an exe),
    // so on Windows we let Modal open the browser normally while still capturing the URL.
    const env = isWin
      ? { ...process.env }
      : { ...process.env, BROWSER: "echo" };

    authProcess = spawn(bin, ["token", "new", "--no-verify"], {
      stdio: "pipe",
      shell: isWin,
      detached: false,
      env,
    });

    const extractUrl = (chunk: Buffer) => {
      const text = chunk.toString();
      console.log("[Modal Auth] Output:", text);
      authOutput += text;
      // modal token new outputs a URL like https://modal.com/token-flow/...
      const match = text.match(/(https:\/\/modal\.com\/\S+)/);
      if (match) {
        pendingAuthUrl = match[1];
        console.log("[Modal Auth] Captured URL:", pendingAuthUrl);
      }
    };

    authProcess.stdout?.on("data", extractUrl);
    authProcess.stderr?.on("data", extractUrl);

    authProcess.on("error", (err) => {
      console.error("[Modal Auth] Process error:", err.message);
      authError = err.message;
      authProcess = null;
      pendingAuthUrl = null;
    });

    authProcess.on("close", (code) => {
      console.log("[Modal Auth] Process closed with code:", code);
      authProcess = null;
      // Keep pendingAuthUrl alive for 60s after process exits so the frontend can still retrieve it
      setTimeout(() => {
        pendingAuthUrl = null;
      }, 60_000);
    });

    return { started: true };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Modal Auth] Spawn error:", errMsg);
    authError = errMsg;
    return { started: false, error: errMsg };
  }
}

/** Returns the auth URL if one has been captured from the modal token flow. */
export function getModalAuthUrl(): string | null {
  return pendingAuthUrl;
}

export function isAuthInProgress(): boolean {
  return authProcess != null && !authProcess.killed;
}

/**
 * Sync a HuggingFace token to Modal as a secret named "huggingface-secret".
 * Called automatically when the user saves their HF key in Settings > Providers.
 */
export function syncHfTokenToModal(token: string): {
  success: boolean;
  error?: string;
} {
  if (!isModalInstalled())
    return { success: false, error: "Modal CLI not installed" };

  try {
    // Check if secret already exists
    const bin = modalBin();
    const listResult = execSync(`${bin} secret list`, {
      timeout: 10000,
      stdio: "pipe",
    }).toString();
    const secretExists = listResult.includes("huggingface-secret");

    if (secretExists) {
      // Delete and recreate (Modal doesn't have an update command)
      execSync(`${bin} secret delete huggingface-secret --yes`, {
        timeout: 10000,
        stdio: "pipe",
      });
    }

    // Create the secret
    execSync(`${bin} secret create huggingface-secret HF_TOKEN=${token}`, {
      timeout: 10000,
      stdio: "pipe",
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function disconnectModal(): { success: boolean; error?: string } {
  try {
    const tomlPath = getModalTomlPath();
    if (existsSync(tomlPath)) {
      unlinkSync(tomlPath);
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
