"use client";

// EIOS: Canvas execution uses the same POST→poll pattern as the apps and
// build-tool pages. All work happens server-side via /api/tools/[id]/executions,
// then we poll /api/comfy/[port]/history/[promptId] (through the CORS-free proxy)
// until the job completes.

import { useState, useCallback, useRef } from "react";
import type { ExecutionState } from "../types";
import { localSaveRun } from "@/lib/local-db";
import type { RunItem } from "@/features/canvases/api/getAllRunsList";

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

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const executeWorkflow = useCallback(
    async (workflowId: string, inputs: Record<string, any>) => {
      abortRef.current = false;
      clearPoll();

      if (!workflowId.startsWith("eios:")) {
        setExecutionState({
          status: "error",
          progress: 0,
          logs: [`Unsupported workflow format: ${workflowId}`],
          results: {},
          error: `Unsupported workflow format: ${workflowId}`,
        });
        return;
      }

      const toolId = workflowId.slice("eios:".length);

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

      try {
        const res = await fetch(`/api/tools/${toolId}/executions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: apiInputs }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to start" }));
          throw new Error((err as any).error || "Failed to start execution");
        }

        ({ executionId, promptId, comfyPort, seed } = await res.json());
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
            outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
          }>;

          const entry = hist[promptId];
          if (!entry?.status?.completed) return;

          clearPoll();

          // Build results map
          const resultsMap: Record<string, any> = {};
          for (const nodeOut of Object.values(entry.outputs ?? {})) {
            for (const img of nodeOut.images ?? []) {
              const params = new URLSearchParams({
                filename: img.filename,
                subfolder: img.subfolder || "",
                type: img.type || "output",
              });
              const url = `/api/comfy/${comfyPort}/view?${params}`;
              resultsMap[img.filename] = {
                content_type: "image/png",
                data: url,
                download_url: url,
                filename: img.filename,
                label: img.filename,
                run_id: promptId,
              };
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

          // Persist to SQLite via API
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
          }).catch(console.error);

          // Save run to IndexedDB for RunsHistoryPanel
          if (!isError) {
            const now = new Date().toISOString();
            const run: RunItem = {
              _id: promptId,
              pod_id: "local",
              cluster_id: "local",
              team_id: "local",
              project_id: "local",
              workflow_id: `eios:${toolId}`,
              group_id: "STUDIO",
              status: "completed",
              trigger_type: "manual",
              inputs: [],
              canvas_id: null,
              output_metadata: [],
              outputs: Object.values(resultsMap).map((r: any) => ({
                filename: r.filename,
                url: r.download_url,
                content_type: r.content_type,
                label: r.label,
              })),
              error: null,
              execution_time_ms: null,
              started_at: now,
              completed_at: now,
              created_at: now,
              updated_at: now,
              container_id: "",
              prompt_id: promptId,
              progress: 100,
              can_regenerate: true,
              project_name: "EIOS",
              workflow_name: toolId,
              regenerations: [],
            };
            localSaveRun(run).catch(console.error);
          }
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
    setExecutionState({
      status: "idle",
      progress: 0,
      logs: [],
      results: {},
    });
  }, []);

  return { executionState, executeWorkflow, cancelWorkflow, reset };
};
