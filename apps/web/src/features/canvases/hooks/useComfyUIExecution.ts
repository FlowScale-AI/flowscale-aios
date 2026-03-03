import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ExecutionState } from "../types";
import {
  loadWorkflow,
  uploadImage,
  queuePrompt,
  getHistory,
  getOutputUrl,
  getObjectInfo,
  connectWS,
} from "@/lib/comfyui-client";
import { graphToApiFormat, resolveWidgetValues } from "@/lib/comfyui-tool-mapper";

/**
 * Drop-in replacement for useToolExecution that talks to a local ComfyUI
 * instance instead of the FlowScale cloud API.
 *
 * Returns the same { executionState, executeWorkflow, cancelWorkflow, reset }
 * shape so CanvasSurface doesn't need conditional rendering.
 */
export const useComfyUIExecution = () => {
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: "idle",
    progress: 0,
    logs: [],
    results: {},
  });

  const wsRef = useRef<{ close: () => void } | null>(null);
  const clientIdRef = useRef(uuidv4());

  const executeWorkflow = useCallback(
    async (workflowId: string, inputs: Record<string, any>) => {
      try {
        setExecutionState({
          status: "submitting",
          progress: 0,
          logs: ["Loading workflow..."],
          results: {},
        });

        // workflowId is "comfyui:<filename>"
        const filename = workflowId.replace(/^comfyui:/, "");
        const rawWorkflow = await loadWorkflow(filename);

        // Convert graph format → API format if needed
        let workflow: Record<string, any>;
        if (Array.isArray(rawWorkflow?.nodes)) {
          const converted = graphToApiFormat(rawWorkflow);
          if (!converted) throw new Error("Failed to convert workflow to API format");
          const objectInfo = await getObjectInfo();
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

        // ── 1. Upload File inputs & inject values ───────────────────────
        for (const [paramKey, value] of Object.entries(inputs)) {
          // paramKey format: "nodeId::inputName"
          const [nodeId, inputName] = paramKey.split("::");
          if (!nodeId || !inputName || !workflow[nodeId]) continue;

          if (value instanceof File) {
            const uploaded = await uploadImage(value);
            workflow[nodeId].inputs[inputName] = uploaded;
          } else {
            workflow[nodeId].inputs[inputName] = value;
          }
        }

        // ── 2. Connect WebSocket before submitting ──────────────────────
        const clientId = clientIdRef.current;
        let promptId: string | null = null;

        const wsController = connectWS(clientId, (msg) => {
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
              // Execution complete – fetch results
              if (promptId) fetchResults(promptId, filename);
            } else {
              setExecutionState((prev) => ({
                ...prev,
                status: "running",
                logs: [
                  ...prev.logs,
                  `Executing node: ${msg.data.node}`,
                ],
              }));
            }
          }

          if (msg.type === "execution_error") {
            setExecutionState((prev) => ({
              ...prev,
              status: "error",
              error: msg.data.exception_message || "Execution error",
              logs: [
                ...prev.logs,
                `Error: ${msg.data.exception_message || "Unknown error"}`,
              ],
            }));
            wsController.close();
          }
        });

        wsRef.current = wsController;

        // ── 3. Queue the prompt ─────────────────────────────────────────
        setExecutionState((prev) => ({
          ...prev,
          logs: [...prev.logs, "Submitting to ComfyUI..."],
        }));

        promptId = await queuePrompt(workflow, clientId);

        setExecutionState((prev) => ({
          ...prev,
          status: "running",
          run_id: promptId!,
          logs: [...prev.logs, `Prompt queued: ${promptId}`],
        }));
      } catch (error: any) {
        const errorMessage = error.message || "Failed to execute workflow";
        setExecutionState({
          status: "error",
          progress: 0,
          logs: [`Error: ${errorMessage}`],
          results: {},
          error: errorMessage,
        });
      }
    },
    [],
  );

  // ── Fetch results once execution_complete ───────────────────────────────
  const fetchResults = useCallback(
    async (promptId: string, workflowFilename: string) => {
      try {
        const history = await getHistory(promptId);
        const entry = history[promptId];
        if (!entry) throw new Error("No history entry found");

        const resultsMap: Record<string, any> = {};

        // entry.outputs is { nodeId: { images: [...], text: [...], ... } }
        for (const [_nodeId, nodeOutput] of Object.entries(entry.outputs || {}) as [string, any][]) {
          // Handle image/gif outputs
          const images = nodeOutput.images || nodeOutput.gifs || [];
          for (const img of images) {
            const url = getOutputUrl(img.filename, img.subfolder, img.type);
            const key = img.filename;
            resultsMap[key] = {
              content_type: img.type === "output" ? "image/png" : "image/png",
              data: url,
              download_url: url,
              filename: img.filename,
              label: img.filename,
              run_id: promptId,
            };
          }

          // Handle 3D model / text outputs (e.g. FSHunyuan3DGenerate returns { text: [filename] })
          const textOutputs = nodeOutput.text || [];
          for (const text of textOutputs) {
            const filename = typeof text === "string" ? text : String(text);
            const ext = filename.split(".").pop()?.toLowerCase() || "";
            const is3D = ["obj", "glb", "gltf", "fbx", "stl", "ply", "usdz"].includes(ext);
            if (is3D) {
              const baseName = filename.replace(/\.[^.]+$/, "");

              // Use GLB format for model-viewer (supports interactive 3D), fallback to download URL
              const modelUrl = getOutputUrl(filename, "", "output");
              resultsMap[filename] = {
                content_type: ext === "glb" || ext === "gltf" ? `model/${ext}` : `model/${ext}`,
                data: modelUrl,
                download_url: modelUrl,
                filename,
                label: filename,
                run_id: promptId,
              };

              // Also add the preview thumbnail if it exists (saved as _preview.png by FSHunyuan3DGenerate)
              const previewFilename = `${baseName}_preview.png`;
              const previewUrl = getOutputUrl(previewFilename, "", "output");
              resultsMap[previewFilename] = {
                content_type: "image/png",
                data: previewUrl,
                download_url: previewUrl,
                filename: previewFilename,
                label: `${baseName} preview`,
                run_id: promptId,
              };
            }
          }
        }

        setExecutionState({
          status: "completed",
          progress: 100,
          logs: [
            "Workflow submitted",
            `Prompt ID: ${promptId}`,
            "Execution completed successfully",
          ],
          results: resultsMap,
          run_id: promptId,
        });

        // Clean up WebSocket
        wsRef.current?.close();
        wsRef.current = null;
      } catch (err: any) {
        setExecutionState((prev) => ({
          ...prev,
          status: "error",
          error: err.message || "Failed to fetch results",
          logs: [
            ...prev.logs,
            `Error fetching results: ${err.message}`,
          ],
        }));
        wsRef.current?.close();
        wsRef.current = null;
      }
    },
    [],
  );

  const cancelWorkflow = useCallback(async () => {
    try {
      // ComfyUI interrupt endpoint
      const base =
        typeof window !== "undefined"
          ? localStorage.getItem("flowscale_comfyui_url") || "http://localhost:8188"
          : "http://localhost:8188";
      await fetch(`${base}/interrupt`, { method: "POST" });

      setExecutionState((prev) => ({
        ...prev,
        status: "error",
        error: "Workflow execution cancelled",
        logs: [...prev.logs, "Workflow execution cancelled"],
      }));
    } catch (error: any) {
      console.error("Cancel error:", error);
    } finally {
      wsRef.current?.close();
      wsRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    clientIdRef.current = uuidv4();
    setExecutionState({
      status: "idle",
      progress: 0,
      logs: [],
      results: {},
    });
  }, []);

  return {
    executionState,
    executeWorkflow,
    cancelWorkflow,
    reset,
  };
};
