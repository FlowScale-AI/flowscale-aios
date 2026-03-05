"use client";
import { Icon } from "@iconify/react";
import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ResultsPill from "./ResultsPill";
import RunsHistoryPanel from "./RunsHistoryPanel";
import { ExecutionState } from "../types";
import { Tooltip, LottieSpinner } from "@/components/ui";
import { ComfyLogsPanel } from "@/components/ComfyLogsPanel";
import { X } from "phosphor-react";

interface ResultItem {
  content_type: string;
  data: string;
  filename: string;
  label: string;
  size?: number;
  download_url?: string;
  run_id?: string | null;
}

interface ExecutionMenuProps {
  executionState: ExecutionState;
  activeToolId?: string;
  projectId?: string;
  onRunGeneration: () => void;
  onStopGeneration: () => void;
  onResultDragStart: (filename: string, result: any) => void;
  onReset: () => void;
  readOnly?: boolean;
}

export default function ExecutionMenu({
  executionState,
  activeToolId,
  projectId,
  onRunGeneration,
  onStopGeneration,
  onResultDragStart,
  onReset,
  readOnly = false,
}: ExecutionMenuProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const comfyPort =
    typeof window !== "undefined"
      ? (() => {
          const url =
            localStorage.getItem("flowscale_comfyui_url") ||
            "http://localhost:8188";
          try {
            return Number(new URL(url).port || 8188);
          } catch {
            return 8188;
          }
        })()
      : 8188;

  // Accumulated results from all generations
  const [accumulatedResults, setAccumulatedResults] = useState<
    Record<string, ResultItem>
  >({});

  // Merge new results when execution completes
  useEffect(() => {
    if (
      executionState.status === "completed" &&
      Object.keys(executionState.results).length > 0
    ) {
      setAccumulatedResults((prev) => ({
        ...prev,
        ...executionState.results,
      }));
    }
  }, [executionState.status, executionState.results]);

  // Handle removing a single result
  const handleRemoveResult = useCallback((filename: string) => {
    setAccumulatedResults((prev) => {
      const updated = { ...prev };
      delete updated[filename];
      return updated;
    });
  }, []);

  // Handle clearing all results
  const handleClearAll = useCallback(() => {
    setAccumulatedResults({});
    onReset();
  }, [onReset]);

  const isExecuting =
    executionState.status === "submitting" ||
    executionState.status === "running";

  return (
    <>
      {/* Results Pill - show accumulated results */}
      {!readOnly && Object.keys(accumulatedResults).length > 0 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-20">
          <ResultsPill
            results={accumulatedResults}
            onDragStart={onResultDragStart}
            onRemoveResult={handleRemoveResult}
            onClearAll={handleClearAll}
          />
        </div>
      )}

      {/* Execution Progress */}
      <AnimatePresence>
        {isExecuting && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute bottom-10 right-6 z-20"
          >
            <div className="bg-[#111] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-sm min-w-[320px] max-w-md">
              <div className="space-y-3">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <LottieSpinner size={16} />
                  <span className="text-sm text-white font-medium">
                    {executionState.status === "submitting"
                      ? "Submitting..."
                      : "Generating..."}
                  </span>
                </div>

                {/* Logs */}
                <div className="max-h-24 overflow-y-auto custom-scrollbar space-y-1">
                  {executionState.logs.slice(-5).map((log, i) => (
                    <div
                      key={i}
                      className="text-xs text-zinc-400 font-mono-custom truncate"
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Display */}
      {executionState.status === "error" && executionState.error && (
        <div className="absolute bottom-5 left-5 z-20">
          <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-sm min-w-[320px] max-w-md">
            <div className="flex items-start gap-2">
              <Icon
                icon="solar:danger-circle-bold"
                className="text-red-500 shrink-0 mt-0.5"
                width="16"
              />
              <div className="flex-1">
                <div className="text-sm text-red-300 font-medium mb-1">
                  Execution Failed
                </div>
                <div className="text-xs text-red-400">
                  {executionState.error}
                </div>
              </div>
              <button
                onClick={onReset}
                className="text-xs text-red-400 hover:text-red-300"
              >
                <Icon icon="solar:close-circle-linear" width="16" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control Button */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-2 bg-[#111] border border-white/10 rounded-full p-2 px-3 shadow-2xl backdrop-blur-sm transition-transform hover:scale-105 active:scale-95 duration-200">
          {!readOnly && (
            <>
              {executionState.status === "submitting" ||
              executionState.status === "running" ? (
                <button
                  onClick={onStopGeneration}
                  className="bg-red-600 hover:bg-red-500 text-white rounded-full px-4 py-1.5 text-xs font-medium flex items-center gap-2 transition-colors shadow-[0_0_20px_rgba(220,38,38,0.3)] hover:shadow-[0_0_25px_rgba(220,38,38,0.5)]"
                >
                  <Icon icon="solar:stop-circle-bold" />
                  Stop Generation
                </button>
              ) : (
                <Tooltip
                  content={
                    !activeToolId ? "Select a tool to enable" : "Run Generation"
                  }
                  side="top"
                >
                  <button
                    onClick={onRunGeneration}
                    disabled={!activeToolId}
                    className={`rounded-full px-4 py-1.5 text-xs font-medium flex items-center gap-2 transition-colors ${
                      activeToolId
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(5,150,105,0.3)] hover:shadow-[0_0_25px_rgba(5,150,105,0.5)]"
                        : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                    }`}
                  >
                    <Icon
                      icon="solar:play-circle-bold"
                      className="pointer-events-none"
                    />
                    Run Generation
                  </button>
                </Tooltip>
              )}
              <div className="w-px h-5 bg-white/10" />

              {/* History Button */}
              <Tooltip content="Generation History" side="top">
                <button
                  onClick={() => {
                    setIsHistoryOpen(true);
                    setIsLogsOpen(false);
                  }}
                  className="p-1 rounded-full transition-colors text-zinc-400 hover:text-white hover:bg-white/10"
                >
                  <Icon
                    icon="solar:clock-circle-bold"
                    width="18"
                    className="pointer-events-none"
                  />
                </button>
              </Tooltip>
            </>
          )}

          {/* Logs Button */}
          {!readOnly && (
            <>
              <div className="w-px h-5 bg-white/10" />
              <Tooltip content="ComfyUI Logs" side="top">
                <button
                  onClick={() => {
                    setIsLogsOpen(true);
                    setIsHistoryOpen(false);
                  }}
                  className="p-1 rounded-full transition-colors text-zinc-400 hover:text-white hover:bg-white/10"
                >
                  <Icon
                    icon="solar:monitor-smartphone-bold"
                    width="18"
                    className="pointer-events-none"
                  />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Runs History Panel */}
      <RunsHistoryPanel
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        projectId={projectId}
        onOutputDragStart={onResultDragStart}
      />

      {/* ComfyUI Logs Panel */}
      {isLogsOpen && (
        <div className="fixed top-0 right-0 h-full z-30 flex">
          <div
            className="fixed inset-0 z-29"
            onClick={() => setIsLogsOpen(false)}
          />
          <div className="relative z-30 w-96 h-full bg-[#0a0a0a] border-l border-white/10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Icon
                  icon="solar:monitor-smartphone-bold"
                  width="18"
                  className="text-zinc-400"
                />
                <span className="text-sm font-medium text-white">
                  ComfyUI Logs
                </span>
              </div>
              <button
                onClick={() => setIsLogsOpen(false)}
                className="p-1 rounded-md hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3">
              <ComfyLogsPanel port={comfyPort} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
