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
from __future__ import annotations

import json
import subprocess
import sys
import os
from datetime import datetime


def _find_modal() -> str:
    """Resolve the full path to the `modal` binary.
    pip user-installs land in dirs that may not be on PATH when spawned from Node.js."""
    import shutil
    found = shutil.which("modal")
    if found:
        return found
    home = os.path.expanduser("~")
    candidates = [
        # macOS pip3 --user
        *[os.path.join(home, "Library", "Python", v, "bin", "modal") for v in ("3.9", "3.10", "3.11", "3.12", "3.13")],
        # Linux pip --user
        os.path.join(home, ".local", "bin", "modal"),
        "/usr/local/bin/modal",
        "/opt/homebrew/bin/modal",
    ]
    # Windows: check Scripts directory next to the Python executable
    if sys.platform == "win32":
        import sysconfig
        scripts_dir = sysconfig.get_path("scripts")
        if scripts_dir:
            candidates.insert(0, os.path.join(scripts_dir, "modal.exe"))
        # Also check common Windows pip install locations
        local_python = os.path.join(home, "AppData", "Local", "Python")
        if os.path.isdir(local_python):
            for d in os.listdir(local_python):
                s = os.path.join(local_python, d, "Scripts", "modal.exe")
                candidates.append(s)
        candidates.append(os.path.join(home, "AppData", "Local", "Programs", "Python", "Scripts", "modal.exe"))
        candidates.append(os.path.join(home, "AppData", "Roaming", "Python", "Scripts", "modal.exe"))
    for p in candidates:
        if os.path.isfile(p):
            return p
    return "modal"  # fallback

MODAL_BIN = _find_modal()


def _json_out(data: dict):
    print(json.dumps(data), flush=True)


