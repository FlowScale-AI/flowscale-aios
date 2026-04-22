# Troubleshooting

## Windows: `Detect GPUs` returns empty, or custom scripts fail to spawn

### Symptom

- Clicking **Detect GPUs** in Settings → Compute shows only the CPU. Your GPU is physically present and working elsewhere.
- Starting a ComfyUI instance (managed or via custom launch script) fails silently.
- The dev server log shows `status= 3221225794` or `STATUS_DLL_INIT_FAILED` with empty stderr when spawning any child process.
- Running `node -e "require('child_process').execSync('cmd /c echo HI')"` from a plain cmd.exe works fine — but the same code fails when executed from inside the dev server's Node process.

### Root cause

Windows Defender's **cloud-delivered protection** (with "Block at First Seen" + behavior monitoring enabled by default on Windows 11) can silently block grandchild process creation when the spawn chain matches a behavioral signature Microsoft pushes via a cloud rule update. The parent process survives; children die during DLL initialization with `STATUS_DLL_INIT_FAILED` (`0xC0000142`) and no entry in the Defender operational event log.

The chain `cmd → pnpm → turbo → node (Next.js dev server) → child_process.exec(...)` matches at least one such signature as of April 2026. Grandchild spawns die immediately; every GPU-detection code path that shells out to `python`, `nvidia-smi`, `rocm-smi`, or PowerShell returns empty.

### Fix

Add Defender exclusions for the repo and the relevant process names. Run from an **elevated PowerShell** (Admin):

```powershell
Add-MpPreference -ExclusionPath 'C:\path\to\flowscale-aios'
Add-MpPreference -ExclusionProcess 'node.exe'
Add-MpPreference -ExclusionProcess 'pnpm.cmd'
Add-MpPreference -ExclusionProcess 'turbo.exe'
```

If Tamper Protection is enabled, the PowerShell commands will be blocked — add the same exclusions via **Windows Security → Virus & threat protection → Manage settings → Exclusions**.

The process-name exclusions alone are usually enough. The folder exclusion is a broader safety net.

### How to diagnose a recurrence

If something that used to spawn subprocesses stops working overnight and rebooting doesn't help:

1. From plain `cmd.exe`, run `node -e "console.log(require('child_process').execSync('cmd /c echo HI').toString())"`. If that works, Node itself is fine.
2. From inside the failing context (e.g. a dev-server API route), temporarily log what `execSync('cmd /c echo HI')` returns. If it fails with `status= 3221225794` and empty stderr, Defender (or similar AV hooking process creation) is almost certainly blocking.
3. Check `Get-MpComputerStatus | Select-Object AntivirusSignatureLastUpdated` — a signature update shortly before the symptom started is strongly suggestive.
