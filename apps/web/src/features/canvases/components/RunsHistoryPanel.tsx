"use client";

import { Icon } from "@iconify/react";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  getAllRunsList,
  RunItem,
  RunOutput,
  RunsListResponse,
} from "../api/getAllRunsList";
import { Spinner, X } from "phosphor-react";

interface RunsHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOutputDragStart: (filename: string, result: any) => void;
}

const PAGE_SIZE = 12;

export default function RunsHistoryPanel({
  isOpen,
  onClose,
  onOutputDragStart,
}: RunsHistoryPanelProps) {
  const projectId = "local";
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const hasReachedEndRef = useRef(false);
  hasReachedEndRef.current = hasReachedEnd;

  const fetchRuns = useCallback(
    async (page: number, append = false) => {
      if (!projectId) return;
      if (page !== 1 && hasReachedEndRef.current) return;

      if (page === 1) {
        setIsLoading(true);
        setHasReachedEnd(false);
        hasReachedEndRef.current = false;
      } else {
        setIsLoadingMore(true);
      }
      setHasError(false);

      try {
        const response = (await getAllRunsList({
          filter_by: "project_id",
          filter_value: projectId,
          category: "api",
          page_size: PAGE_SIZE,
          page_number: page,
        })) as any;

        if (response?.data) {
          // Filter to only show runs with group_id: "STUDIO"
          const studioRuns =
            response?.data?.filter(
              (run: RunItem) => run.group_id === "STUDIO",
            ) || [];

          if (append) {
            setRuns((prev) => [...prev, ...studioRuns]);
          } else {
            setRuns(studioRuns);
          }

          // If we got fewer runs than PAGE_SIZE, we've reached the end of all data
          if (response.data.length < PAGE_SIZE) {
            setHasReachedEnd(true);
            hasReachedEndRef.current = true;
          }

          setTotalPages(response.total_pages || 1);
        }
      } catch {
        setHasError(true);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [projectId],
  );

  // Fetch initial data when panel opens
  useEffect(() => {
    if (isOpen && projectId) {
      setPageNumber(1);
      setRuns([]);
      setHasReachedEnd(false);
      hasReachedEndRef.current = false;
      fetchRuns(1, false);
    }
  }, [isOpen, projectId, fetchRuns]);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingMore || isLoading || hasReachedEnd) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    // Load more when user is within 100px of the bottom
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      if (pageNumber < totalPages) {
        const nextPage = pageNumber + 1;
        setPageNumber(nextPage);
        fetchRuns(nextPage, true);
      }
    }
  }, [
    pageNumber,
    totalPages,
    isLoadingMore,
    isLoading,
    hasReachedEnd,
    fetchRuns,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Stop wheel events from bubbling to the canvas native listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    container.addEventListener("wheel", stop, { passive: false });
    return () => container.removeEventListener("wheel", stop);
  }, []);

  const getOutputType = (
    output: RunOutput,
  ): "image" | "video" | "text" | "audio" | "model3d" => {
    const contentType = output.content_type || "";
    const filename = output.filename || "";
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    if (contentType.startsWith("audio/")) return "audio";
    if (
      contentType.startsWith("model/") ||
      /\.(glb|gltf|obj|fbx|stl|3ds|dae|ply)$/i.test(filename)
    )
      return "model3d";
    return "text";
  };

  const getOutputIcon = (
    type: "image" | "video" | "text" | "audio" | "model3d",
  ) => {
    switch (type) {
      case "image":
        return "solar:gallery-bold";
      case "video":
        return "solar:video-library-bold";
      case "audio":
        return "solar:music-library-2-bold";
      case "model3d":
        return "solar:box-minimalistic-bold";
      case "text":
        return "solar:document-text-bold";
    }
  };

  const handleDragStart = (
    e: React.DragEvent,
    output: RunOutput,
    runId: string,
  ) => {
    const type = getOutputType(output);
    const contentType =
      output.content_type ||
      (type === "text" ? "text/plain" : "application/octet-stream");

    // Build a result object compatible with the existing onResultDragStart
    const result = {
      content_type: contentType,
      data: type === "text" ? output.data || "" : "",
      filename: output.filename,
      label: output.label || output.filename,
      size: output.size,
      download_url: output.url || "",
      run_id: runId,
      // kind will be determined in handleResultDrop based on content_type
    };

    // Set drag data
    e.dataTransfer.setData("text/plain", output.filename);
    e.dataTransfer.effectAllowed = "copy";

    onOutputDragStart(output.filename, result);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const renderOutputPreview = (output: RunOutput) => {
    const type = getOutputType(output);

    const displayUrl = output.url;

    if (type === "image" && displayUrl) {
      return (
        <img
          src={displayUrl}
          alt={output.label || output.filename}
          className="w-full h-full object-cover rounded-lg"
          loading="lazy"
          draggable={false}
        />
      );
    }

    if (type === "video" && displayUrl) {
      return (
        <video
          src={displayUrl}
          className="w-full h-full object-cover rounded-lg"
          muted
          loop
          playsInline
          preload="metadata"
          draggable={false}
          onMouseEnter={(e) => {
            const video = e.currentTarget;
            video.play().catch(() => {});
          }}
          onMouseLeave={(e) => {
            const video = e.currentTarget;
            video.pause();
            video.currentTime = 0;
          }}
        />
      );
    }

    if (type === "audio") {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800/50 rounded-lg p-2 gap-2">
          <Icon
            icon="solar:music-library-2-bold"
            width="24"
            className="text-emerald-500"
          />
          <span className="text-[10px] text-zinc-400 truncate max-w-full px-1">
            {output.label || output.filename || "Audio"}
          </span>
        </div>
      );
    }

    if (type === "model3d") {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800/50 rounded-lg p-2 gap-2">
          <Icon
            icon="solar:box-minimalistic-bold"
            width="24"
            className="text-violet-500"
          />
          <span className="text-[10px] text-zinc-400 truncate max-w-full px-1">
            {output.label || output.filename || "3D Model"}
          </span>
        </div>
      );
    }

    if (type === "text") {
      return (
        <div className="w-full h-full flex items-center justify-center p-3 bg-zinc-800/50 rounded-lg overflow-hidden">
          <p className="text-xs text-zinc-400 line-clamp-4 wrap-break-word whitespace-pre-wrap">
            {output.data || "No text content"}
          </p>
        </div>
      );
    }

    return (
      <div className="w-full h-full flex items-center justify-center bg-zinc-800/50 rounded-lg">
        <Icon icon="solar:file-bold" width="32" className="text-zinc-600" />
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 h-full z-30 flex">
      {/* Backdrop - click to close */}
      <div className="fixed inset-0 z-29" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-30 w-85 h-full bg-[#0a0a0a] border-l border-white/10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Icon
              icon="solar:clock-circle-bold"
              width="18"
              className="text-zinc-400"
            />
            <span className="text-sm font-medium text-white">
              Generation History
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
          >
            <X width="18" />
          </button>
        </div>

        {/* Content */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3"
        >
          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Spinner size={16} className="text-zinc-500 animate-spin" />

              <span className="text-xs text-zinc-500">
                Loading generation history...
              </span>
            </div>
          )}

          {/* Error state */}
          {hasError && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Icon
                icon="solar:danger-circle-bold"
                width="24"
                className="text-red-500"
              />
              <span className="text-xs text-zinc-500">
                Failed to load history
              </span>
              <button
                onClick={() => {
                  setPageNumber(1);
                  fetchRuns(1, false);
                }}
                className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !hasError && runs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Icon
                icon="solar:clock-circle-linear"
                width="32"
                className="text-zinc-600"
              />
              <span className="text-xs text-zinc-500">No generations yet</span>
              <span className="text-xs text-zinc-600 text-center px-4">
                Run a generation to see outputs here
              </span>
            </div>
          )}

          {/* Runs list */}
          {!isLoading &&
            runs.map((run) => {
              // Filter to only completed runs with outputs
              if (run.status !== "completed" || !run.outputs?.length)
                return null;

              return (
                <div key={run._id} className="space-y-2">
                  {/* Run header */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-zinc-500 truncate">
                        {run.workflow_name}
                      </span>
                      <span className="text-[10px] text-zinc-600">•</span>
                      <span className="text-[10px] text-zinc-600">
                        {formatDate(run.completed_at || run.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">
                        {run.outputs.length} output
                        {run.outputs.length > 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Outputs grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {run.outputs.map((output, idx) => {
                      const type = getOutputType(output);
                      return (
                        <div
                          key={`${run._id}-${idx}`}
                          draggable
                          onDragStart={(e) =>
                            handleDragStart(e, output, run._id)
                          }
                          className="group relative aspect-square rounded-lg overflow-hidden border border-white/5 hover:border-white/20 transition-all cursor-grab active:cursor-grabbing hover:shadow-lg hover:shadow-black/20"
                          title={`Drag to add to canvas — ${output.label || output.filename}`}
                        >
                          {renderOutputPreview(output)}

                          {/* Overlay with type badge */}
                          <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="absolute bottom-0 left-0 right-0 p-2">
                              <div className="flex items-center gap-1">
                                <Icon
                                  icon={getOutputIcon(type)}
                                  width="12"
                                  className="text-white/80"
                                />
                                <span className="text-[10px] text-white/80 truncate">
                                  {output.label || output.filename}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Drag indicator */}
                          <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/60 backdrop-blur-sm rounded p-0.5">
                              <Icon
                                icon="solar:move-to-folder-bold"
                                width="14"
                                className="text-white/70"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {/* Loading more indicator */}
          {isLoadingMore && (
            <div className="flex items-center justify-center py-4">
              <Spinner size={16} className="text-zinc-500 animate-spin" />
              <span className="text-xs text-zinc-500 ml-2">
                Loading more...
              </span>
            </div>
          )}

          {/* End of list */}
          {!isLoading && !isLoadingMore && runs.length > 0 && hasReachedEnd && (
            <div className="text-center py-3">
              <span className="text-[10px] text-zinc-600">
                All generations loaded
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