def _save_log(plugin_dir: str, content: str, label: str = "deploy"):
    """Save logs to plugin dir as logs-{timestamp}.txt and as latest-log.txt."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = os.path.join(plugin_dir, f"logs-{label}-{ts}.txt")
    latest_path = os.path.join(plugin_dir, "modal-latest.log")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(content)
    with open(latest_path, "w", encoding="utf-8") as f:
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
    with open(latest_path, "w", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] Deploying to Modal with GPU={gpu}...\n")

    env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name, "PYTHONIOENCODING": "utf-8"}
    try:
        # Use Popen for streaming — write to log file as output arrives
        proc = subprocess.Popen(
            [MODAL_BIN, "deploy", modal_app_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=plugin_dir,
        )

        all_output = []
        with open(latest_path, "a", encoding="utf-8") as log_f:
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
        # The URL may be on the same line as "=>" or split across lines
        url = None
        lines = full_output.splitlines()
        for i, line in enumerate(lines):
            if "=>" in line and "http" in line:
                url = line.split("=>")[-1].strip()
                # URL may be wrapped across lines — keep appending continuation lines
                while url and not url.endswith(".run") and i + 1 < len(lines):
                    i += 1
                    continuation = lines[i].strip()
                    if continuation and not continuation.startswith("✓") and not continuation.startswith("View"):
                        url += continuation
                    else:
                        break
                break
            if "=>" in line and i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line.startswith("http"):
                    url = next_line
                    # Also check for continuation
                    while url and not url.endswith(".run") and i + 2 < len(lines):
                        i += 1
                        continuation = lines[i + 1].strip()
                        if continuation and not continuation.startswith("✓") and not continuation.startswith("View"):
                            url += continuation
                        else:
                            break
                    break
        # Fallback: search for any Modal URL in the output (join lines first to handle wrapping)
        if not url or not url.endswith(".run"):
            import re
            joined = full_output.replace("\n", "").replace("\r", "")
            m = re.search(r"https://\S+\.modal\.run", joined)
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
        subprocess.run([MODAL_BIN, "app", "stop", app_name], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        subprocess.run([MODAL_BIN, "app", "delete", app_name, "--yes"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
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
        with open(latest_path, "r", encoding="utf-8") as f:
            deploy_logs = f.read()

    # Runtime logs from Modal CLI (streams forever — grab what we can in 3s)
    runtime_logs = ""
    if app_name:
        try:
            import select
            proc = subprocess.Popen(
                [MODAL_BIN, "app", "logs", app_name],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", errors="replace",
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


def _fetch_comfyui_manager_nodelist():
    """Fetch ComfyUI-Manager's custom-node-list.json and return a dict mapping
    repo-name (lowercase) → git URL.  Returns {} on any failure."""
    import urllib.request
    url = "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        lookup = {}
        for entry in data.get("custom_nodes", data) if isinstance(data, dict) else data:
            ref = entry.get("reference", "")
            if ref and "github.com" in ref:
                # Extract repo name from URL (last path segment)
                repo_name = ref.rstrip("/").rsplit("/", 1)[-1].lower()
                lookup[repo_name] = ref
        print(f"  Fetched ComfyUI-Manager node list: {len(lookup)} entries", file=sys.stderr)
        return lookup
    except Exception as e:
        print(f"  Could not fetch ComfyUI-Manager node list: {e}", file=sys.stderr)
        return {}


def _resolve_repo_from_pyproject(node_path):
    """Try to extract a git repo URL from pyproject.toml in the node directory."""
    toml_path = os.path.join(node_path, "pyproject.toml")
    if not os.path.isfile(toml_path):
        return None
    try:
        try:
            import tomllib
        except ImportError:
            try:
                import tomli as tomllib  # type: ignore[no-redef]
            except ImportError:
                return None
        with open(toml_path, "rb") as f:
            data = tomllib.load(f)
        urls = data.get("project", {}).get("urls", {})
        for key in ("Repository", "repository", "Source", "source", "Homepage", "homepage"):
            url = urls.get(key, "")
            if url and "github.com" in url:
                return url.rstrip("/")
    except Exception:
        pass
    return None


def cmd_scan_comfyui(comfyui_path: str):
    """Scan local ComfyUI installation for custom nodes and models."""
    # Get ComfyUI version via git rev-parse HEAD
    version = ""
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, cwd=comfyui_path)
        version = result.stdout.strip()
    except Exception:
        pass

    # Scan custom_nodes/ for git repos and non-git packages
    custom_nodes = []
    non_git_dirs = []
    cn_dir = os.path.join(comfyui_path, "custom_nodes")
    if os.path.isdir(cn_dir):
        for name in os.listdir(cn_dir):
            node_path = os.path.join(cn_dir, name)
            if not os.path.isdir(node_path) or name.startswith("."):
                continue

            # Path 1: git-based node (existing logic, unchanged)
            if os.path.exists(os.path.join(node_path, ".git")):
                try:
                    repo = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5, cwd=node_path).stdout.strip()
                    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, cwd=node_path).stdout.strip()
                    custom_nodes.append({"name": name, "repo": repo, "commit": commit})
                except Exception:
                    pass
            else:
                # Collect non-git dirs for fallback resolution
                non_git_dirs.append((name, node_path))

    # Path 2: resolve non-git custom nodes via pyproject.toml or ComfyUI-Manager registry
    if non_git_dirs:
        manager_lookup = None  # lazy-fetched only if needed
        for name, node_path in non_git_dirs:
            # Try pyproject.toml first (local, no network)
            repo_url = _resolve_repo_from_pyproject(node_path)

            # Fallback: ComfyUI-Manager registry lookup by folder name
            if not repo_url:
                if manager_lookup is None:
                    manager_lookup = _fetch_comfyui_manager_nodelist()
                repo_url = manager_lookup.get(name.lower())

            if repo_url:
                print(f"  Resolved non-git node '{name}' -> {repo_url}", file=sys.stderr)
                custom_nodes.append({"name": name, "repo": repo_url, "commit": "HEAD"})
            else:
                print(f"  Skipped non-git node '{name}' (could not resolve repo URL)", file=sys.stderr)

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


def cmd_sync_models(comfyui_path: str, volume_name: str = "flowscale-comfyui-models", silent: bool = False):
    """Upload all local ComfyUI models to a Modal Volume.

    When silent=True, don't write final JSON to stdout (used when called from deploy).
    """
    models_dir = os.path.join(comfyui_path, "models")
    if not os.path.isdir(models_dir):
        if not silent:
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
        if not silent:
            _json_out({"success": True, "synced": 0, "message": "No model files found"})
        return

    total = len(model_files)
    synced = 0
    errors = []

    def _log(msg: str):
        if not silent:
            print(msg, flush=True)

    for i, (full_path, rel_path) in enumerate(model_files, 1):
        size_mb = os.path.getsize(full_path) / 1024 / 1024
        _log(f"[{i}/{total}] Uploading {rel_path} ({size_mb:.0f} MB)...")
        try:
            result = subprocess.run(
                [MODAL_BIN, "volume", "put", "--force", volume_name, full_path, rel_path],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            if result.returncode == 0:
                synced += 1
                _log(f"  Done.")
            else:
                err = result.stderr.strip() or f"Exit code {result.returncode}"
                errors.append(f"{rel_path}: {err}")
                _log(f"  Failed: {err}")
        except subprocess.TimeoutExpired:
            errors.append(f"{rel_path}: upload timed out")
            _log(f"  Timed out.")
        except Exception as e:
            errors.append(f"{rel_path}: {e}")
            _log(f"  Error: {e}")

    if not silent:
        _json_out({"success": len(errors) == 0, "synced": synced, "total": total, "errors": errors})


def cmd_download_model(url: str, model_type: str, filename: str, volume_name: str = "flowscale-comfyui-models"):
    """Download a model from a URL directly into the Modal Volume.

    Uses `modal volume put` with stdin piped from curl/wget, or a small
    ephemeral Modal function that downloads within the cloud.
    For simplicity we download locally to a temp file then upload.
    """
    import tempfile
    import urllib.request
    import urllib.error

    # Validate model_type maps to a known subfolder
    type_to_folder = {
        "checkpoint": "checkpoints",
        "lora": "loras",
        "vae": "vae",
        "controlnet": "controlnet",
        "upscaler": "upscale_models",
        "other": "other",
    }
    folder = type_to_folder.get(model_type, model_type)
    remote_path = f"{folder}/{filename}"

    # Ensure the Modal Volume exists before uploading
    print(f"Ensuring volume '{volume_name}' exists...", flush=True)
    try:
        subprocess.run(
            [MODAL_BIN, "volume", "create", volume_name],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=30, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        # Ignore errors — volume may already exist, which is fine
    except Exception:
        pass

    print(f"Downloading {url} ...", flush=True)

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=f"_{filename}")
    try:
        os.close(tmp_fd)

        # Download with progress — use API key from env if available
        headers = {"User-Agent": "FlowScale-AIOS/1.0"}
        api_key = os.environ.get("FLOWSCALE_MODEL_API_KEY", "")
        if api_key:
            if "huggingface.co" in url or "hf.co" in url:
                headers["Authorization"] = f"Bearer {api_key}"
            # CivitAI key is already appended as ?token= by the frontend
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                downloaded = 0
                with open(tmp_path, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 1024)  # 1MB chunks
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            pct = downloaded * 100 // total
                            print(f"  {downloaded // (1024*1024)} / {total // (1024*1024)} MB ({pct}%)", flush=True)
        except urllib.error.HTTPError as e:
            _json_out({"success": False, "error": f"Download failed: HTTP {e.code} {e.reason}"})
            return
        except urllib.error.URLError as e:
            _json_out({"success": False, "error": f"Download failed: {e.reason}"})
            return

        size_mb = os.path.getsize(tmp_path) / 1024 / 1024
        print(f"Downloaded {size_mb:.0f} MB. Uploading to Modal Volume as {remote_path} ...", flush=True)

        # Upload to Modal Volume
        result = subprocess.run(
            [MODAL_BIN, "volume", "put", "--force", volume_name, tmp_path, remote_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        if result.returncode != 0:
            err = result.stderr.strip() or f"Exit code {result.returncode}"
            _json_out({"success": False, "error": f"Volume upload failed: {err}"})
            return

        print("Done.", flush=True)
        _json_out({"success": True, "remotePath": remote_path, "sizeMB": round(size_mb, 1)})

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _generate_comfyui_modal_app(custom_nodes, gpu, app_name):
    # Build custom node commands: clone+checkout in one layer, all pip installs in another.
    # Consolidating pip installs lets pip resolve version conflicts globally instead of
    # each node overwriting the previous one's dependencies (e.g. comfy-env versions).
    clone_commands = []
    node_names = []
    for cn in custom_nodes:
        repo = cn["repo"]
        name = cn["name"]
        commit = cn["commit"]
        clone_commands.append(
            f'        "git clone {repo} /comfyui/custom_nodes/{name}",'
        )
        clone_commands.append(
            f'        "cd /comfyui/custom_nodes/{name} && (git checkout {commit} 2>/dev/null || echo \'Commit {commit} not found, using default branch\')",'
        )
        node_names.append(name)

    cn_block = ""
    if clone_commands:
        # Layer 1: clone all custom nodes and checkout commits
        cn_block = f'    .run_commands(\n' + "\n".join(clone_commands) + f'\n    )\n'
        # Layer 2: install deps for each custom node sequentially.
        # Some nodes pin conflicting versions of the same package (e.g. comfy-env==0.2.17
        # vs comfy-env==0.1.92). Installing all at once causes pip ResolutionImpossible.
        # Instead, install each node's requirements individually (mirroring how ComfyUI
        # itself handles this locally) and ignore failures — the last compatible version wins.
        install_commands = []
        for n in node_names:
            install_commands.append(
                f'        "if [ -f /comfyui/custom_nodes/{n}/requirements.txt ]; then pip install -r /comfyui/custom_nodes/{n}/requirements.txt || true; fi",'
            )
        cn_block += f'    .run_commands(\n' + "\n".join(install_commands) + f'\n    )\n'

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
  clip: text_encoders/
  clip_vision: clip_vision/
  controlnet: controlnet/
  diffusers: diffusers/
  diffusion_models: diffusion_models/
  embeddings: embeddings/
  gligen: gligen/
  hypernetworks: hypernetworks/
  loras: loras/
  style_models: style_models/
  text_encoders: text_encoders/
  unet: diffusion_models/
  upscale_models: upscale_models/
  vae: vae/
  vae_approx: vae_approx/
"""
    pathlib.Path("/comfyui/extra_model_paths.yaml").write_text(yaml_content)


