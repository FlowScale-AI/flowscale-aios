#!/usr/bin/env python3
"""
Modal SDK helper for FlowScale AIOS.

Called by the Node.js backend via child_process.spawn.
All output is JSON to stdout for easy parsing.

Usage:
    python modal-helper.py deploy <plugin-dir> <gpu-tier> <app-name>
    python modal-helper.py undeploy <app-name>
    python modal-helper.py status <app-name>
    python modal-helper.py logs <plugin-dir>
"""
import json
import subprocess
import sys
import os
from datetime import datetime


def _json_out(data: dict):
    print(json.dumps(data), flush=True)


def _save_log(plugin_dir: str, content: str, label: str = "deploy"):
    """Save logs to plugin dir as logs-{timestamp}.txt and as latest-log.txt."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = os.path.join(plugin_dir, f"logs-{label}-{ts}.txt")
    latest_path = os.path.join(plugin_dir, "modal-latest.log")
    with open(log_path, "w") as f:
        f.write(content)
    with open(latest_path, "w") as f:
        f.write(content)
    return log_path


def cmd_deploy(plugin_dir: str, gpu: str, app_name: str):
    """Deploy the plugin's modal_app.py with the given GPU tier."""
    modal_app_path = os.path.join(plugin_dir, "modal_app.py")
    if not os.path.exists(modal_app_path):
        _json_out({"success": False, "error": f"modal_app.py not found in {plugin_dir}"})
        return

    # Write initial log entry
    latest_path = os.path.join(plugin_dir, "modal-latest.log")
    with open(latest_path, "w") as f:
        f.write(f"[{datetime.now().isoformat()}] Deploying to Modal with GPU={gpu}...\n")

    env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name}
    try:
        # Use Popen for streaming — write to log file as output arrives
        proc = subprocess.Popen(
            ["modal", "deploy", modal_app_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            cwd=plugin_dir,
        )

        all_output = []
        with open(latest_path, "a") as log_f:
            for line in iter(proc.stdout.readline, ""):
                all_output.append(line)
                log_f.write(line)
                log_f.flush()

        proc.wait(timeout=600)
        full_output = "".join(all_output)

        # Save final log file with timestamp
        _save_log(plugin_dir, full_output, "deploy")

        if proc.returncode != 0:
            _json_out({"success": False, "error": full_output.strip() or f"modal deploy exited with code {proc.returncode}", "logs": full_output})
            return

        # Parse the URL from modal deploy output
        # The URL may be on the same line as "=>" or on the next line
        url = None
        lines = full_output.splitlines()
        for i, line in enumerate(lines):
            if "=>" in line and "http" in line:
                url = line.split("=>")[-1].strip()
                break
            if "=>" in line and i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line.startswith("http"):
                    url = next_line
                    break
        # Fallback: search for any Modal URL in the output
        if not url:
            import re
            m = re.search(r"https://\S+\.modal\.run\S*", full_output)
            if m:
                url = m.group(0)

        _json_out({"success": True, "appName": app_name, "url": url or "", "gpu": gpu})

    except subprocess.TimeoutExpired:
        proc.kill()
        _json_out({"success": False, "error": "modal deploy timed out after 600s"})
    except Exception as e:
        _json_out({"success": False, "error": str(e)})


def cmd_undeploy(app_name: str):
    """Stop and delete a Modal app."""
    try:
        subprocess.run(["modal", "app", "stop", app_name], capture_output=True, text=True, timeout=30)
        subprocess.run(["modal", "app", "delete", app_name, "--yes"], capture_output=True, text=True, timeout=30)
        _json_out({"success": True})
    except Exception as e:
        _json_out({"success": False, "error": str(e)})


def cmd_status(app_name: str, url: str | None = None):
    """Check if a Modal app is deployed and if a container is warm.

    Uses the health endpoint as the primary check (modal app list truncates names).
    Falls back to assuming deployed if we have a URL on record.
    """
    try:
        warm = False
        gpu = None
        deployed = False

        # Primary check: hit the health endpoint
        if url:
            import urllib.request
            try:
                req = urllib.request.Request(f"{url.rstrip('/')}/health", method="GET")
                with urllib.request.urlopen(req, timeout=8) as resp:
                    data = json.loads(resp.read().decode())
                    warm = True
                    deployed = True
                    gpu = data.get("gpu")
            except urllib.error.HTTPError:
                # Got an HTTP response (e.g. 500) — app is deployed but erroring
                deployed = True
                warm = False
            except Exception:
                # Timeout or connection refused — could be cold start or not deployed
                # Check modal app list as fallback (partial match on truncated names)
                try:
                    result = subprocess.run(
                        ["modal", "app", "list"],
                        capture_output=True, text=True, timeout=15,
                    )
                    # Match on the first part of the name (before truncation "…")
                    short_name = app_name[:12]  # e.g. "flowscale-z-" matches "flowscale-z…"
                    for line in result.stdout.splitlines():
                        if short_name in line and "deployed" in line:
                            deployed = True
                            break
                except Exception:
                    pass

                # If we still can't confirm, trust the local record
                if not deployed:
                    deployed = True  # Trust the caller — they have a URL on record
                    warm = False
        else:
            # No URL — can't check anything
            deployed = False

        _json_out({"deployed": deployed, "warm": warm, "gpu": gpu, "url": url})

    except Exception as e:
        _json_out({"deployed": False, "warm": False, "gpu": None, "url": None, "error": str(e)})


def cmd_logs(plugin_dir: str, app_name: str = ""):
    """Read deploy logs from disk + runtime logs from Modal CLI."""
    # Deploy logs from disk
    latest_path = os.path.join(plugin_dir, "modal-latest.log")
    deploy_logs = ""
    if os.path.exists(latest_path):
        with open(latest_path, "r") as f:
            deploy_logs = f.read()

    # Runtime logs from Modal CLI (streams forever — grab what we can in 3s)
    runtime_logs = ""
    if app_name:
        try:
            import select
            proc = subprocess.Popen(
                ["modal", "app", "logs", app_name],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            lines = []
            import time
            deadline = time.time() + 3
            while time.time() < deadline:
                # Use select to check if data is available (non-blocking)
                ready, _, _ = select.select([proc.stdout], [], [], 0.5)
                if ready:
                    line = proc.stdout.readline()
                    if not line:
                        break
                    lines.append(line)
            proc.kill()
            proc.wait()
            runtime_logs = "".join(lines).strip()
        except Exception:
            pass

    # Combine: deploy logs first, then runtime logs separated by a marker
    combined = deploy_logs
    if runtime_logs:
        combined += "\n\n── Runtime Logs ──────────────────────────────\n" + runtime_logs

    _json_out({"logs": combined, "deployLogs": deploy_logs, "runtimeLogs": runtime_logs})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: modal-helper.py <deploy|undeploy|status|logs> [args...]", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]

    if command == "deploy" and len(sys.argv) >= 5:
        cmd_deploy(sys.argv[2], sys.argv[3], sys.argv[4])
    elif command == "undeploy" and len(sys.argv) >= 3:
        cmd_undeploy(sys.argv[2])
    elif command == "status" and len(sys.argv) >= 3:
        url = sys.argv[3] if len(sys.argv) >= 4 else None
        cmd_status(sys.argv[2], url)
    elif command == "logs" and len(sys.argv) >= 3:
        app_name = sys.argv[3] if len(sys.argv) >= 4 else ""
        cmd_logs(sys.argv[2], app_name)
    else:
        print(f"Unknown command or missing args: {sys.argv[1:]}", file=sys.stderr)
        sys.exit(1)
