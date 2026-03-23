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

        # Model download happens in @modal.enter() on first cold start.
        # We removed the `modal run download_models` step because it stops
        # the deployed app (modal run is for ephemeral apps, not deployed ones).

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
        deployed = False
        warm = False
        gpu = None

        # Use Modal SDK lookup — control plane check, does NOT wake containers
        try:
            import modal
            app = modal.App.lookup(app_name)
            deployed = True
            # Check if any containers are running via the app object
            # The lookup succeeds if the app is deployed, regardless of warm/cold
        except modal.exception.NotFoundError:
            deployed = False
        except Exception:
            # SDK not available or other error — trust the local record if we have a URL
            deployed = bool(url)

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


def cmd_scan_comfyui(comfyui_path: str):
    """Scan local ComfyUI installation for custom nodes and models."""
    # Get ComfyUI version via git rev-parse HEAD
    version = ""
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, cwd=comfyui_path)
        version = result.stdout.strip()
    except Exception:
        pass

    # Scan custom_nodes/ for git repos
    custom_nodes = []
    cn_dir = os.path.join(comfyui_path, "custom_nodes")
    if os.path.isdir(cn_dir):
        for name in os.listdir(cn_dir):
            node_path = os.path.join(cn_dir, name)
            if not os.path.isdir(node_path) or name.startswith("."):
                continue
            if not os.path.exists(os.path.join(node_path, ".git")):
                continue
            try:
                repo = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5, cwd=node_path).stdout.strip()
                commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, cwd=node_path).stdout.strip()
                custom_nodes.append({"name": name, "repo": repo, "commit": commit})
            except Exception:
                pass

    # Scan models/ for model files
    models = []
    models_dir = os.path.join(comfyui_path, "models")
    if os.path.isdir(models_dir):
        for root, dirs, files in os.walk(models_dir):
            for f in files:
                if f.endswith((".safetensors", ".ckpt", ".pt", ".pth", ".bin")):
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, models_dir)
                    size = os.path.getsize(full)
                    models.append({"path": rel, "size": size})

    _json_out({"comfyuiPath": comfyui_path, "version": version, "customNodes": custom_nodes, "models": models})


