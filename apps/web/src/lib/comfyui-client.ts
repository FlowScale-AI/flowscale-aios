import { getComfyUIUrl } from "./platform";

// ── REST helpers ────────────────────────────────────────────────────────────

async function comfyFetch(path: string, init?: RequestInit, baseUrl?: string) {
  const base = baseUrl ?? getComfyUIUrl();
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) throw new Error(`ComfyUI ${path}: ${res.status} ${res.statusText}`);
  return res;
}

async function comfyJson<T = any>(path: string, init?: RequestInit, baseUrl?: string): Promise<T> {
  const res = await comfyFetch(path, init, baseUrl);
  return res.json();
}

// ── Public API ──────────────────────────────────────────────────────────────

/** List workflow files saved in ComfyUI's userdata directory. */
export async function listWorkflows(baseUrl?: string): Promise<string[]> {
  // Returns a flat array of filenames (e.g. ["my_workflow.json", …])
  return comfyJson<string[]>("/api/userdata?dir=workflows", undefined, baseUrl);
}

/** Load a single workflow JSON by filename. */
export async function loadWorkflow(filename: string, baseUrl?: string): Promise<any> {
  const encoded = encodeURIComponent(`workflows/${filename}`);
  return comfyJson(`/api/userdata/${encoded}`, undefined, baseUrl);
}

/** Get node definitions (input types, defaults, ranges). */
export async function getObjectInfo(baseUrl?: string): Promise<Record<string, any>> {
  return comfyJson("/object_info", undefined, baseUrl);
}

/** Upload an image/file to ComfyUI. Returns the uploaded filename. */
export async function uploadImage(file: File, baseUrl?: string): Promise<string> {
  const form = new FormData();
  form.append("image", file, file.name);
  const res = await comfyFetch("/upload/image", {
    method: "POST",
    body: form,
  }, baseUrl);
  const data = await res.json();
  return data.name; // ComfyUI returns { name, subfolder, type }
}

/** Submit a prompt to ComfyUI. Returns the prompt_id. */
export async function queuePrompt(
  workflow: Record<string, any>,
  clientId: string,
  baseUrl?: string,
  apiKey?: string,
): Promise<string> {
  const payload: Record<string, any> = { prompt: workflow, client_id: clientId };
  if (apiKey) {
    payload.extra_data = { api_key_comfy_org: apiKey };
  }
  const res = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, baseUrl);
  const data = await res.json();
  return data.prompt_id;
}

/** Fetch history for a finished prompt. */
export async function getHistory(
  promptId: string,
  baseUrl?: string,
): Promise<Record<string, any>> {
  return comfyJson(`/history/${promptId}`, undefined, baseUrl);
}

/** Build a URL to view/download a ComfyUI output file. */
export function getOutputUrl(filename: string, subfolder = "", type = "output", baseUrl?: string): string {
  const base = baseUrl ?? getComfyUIUrl();
  const params = new URLSearchParams({ filename, subfolder, type });
  return `${base}/view?${params}`;
}

/** Save (upload) a workflow JSON to ComfyUI's userdata directory. */
export async function saveWorkflow(
  filename: string,
  workflow: Record<string, any>,
  baseUrl?: string,
): Promise<void> {
  const encoded = encodeURIComponent(`workflows/${filename}`);
  await comfyFetch(`/api/userdata/${encoded}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workflow),
  }, baseUrl);
}

/** Check if ComfyUI server is reachable. */
export async function checkConnection(baseUrl?: string): Promise<boolean> {
  try {
    const base = baseUrl ?? getComfyUIUrl();
    const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── WebSocket helper ────────────────────────────────────────────────────────

export interface ComfyWSMessage {
  type: string;
  data: any;
}

export type ComfyProgressCallback = (msg: ComfyWSMessage) => void;

/**
 * Opens a WebSocket to ComfyUI and returns a controller object.
 * The onMessage callback fires for every message from ComfyUI.
 */
export function connectWS(
  clientId: string,
  onMessage: ComfyProgressCallback,
  baseUrl?: string,
): { close: () => void } {
  const base = (baseUrl ?? getComfyUIUrl()).replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/ws?clientId=${clientId}`);

  ws.onmessage = (evt) => {
    try {
      const msg: ComfyWSMessage = JSON.parse(evt.data);
      onMessage(msg);
    } catch {
      // binary frame (preview image) – ignore
    }
  };

  ws.onerror = (err) => {
    console.error("[ComfyUI WS] error", err);
  };

  return {
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
  };
}
