"use client";

import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ExecutionState } from "../types";
import { graphToApiFormat, resolveWidgetValues } from "@/lib/comfyui-tool-mapper";
import { usePodsStore } from "@/store/podsStore";
import { isDesktop } from "@/lib/platform";

// In desktop mode the operator always runs on this address
const DESKTOP_OPERATOR_URL = "http://localhost:30000";

function effectiveOperatorUrl(storeUrl: string | null): string | null {
  if (storeUrl) return storeUrl;
  if (isDesktop()) return DESKTOP_OPERATOR_URL;
  return null;
}

// ── Operator HTTP helpers ────────────────────────────────────────────────────

async function opFetch(
  opUrl: string,
  podId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${opUrl}/api/pods/${encodeURIComponent(podId)}${path}`, init);
}

async function opJson<T>(
  opUrl: string,
  podId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await opFetch(opUrl, podId, path, init);
  if (!res.ok) throw new Error(`Operator ${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function opLoadWorkflow(opUrl: string, podId: string, filename: string): Promise<any> {
  return opJson(opUrl, podId, `/workflow?filename=${encodeURIComponent(filename)}`);
}

async function opUploadImage(opUrl: string, podId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file, file.name);
  const res = await opFetch(opUrl, podId, "/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  const data = await res.json();
  return data.name as string;
}

async function opQueuePrompt(
  opUrl: string,
  podId: string,
  workflow: Record<string, any>,
  clientId: string,
): Promise<string> {
  const res = await opFetch(opUrl, podId, "/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) throw new Error(`Queue failed: ${res.statusText}`);
  const data = await res.json();
  return (data as any).prompt_id as string;
}

async function opGetHistory(
  opUrl: string,
  podId: string,
  promptId: string,
): Promise<Record<string, any>> {
  return opJson(opUrl, podId, `/history/${encodeURIComponent(promptId)}`);
}

async function opGetObjectInfo(opUrl: string, podId: string): Promise<Record<string, any>> {
  return opJson(opUrl, podId, "/object_info");
}

function opOutputUrl(
  opUrl: string,
  podId: string,
  filename: string,
  subfolder = "",
  type = "output",
): string {
  const params = new URLSearchParams({ filename, subfolder, type });
  return `${opUrl}/api/pods/${encodeURIComponent(podId)}/view?${params}`;
}

// ── WebSocket tunnel helper ──────────────────────────────────────────────────

export interface ComfyWSMessage { type: string; data: any }

function opConnectWS(
  opUrl: string,
  podId: string,
  clientId: string,
  onMessage: (msg: ComfyWSMessage) => void,
): { close: () => void } {
  const wsUrl = opUrl.replace(/^http/, "ws");
  const ws = new WebSocket(
    `${wsUrl}/api/pods/${encodeURIComponent(podId)}/ws?clientId=${encodeURIComponent(clientId)}`,
  );

  ws.onmessage = (evt) => {
    try {
      const msg: ComfyWSMessage = JSON.parse(evt.data as string);
      onMessage(msg);
    } catch {
      // binary preview frame — ignore
    }
  };

  ws.onerror = (err) => console.error("[Operator WS] error", err);

  return {
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export const usePodsExecution = (podId: string | null) => {
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: "idle",
    progress: 0,
    logs: [],
    results: {},
  });

  const wsRef = useRef<{ close: () => void } | null>(null);
  const clientIdRef = useRef(uuidv4());
  const storeOperatorUrl = usePodsStore((s) => s.operatorUrl);
  const opUrl = effectiveOperatorUrl(storeOperatorUrl);

  // ── fetchResults ──────────────────────────────────────────────────────────
  const fetchResults = useCallback(
    async (
      promptId: string,
      workflowFilename: string,
      resolvedOpUrl: string,
      resolvedPodId: string,
    ) => {
      try {
        const history = await opGetHistory(resolvedOpUrl, resolvedPodId, promptId);
        const entry = history[promptId];
        if (!entry) throw new Error("No history entry found");

        const resultsMap: Record<string, any> = {};

        for (const [, nodeOutput] of Object.entries(entry.outputs ?? {}) as [string, any][]) {
          for (const img of (nodeOutput.images ?? nodeOutput.gifs ?? [])) {
            const url = opOutputUrl(resolvedOpUrl, resolvedPodId, img.filename, img.subfolder, img.type);
            resultsMap[img.filename] = {
              content_type: "image/png",
              data: url,
              download_url: url,
              filename: img.filename,
              label: img.filename,
              run_id: promptId,
            };
          }

          for (const text of (nodeOutput.text ?? [])) {
            const fname = typeof text === "string" ? text : String(text);
            const ext = fname.split(".").pop()?.toLowerCase() ?? "";
            const is3D = ["obj", "glb", "gltf", "fbx", "stl", "ply", "usdz"].includes(ext);
            if (is3D) {
              const modelUrl = opOutputUrl(resolvedOpUrl, resolvedPodId, fname, "", "output");
              resultsMap[fname] = {
                content_type: `model/${ext}`,
                data: modelUrl,
                download_url: modelUrl,
                filename: fname,
                label: fname,
                run_id: promptId,
              };
            }
          }
        }

        setExecutionState({
          status: "completed",
          progress: 100,
          logs: ["Workflow submitted", `Prompt ID: ${promptId}`, "Execution completed successfully"],
          results: resultsMap,
          run_id: promptId,
        });

        wsRef.current?.close();
        wsRef.current = null;
      } catch (err: any) {
        setExecutionState((prev) => ({
          ...prev,
          status: "error",
          error: err.message ?? "Failed to fetch results",
          logs: [...prev.logs, `Error fetching results: ${err.message}`],
        }));
        wsRef.current?.close();
        wsRef.current = null;
      }
    },
    [],
  );

  // ── executeWorkflow ───────────────────────────────────────────────────────
  const executeWorkflow = useCallback(
    async (workflowId: string, inputs: Record<string, any>) => {
      try {
        setExecutionState({
          status: "submitting",
          progress: 0,
          logs: ["Loading workflow..."],
          results: {},
        });

        if (!podId) throw new Error("No pod selected. Please select a pod in the top bar.");
        if (!opUrl) throw new Error("No operator available. Start creativeflow-electron or set an operator URL.");

        // 1. Load workflow via operator
        const filename = workflowId.replace(/^comfyui:/, "");
        const rawWorkflow = await opLoadWorkflow(opUrl, podId, filename);

        // 2. Convert graph → API format if needed
        let workflow: Record<string, any>;
        if (Array.isArray(rawWorkflow?.nodes)) {
          const converted = graphToApiFormat(rawWorkflow);
          if (!converted) throw new Error("Failed to convert workflow to API format");
          const objectInfo = await opGetObjectInfo(opUrl, podId);
          resolveWidgetValues(converted, objectInfo);
          // Filter out visual-only nodes (e.g. Note, MarkdownNote) not present in objectInfo
          for (const nodeId of Object.keys(converted)) {
            if (!objectInfo[converted[nodeId].class_type]) {
              delete converted[nodeId];
            }
          }
          workflow = converted;
        } else {
          workflow = rawWorkflow;
        }

        // 3. Upload File inputs via operator
        for (const [paramKey, value] of Object.entries(inputs)) {
          const [nodeId, inputName] = paramKey.split("::");
          if (!nodeId || !inputName || !workflow[nodeId]) continue;
          if (value instanceof File) {
            const uploaded = await opUploadImage(opUrl, podId, value);
            workflow[nodeId].inputs[inputName] = uploaded;
          } else {
            workflow[nodeId].inputs[inputName] = value;
          }
        }

        // 4. Connect to operator WS tunnel before queuing
        const clientId = clientIdRef.current;
        let promptId: string | null = null;

        const wsController = opConnectWS(opUrl, podId, clientId, (msg) => {
          if (msg.type === "progress") {
            const pct = msg.data.max
              ? Math.round((msg.data.value / msg.data.max) * 100)
              : 0;
            setExecutionState((prev) => ({
              ...prev,
              status: "running",
              progress: pct,
              logs: [...prev.logs, `Progress: ${pct}%`],
            }));
          }

          if (msg.type === "executing") {
            if (msg.data.node === null) {
              if (promptId) fetchResults(promptId, filename, opUrl!, podId!);
            } else {
              setExecutionState((prev) => ({
                ...prev,
                status: "running",
                logs: [...prev.logs, `Executing node: ${msg.data.node}`],
              }));
            }
          }

          // Cached runs skip `executing` and go straight to `execution_success`
          if (msg.type === "execution_success") {
            if (promptId) fetchResults(promptId, filename, opUrl!, podId!);
          }

          if (msg.type === "execution_error") {
            setExecutionState((prev) => ({
              ...prev,
              status: "error",
              error: msg.data.exception_message ?? "Execution error",
              logs: [...prev.logs, `Error: ${msg.data.exception_message ?? "Unknown error"}`],
            }));
            wsController.close();
          }
        });

        wsRef.current = wsController;

        // 5. Queue prompt via operator
        setExecutionState((prev) => ({
          ...prev,
          logs: [...prev.logs, "Submitting to operator..."],
        }));

        promptId = await opQueuePrompt(opUrl, podId, workflow, clientId);

        setExecutionState((prev) => ({
          ...prev,
          status: "running",
          run_id: promptId!,
          logs: [...prev.logs, `Prompt queued: ${promptId}`],
        }));

        // Fallback: poll history in case the WS completion event was missed
        // (fast workflows can finish before the WS tunnel is fully established)
        const capturedPromptId = promptId;
        const capturedOpUrl = opUrl;
        const capturedPodId = podId;
        const pollHistory = async () => {
          for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            // If already completed via WS, stop polling
            if (!wsRef.current) return;
            try {
              const history = await opGetHistory(capturedOpUrl, capturedPodId, capturedPromptId);
              const entry = history[capturedPromptId];
              if (entry?.status?.status_str === "success" || entry?.status?.completed === true) {
                fetchResults(capturedPromptId, filename, capturedOpUrl, capturedPodId);
                return;
              }
            } catch {
              // ignore transient errors
            }
          }
        };
        pollHistory();
      } catch (error: any) {
        setExecutionState({
          status: "error",
          progress: 0,
          logs: [`Error: ${error.message ?? "Failed to execute workflow"}`],
          results: {},
          error: error.message ?? "Failed to execute workflow",
        });
      }
    },
    [podId, opUrl, fetchResults],
  );

  // ── cancelWorkflow ────────────────────────────────────────────────────────
  const cancelWorkflow = useCallback(async () => {
    try {
      if (opUrl && podId) {
        await opFetch(opUrl, podId, "/interrupt", { method: "POST" });
      }
      setExecutionState((prev) => ({
        ...prev,
        status: "error",
        error: "Workflow execution cancelled",
        logs: [...prev.logs, "Workflow execution cancelled"],
      }));
    } catch (err: any) {
      console.error("Cancel error:", err);
    } finally {
      wsRef.current?.close();
      wsRef.current = null;
    }
  }, [opUrl, podId]);

  // ── reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    clientIdRef.current = uuidv4();
    setExecutionState({ status: "idle", progress: 0, logs: [], results: {} });
  }, []);

  return { executionState, executeWorkflow, cancelWorkflow, reset };
};