def cmd_sync_models(comfyui_path: str, volume_name: str = "flowscale-comfyui-models"):
    """Upload all local ComfyUI models to a Modal Volume."""
    models_dir = os.path.join(comfyui_path, "models")
    if not os.path.isdir(models_dir):
        _json_out({"success": False, "error": f"Models directory not found: {models_dir}"})
        return

    # Collect model files
    model_files = []
    for root, dirs, files in os.walk(models_dir):
        for f in files:
            if f.endswith((".safetensors", ".ckpt", ".pt", ".pth", ".bin")):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, models_dir)
                model_files.append((full, rel))

    if not model_files:
        _json_out({"success": True, "synced": 0, "message": "No model files found"})
        return

    total = len(model_files)
    synced = 0
    errors = []

    for i, (full_path, rel_path) in enumerate(model_files, 1):
        size_mb = os.path.getsize(full_path) / 1024 / 1024
        print(f"[{i}/{total}] Uploading {rel_path} ({size_mb:.0f} MB)...", flush=True)
        try:
            result = subprocess.run(
                ["modal", "volume", "put", volume_name, full_path, rel_path],
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode == 0:
                synced += 1
                print(f"  Done.", flush=True)
            else:
                err = result.stderr.strip() or f"Exit code {result.returncode}"
                errors.append(f"{rel_path}: {err}")
                print(f"  Failed: {err}", flush=True)
        except subprocess.TimeoutExpired:
            errors.append(f"{rel_path}: upload timed out")
            print(f"  Timed out.", flush=True)
        except Exception as e:
            errors.append(f"{rel_path}: {e}")
            print(f"  Error: {e}", flush=True)

    _json_out({"success": len(errors) == 0, "synced": synced, "total": total, "errors": errors})


def _generate_comfyui_modal_app(custom_nodes, gpu, app_name):
    # Build the custom node clone+install commands for the image
    cn_commands = []
    for cn in custom_nodes:
        repo = cn["repo"]
        name = cn["name"]
        commit = cn["commit"]
        cn_commands.append(
            f'    .run_commands(\n'
            f'        "git clone {repo} /comfyui/custom_nodes/{name}",\n'
            f'        "cd /comfyui/custom_nodes/{name} && git checkout {commit}",\n'
            f'        "if [ -f /comfyui/custom_nodes/{name}/requirements.txt ]; then pip install -r /comfyui/custom_nodes/{name}/requirements.txt; fi",\n'
            f'    )\n'
        )
    cn_block = "".join(cn_commands) if cn_commands else ""

    # extra_model_paths.yaml written via Python in image build (not shell echo)

    return f'''import modal
import os
import subprocess
import time

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GPU = os.environ.get("FLOWSCALE_GPU", "{gpu}")
APP_NAME = os.environ.get("FLOWSCALE_APP_NAME", "{app_name}")

app = modal.App(APP_NAME)

# ---------------------------------------------------------------------------
# Volume for model storage (persists across deploys)
# ---------------------------------------------------------------------------
models_volume = modal.Volume.from_name("flowscale-comfyui-models", create_if_missing=True)

# ---------------------------------------------------------------------------
# Build the ComfyUI image
# ---------------------------------------------------------------------------
comfyui_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install("httpx", "websockets", "starlette")
    .run_commands(
        "git clone https://github.com/comfyanonymous/ComfyUI.git /comfyui",
        "cd /comfyui && pip install -r requirements.txt",
    )
{cn_block})


def _write_extra_model_paths():
    """Write extra_model_paths.yaml to the ComfyUI directory."""
    import pathlib
    yaml_content = """flowscale_modal:
  base_path: /models
  checkpoints: checkpoints/
  loras: loras/
  vae: vae/
  controlnet: controlnet/
  upscale_models: upscale_models/
"""
    pathlib.Path("/comfyui/extra_model_paths.yaml").write_text(yaml_content)


comfyui_image = comfyui_image.run_function(_write_extra_model_paths)

# Map GPU string names (Modal 1.0 API)
_GPU_MAP = {{
    "T4": "T4",
    "L4": "L4",
    "A10G": "A10G",
    "A100": "A100-40GB",
    "A100-80GB": "A100-80GB",
    "H100": "H100",
}}


def _resolve_gpu(gpu_str: str):
    return _GPU_MAP.get(gpu_str, "T4")


# ---------------------------------------------------------------------------
# Optional HuggingFace secret (for gated models)
# ---------------------------------------------------------------------------
def _get_secrets():
    try:
        return [modal.Secret.from_name("huggingface")]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# ComfyUI server class
# ---------------------------------------------------------------------------
@app.cls(
    image=comfyui_image,
    gpu=_resolve_gpu(GPU),
    volumes={{"/models": models_volume}},
    secrets=_get_secrets(),
    scaledown_window=60,
    timeout=600,
)
class ComfyUIServer:
    @modal.enter()
    def start_comfyui(self):
        """Start ComfyUI as a background subprocess and wait until ready."""
        self.proc = subprocess.Popen(
            [
                "python", "main.py",
                "--listen", "0.0.0.0",
                "--port", "8188",
                "--preview-method", "none",
                "--extra-model-paths-config", "/comfyui/extra_model_paths.yaml",
            ],
            cwd="/comfyui",
            # Let stdout/stderr flow to Modal's logger (not PIPE)
            stdout=None,
            stderr=None,
        )

        # Poll until ComfyUI is ready (up to 120s)
        import urllib.request
        for _ in range(240):
            try:
                urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2)
                print("ComfyUI is ready.")
                return
            except Exception:
                time.sleep(0.5)
        raise RuntimeError("ComfyUI failed to start within 120 seconds")

    @modal.asgi_app()
    def serve(self):
        import httpx
        from starlette.applications import Starlette
        from starlette.routing import Route, Mount
        from starlette.requests import Request
        from starlette.responses import StreamingResponse, Response
        from starlette.websockets import WebSocket

        COMFY = "http://127.0.0.1:8188"

        async def _proxy_http(request: Request):
            """Reverse-proxy any HTTP request to internal ComfyUI."""
            async with httpx.AsyncClient(base_url=COMFY, timeout=300) as client:
                url = request.url.path
                if request.url.query:
                    url = f"{{url}}?{{request.url.query}}"

                body = await request.body()

                resp = await client.request(
                    method=request.method,
                    url=url,
                    headers={{
                        k: v for k, v in request.headers.items()
                        if k.lower() not in ("host", "transfer-encoding")
                    }},
                    content=body,
                )

                return Response(
                    content=resp.content,
                    status_code=resp.status_code,
                    headers=dict(resp.headers),
                )

        async def _proxy_ws(ws: WebSocket):
            """Reverse-proxy WebSocket connections to internal ComfyUI."""
            import asyncio
            import websockets as ws_lib

            await ws.accept()

            query = str(ws.url.query) if ws.url.query else ""
            ws_url = f"ws://127.0.0.1:8188/ws"
            if query:
                ws_url = f"{{ws_url}}?{{query}}"

            async with ws_lib.connect(ws_url) as comfy_ws:

                async def client_to_comfy():
                    try:
                        async for message in ws.iter_text():
                            await comfy_ws.send(message)
                    except Exception:
                        pass

                async def comfy_to_client():
                    try:
                        async for message in comfy_ws:
                            if isinstance(message, bytes):
                                await ws.send_bytes(message)
                            else:
                                await ws.send_text(message)
                    except Exception:
                        pass

                await asyncio.gather(client_to_comfy(), comfy_to_client())

        starlette_app = Starlette(
            routes=[
                Route("/ws", _proxy_ws),
                Mount("/", app=Starlette(routes=[
                    Route("/{{path:path}}", _proxy_http, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]),
                    Route("/", _proxy_http, methods=["GET"]),
                ])),
            ],
        )

        return starlette_app
'''


def cmd_deploy_comfyui(config_source: str, gpu: str, app_name: str):
    """Deploy a ComfyUI installation to Modal.

    config_source can be a JSON string or a path to a JSON file.
    """
    try:
        # Try reading as file first, fall back to parsing as JSON string
        if os.path.isfile(config_source):
            with open(config_source) as f:
                config = json.load(f)
        else:
            config = json.loads(config_source)
    except Exception as e:
        _json_out({"success": False, "error": f"Invalid config: {e}"})
        return

    custom_nodes = config.get("customNodes", [])

    # Generate the modal app file
    app_content = _generate_comfyui_modal_app(custom_nodes, gpu, app_name)

    # Write to a temp file and deploy
    import tempfile
    tmp_dir = tempfile.mkdtemp(prefix="flowscale-comfyui-")
    modal_app_path = os.path.join(tmp_dir, "comfyui_modal_app.py")
    try:
        with open(modal_app_path, "w") as f:
            f.write(app_content)

        latest_path = os.path.join(tmp_dir, "modal-latest.log")
        with open(latest_path, "w") as f:
            f.write(f"[{datetime.now().isoformat()}] Deploying ComfyUI to Modal with GPU={gpu}...\n")

        env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name}
        proc = subprocess.Popen(
            ["modal", "deploy", modal_app_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            cwd=tmp_dir,
        )

        all_output = []
        with open(latest_path, "a") as log_f:
            for line in iter(proc.stdout.readline, ""):
                all_output.append(line)
                log_f.write(line)
                log_f.flush()

        proc.wait(timeout=600)
        full_output = "".join(all_output)

        if proc.returncode != 0:
            _json_out({"success": False, "error": full_output.strip() or f"modal deploy exited with code {proc.returncode}", "logs": full_output})
            return

        # Parse the URL from modal deploy output
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
        if not url:
            import re
            m = re.search(r"https://\S+\.modal\.run\S*", full_output)
            if m:
                url = m.group(0)

        # Auto-sync models from local ComfyUI to Volume after deploy
        comfyui_path = config.get("comfyuiPath", "")
        if comfyui_path and os.path.isdir(os.path.join(comfyui_path, "models")):
            with open(latest_path, "a") as log_f:
                log_f.write("\n[Syncing models to Modal Volume...]\n")
            cmd_sync_models(comfyui_path)

        _json_out({"success": True, "appName": app_name, "url": url or "", "gpu": gpu})

    except subprocess.TimeoutExpired:
        proc.kill()
        _json_out({"success": False, "error": "modal deploy timed out after 600s"})
    except Exception as e:
        _json_out({"success": False, "error": str(e)})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: modal-helper.py <deploy|undeploy|status|logs|scan-comfyui|deploy-comfyui> [args...]", file=sys.stderr)
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
    elif command == "scan-comfyui" and len(sys.argv) >= 3:
        cmd_scan_comfyui(sys.argv[2])
    elif command == "deploy-comfyui" and len(sys.argv) >= 5:
        cmd_deploy_comfyui(sys.argv[2], sys.argv[3], sys.argv[4])
    elif command == "sync-models" and len(sys.argv) >= 3:
        volume = sys.argv[3] if len(sys.argv) >= 4 else "flowscale-comfyui-models"
        cmd_sync_models(sys.argv[2], volume)
    else:
        print(f"Unknown command or missing args: {sys.argv[1:]}", file=sys.stderr)
        sys.exit(1)
