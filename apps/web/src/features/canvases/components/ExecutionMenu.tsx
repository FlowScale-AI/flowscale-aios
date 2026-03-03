"use client";
import { Icon } from "@iconify/react";
import { Spinner } from "phosphor-react";
import { useState, useEffect, useCallback } from "react";
import ResultsPill from "./ResultsPill";
import RunsHistoryPanel from "./RunsHistoryPanel";
import { ExecutionState } from "../types";
import { Tooltip } from "@flowscale/ui";

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
}

export default function ExecutionMenu({
  executionState,
  activeToolId,
  projectId,
  onRunGeneration,
  onStopGeneration,
  onResultDragStart,
  onReset,
}: ExecutionMenuProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

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

  return (
    <>
      {/* Results Pill - show accumulated results */}
      {Object.keys(accumulatedResults).length > 0 && (
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
      {(executionState.status === "submitting" ||
        executionState.status === "running") && (
        <div className="absolute bottom-10 right-6 z-20">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-sm min-w-[320px] max-w-md">
            <div className="space-y-3">
              {/* Progress Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Spinner className="w-4 h-4 text-emerald-500 animate-spin" />
                  <span className="text-sm text-white font-medium">
                    {executionState.status === "submitting"
                      ? "Submitting..."
                      : "Generating..."}
                  </span>
                </div>
                <span className="text-xs text-zinc-500">
                  {executionState.progress}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${executionState.progress}%` }}
                />
              </div>

              {/* Logs */}
              <div className="max-h-24 overflow-y-auto custom-scrollbar space-y-1">
                {executionState.logs.slice(-5).map((log, i) => (
                  <div
                    key={i}
                    className="text-xs text-zinc-400 font-mono truncate"
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
                <Icon icon="solar:play-circle-bold" className="pointer-events-none" />
                Run Generation
              </button>
            </Tooltip>
          )}
          <div className="w-px h-5 bg-white/10" />

          {/* History Button — pointer-events-none on Icon so click fires on button, not SVG internals */}
          <Tooltip content="Generation History" side="top">
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="p-1 rounded-full transition-colors text-zinc-400 hover:text-white hover:bg-white/10"
            >
              <Icon icon="solar:clock-circle-bold" width="18" className="pointer-events-none" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Runs History Panel */}
      <RunsHistoryPanel
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        projectId={projectId}
        onOutputDragStart={onResultDragStart}
      />
    </>
  );
}
