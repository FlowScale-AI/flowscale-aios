"use client";

// AIOS: Canvas execution uses the same POST→poll pattern as the apps and
// build-tool pages. All work happens server-side via /api/tools/[id]/executions,
// then we poll /api/comfy/[port]/history/[promptId] (through the CORS-free proxy)
// until the job completes.

import { useState, useCallback, useRef } from "react";
import type { ExecutionState } from "../types";
import { getComfyOrgApiKey } from "@/lib/platform";

interface UseToolExecutionProps {
  apiUrl?: string;
  apiKey?: string;
}

export const useToolExecution = (_props: UseToolExecutionProps) => {
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: "idle",
    progress: 0,
    logs: [],
    results: {},
  });

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);
  const wsRef = useRef<EventSource | null>(null);
  const executionIdRef = useRef<string | null>(null);
  const comfyPortRef = useRef<number | null>(null);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const executeWorkflow = useCallback(
    async (workflowId: string, inputs: Record<string, any>, comfyPortOverride?: number) => {
      abortRef.current = false;
      clearPoll();

      if (!workflowId.startsWith("aios:")) {
        setExecutionState({
          status: "error",
          progress: 0,
          logs: [`Unsupported workflow format: ${workflowId}`],
          results: {},
          error: `Unsupported workflow format: ${workflowId}`,
        });
        return;
      }

      const toolId = workflowId.slice("aios:".length);

      // Canvas passes inputs as "nodeId::paramName" — convert to "nodeId__paramName".
      // Skip zero/empty values: unconfigured number fields default to 0 in the canvas
      // but should fall back to the workflow's stored defaults, not be sent as 0.
      const apiInputs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(inputs)) {
        if (value instanceof File) continue;
        if (value === null || value === undefined || value === '' || value === 0) continue;
        apiInputs[key.replace(/::/g, "__")] = value;
      }

      setExecutionState({
        status: "submitting",
        progress: 0,
        logs: ["Queuing execution…"],
        results: {},
      });

      let executionId: string;
      let promptId: string;
      let comfyPort: number;
      let seed: number;
      let clientId: string;

      try {
        const res = await fetch(`/api/tools/${toolId}/executions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: apiInputs, comfyOrgApiKey: getComfyOrgApiKey() || undefined, ...(comfyPortOverride ? { comfyPort: comfyPortOverride } : {}) }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to start" }));
          throw new Error((err as any).error || "Failed to start execution");
        }

        ({ executionId, promptId, comfyPort, seed, clientId } = await res.json());
        executionIdRef.current = executionId;
        comfyPortRef.current = comfyPort;

        // Connect to server-side SSE proxy for live progress updates
        // (avoids direct WS to ComfyUI which triggers CORS host/origin mismatch)
        try {
          const sse = new EventSource(`/api/comfy/${comfyPort}/ws`);
          wsRef.current = sse;
          sse.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data as string);
              if (msg.type === "progress") {
                const pct = msg.data.max ? Math.round((msg.data.value / msg.data.max) * 100) : 0;
                setExecutionState((prev) => ({ ...prev, status: "running", progress: pct }));
              } else if (msg.type === "executing" && msg.data.node !== null) {
                setExecutionState((prev) => ({
                  ...prev,
                  status: "running",
                  logs: [...prev.logs, `Executing node: ${msg.data.node}`],
                }));
              }
            } catch { /* ignore parse errors */ }
          };
          sse.onerror = () => { sse.close(); wsRef.current = null; };
        } catch { /* SSE unavailable */ }
      } catch (err: any) {
        setExecutionState({
          status: "error",
          progress: 0,
          logs: [`Error: ${err.message}`],
          results: {},
          error: err.message,
        });
        return;
      }

      setExecutionState((prev) => ({
        ...prev,
        status: "running",
        run_id: promptId,
        logs: [...prev.logs, `Prompt queued (${promptId}). Waiting for output…`],
      }));

      // Poll history every 2 s — identical to apps/[id]/page.tsx
      let attempts = 0;
      const MAX_ATTEMPTS = 150; // 5 minutes

      pollTimerRef.current = setInterval(async () => {
        if (abortRef.current) { clearPoll(); return; }
        if (++attempts > MAX_ATTEMPTS) {
          clearPoll();
          setExecutionState((prev) => ({
            ...prev,
            status: "error",
            error: "Timed out waiting for ComfyUI",
            logs: [...prev.logs, "Timed out"],
          }));
          return;
        }

        try {
          const histRes = await fetch(`/api/comfy/${comfyPort}/history/${promptId}`);
          if (!histRes.ok) return;

          const hist = await histRes.json() as Record<string, {
            status?: { completed?: boolean; status_str?: string };
            outputs?: Record<string, {
              images?: { filename: string; subfolder: string; type: string }[];
              gifs?: { filename: string; subfolder: string; type: string }[];
              videos?: { filename: string; subfolder: string; type: string }[];
              audio?: { filename: string; subfolder: string; type: string }[];
              text?: string[];
              string?: string[];
            }>;
          }>;

          const entry = hist[promptId];
          if (!entry?.status?.completed) return;

          clearPoll();
          wsRef.current?.close();
          wsRef.current = null;

          const inferContentType = (filename: string, defaultType: string): string => {
            const ext = filename.split(".").pop()?.toLowerCase() ?? "";
            if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "video/mp4";
            if (["gif"].includes(ext)) return "image/gif";
            if (["glb", "gltf"].includes(ext)) return "model/gltf-binary";
            if (["obj"].includes(ext)) return "model/obj";
            if (["fbx", "stl", "ply"].includes(ext)) return "model/fbx";
            if (["mp3"].includes(ext)) return "audio/mpeg";
            if (["wav"].includes(ext)) return "audio/wav";
            if (["flac"].includes(ext)) return "audio/flac";
            if (["ogg"].includes(ext)) return "audio/ogg";
            if (["m4a"].includes(ext)) return "audio/mp4";
            if (["png"].includes(ext)) return "image/png";
            if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
            if (["webp"].includes(ext)) return "image/webp";
            return defaultType;
          };

          const addResult = (file: { filename: string; subfolder: string }, defaultType: string) => {
            const proxyUrl = `/api/comfy/${comfyPort}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}&type=output`;
            const contentType = inferContentType(file.filename, defaultType);
            const key = file.filename;
            resultsMap[key] = {
              content_type: contentType,
              // Both data and download_url point to the ComfyUI proxy — the file
              // lives in ComfyUI's output dir and is immediately accessible via /view.
              data: proxyUrl,
              download_url: proxyUrl,
              filename: file.filename,
              label: file.filename,
              run_id: promptId,
            };
          };

          // Build results map — use ComfyUI /view URL for immediate preview,
          // and the persisted /api/outputs URL for long-term access.
          const resultsMap: Record<string, any> = {};
          for (const nodeOut of Object.values(entry.outputs ?? {})) {
            for (const img of nodeOut.images ?? []) addResult(img, "image/png");
            for (const gif of nodeOut.gifs ?? []) addResult(gif, "video/mp4");
            for (const vid of nodeOut.videos ?? []) addResult(vid, "video/mp4");
            for (const aud of nodeOut.audio ?? []) addResult(aud, "audio/mpeg");
            for (const t of [...(nodeOut.text ?? []), ...(nodeOut.string ?? [])]) {
              if (typeof t === "string" && t.trim()) {
                const key = `text_${Object.keys(resultsMap).length}`;
                resultsMap[key] = {
                  content_type: "text/plain",
                  data: t,
                  filename: key,
                  label: t.length > 40 ? t.slice(0, 40) + "…" : t,
                  run_id: promptId,
                };
              }
            }
          }

          const isError = entry.status.status_str === "error";

          setExecutionState({
            status: isError ? "error" : "completed",
            progress: 100,
            logs: [isError ? "Execution failed" : "Execution completed"],
            results: resultsMap,
            run_id: promptId,
            error: isError ? "ComfyUI reported an error" : undefined,
          });

          // Persist to SQLite via API — the PATCH triggers saveOutputsToDisk
          // which rewrites outputsJson with persistent /api/outputs/... paths.
          fetch(`/api/executions/${executionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: isError ? "error" : "completed",
              outputsJson: JSON.stringify(
                Object.values(resultsMap).map((r: any) => ({
                  filename: r.filename,
                  path: r.filename,
                }))
              ),
              completedAt: Date.now(),
            }),
          })
            .then((res) => res.json())
            .then((saved) => {
              // Update results with persistent /api/outputs/ URLs from disk save
              try {
                const outputs: { filename?: string; path?: string }[] = JSON.parse(saved.outputsJson || "[]");
                const updatedMap = { ...resultsMap };
                for (const out of outputs) {
                  if (out.path?.startsWith("/api/outputs/") && out.filename && updatedMap[out.filename]) {
                    updatedMap[out.filename] = {
                      ...updatedMap[out.filename],
                      data: out.path,
                      download_url: out.path,
                    };
                  }
                }
                setExecutionState((prev) => ({ ...prev, results: updatedMap }));
              } catch {}
            })
            .catch(console.error);

        } catch {
          // Network hiccup — keep polling
        }
      }, 2000);
    },
    [],
  );

  const cancelWorkflow = useCallback(async () => {
    abortRef.current = true;
    clearPoll();
    wsRef.current?.close();
    wsRef.current = null;

    const execId = executionIdRef.current;
    const port = comfyPortRef.current;

    // Cancel the server-side execution record
    if (execId) {
      fetch(`/api/executions/${execId}/cancel`, { method: "POST" }).catch(() => {});
    }
    // Tell ComfyUI to stop the running prompt
    if (port) {
      fetch(`/api/comfy/${port}/interrupt`, { method: "POST" }).catch(() => {});
    }

    executionIdRef.current = null;
    comfyPortRef.current = null;

    setExecutionState((prev) => ({
      ...prev,
      status: "error",
      error: "Cancelled",
      logs: [...prev.logs, "Cancelled"],
    }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    clearPoll();
    wsRef.current?.close();
    wsRef.current = null;
    executionIdRef.current = null;
    comfyPortRef.current = null;
    setExecutionState({
      status: "idle",
      progress: 0,
      logs: [],
      results: {},
    });
  }, []);

  return { executionState, executeWorkflow, cancelWorkflow, reset };
};