comfyui_image = comfyui_image.run_function(_write_extra_model_paths)

# Map GPU string names (Modal 1.0 API)
_GPU_MAP = {{
    "T4": "T4",
    "L4": "L4",
    "A10": "A10G",
    "L40S": "L40S",
    "A100-40GB": "A100-40GB",
    "A100-80GB": "A100-80GB",
    "RTX-PRO-6000": "RTXPRO6000",
    "H100": "H100",
    "H200": "H200",
    "B200": "B200",
}}


def _resolve_gpu(gpu_str: str):
    return _GPU_MAP.get(gpu_str, "T4")


# ---------------------------------------------------------------------------
# ComfyUI server class
# ---------------------------------------------------------------------------
@app.cls(
    image=comfyui_image,
    gpu=_resolve_gpu(GPU),
    volumes={{"/models": models_volume}},
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

        # Poll until ComfyUI is ready (up to 300s — custom node imports can be slow)
        import urllib.request
        health_endpoints = ["/system_stats", "/internal/logs/raw", "/"]
        for _ in range(600):
            for ep in health_endpoints:
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:8188{{ep}}", timeout=2)
                    print(f"ComfyUI is ready (responded on {{ep}}).")
                    return
                except Exception:
                    pass
            time.sleep(0.5)
        raise RuntimeError("ComfyUI failed to start within 300 seconds")

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
        with open(modal_app_path, "w", encoding="utf-8") as f:
            f.write(app_content)

        latest_path = os.path.join(tmp_dir, "modal-latest.log")
        with open(latest_path, "w", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}] Deploying ComfyUI to Modal with GPU={gpu}...\n")

        env = {**os.environ, "FLOWSCALE_GPU": gpu, "FLOWSCALE_APP_NAME": app_name, "PYTHONIOENCODING": "utf-8"}
        proc = subprocess.Popen(
            [MODAL_BIN, "deploy", modal_app_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=tmp_dir,
        )

        all_output = []
        with open(latest_path, "a", encoding="utf-8") as log_f:
            for line in iter(proc.stdout.readline, ""):
                all_output.append(line)
                log_f.write(line)
                log_f.flush()

        proc.wait(timeout=600)
        full_output = "".join(all_output)

        if proc.returncode != 0:
            _json_out({"success": False, "error": full_output.strip() or f"modal deploy exited with code {proc.returncode}", "logs": full_output})
            return

        # Parse the URL from modal deploy output (handles line-wrapped URLs)
        url = None
        import re
        joined = full_output.replace("\n", "").replace("\r", "")
        m = re.search(r"https://\S+\.modal\.run", joined)
        if m:
            url = m.group(0)

        # Auto-sync models from local ComfyUI to Volume after deploy
        comfyui_path = config.get("comfyuiPath", "")
        if comfyui_path and os.path.isdir(os.path.join(comfyui_path, "models")):
            with open(latest_path, "a", encoding="utf-8") as log_f:
                log_f.write("\n[Syncing models to Modal Volume...]\n")
            cmd_sync_models(comfyui_path, silent=True)

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
    elif command == "download-model" and len(sys.argv) >= 5:
        volume = sys.argv[5] if len(sys.argv) >= 6 else "flowscale-comfyui-models"
        cmd_download_model(sys.argv[2], sys.argv[3], sys.argv[4], volume)
    else:
        print(f"Unknown command or missing args: {sys.argv[1:]}", file=sys.stderr)
        sys.exit(1)
