"use client";
import { CanvasTool } from "@/features/canvases/types";
import { ArrowsClockwise, Wrench } from "phosphor-react";
import { useMemo } from "react";
import { LottieSpinner } from "@/components/ui";

interface ToolCategoriesProps {
  toolsData: any;
  isToolsLoading: boolean;
  onSelectTool: (toolId: string) => void;
  activeToolId?: string;
  isExecuting?: boolean;
  onSync?: () => void;
  isSyncing?: boolean;
}

export default function ToolCategories({
  toolsData,
  isToolsLoading: isLoading,
  onSelectTool,
  activeToolId,
  isExecuting = false,
  onSync,
  isSyncing = false,
}: ToolCategoriesProps) {
  // Group tools by project_name
  const groupedTools = useMemo(() => {
    if (!toolsData?.tools) return {};

    return toolsData.tools.reduce(
      (acc: any, tool: any) => {
        const category = tool.project_name || "Uncategorized";
        if (!acc[category]) acc[category] = [];
        acc[category].push(tool);
        return acc;
      },
      {} as Record<string, CanvasTool[]>,
    );
  }, [toolsData]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full w-64 p-4">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2">
            <LottieSpinner size={24} />
            <div className="text-xs text-zinc-500">Loading tools...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background-panel border-r border-white/5 w-64 shrink-0">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-500 tracking-wider">
          TOOLS
        </h3>
        {onSync && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="p-1 text-zinc-600 hover:text-emerald-400 transition-colors rounded hover:bg-white/5 disabled:opacity-50"
            title="Sync workflows"
          >
            <ArrowsClockwise
              className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`}
            />
          </button>
        )}
      </div>

      {Object.keys(groupedTools).length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2">
            <Wrench className="w-6 h-6 text-zinc-500" />
            <div className="text-xs text-zinc-500">No tools found</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-6 custom-scrollbar">
          {Object.entries(groupedTools).map(([category, tools]: any) => (
            <div key={category}>
              <h4 className="px-2 mb-2 text-[10px] text-zinc-600 font-mono-custom tracking-widest uppercase">
                {category}
              </h4>
              <div className="space-y-0.5">
                {tools.map((tool: any) => (
                  <button
                    key={tool.workflow_id}
                    onClick={() => onSelectTool(tool.workflow_id)}
                    disabled={isExecuting}
                    className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-all text-left group ${
                      activeToolId === tool.workflow_id
                        ? "bg-zinc-800 text-white shadow-sm"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300"
                    } ${isExecuting ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div
                      className={`w-1 h-1 rounded-full ${
                        activeToolId === tool.workflow_id
                          ? "bg-emerald-500"
                          : "bg-zinc-700 group-hover:bg-emerald-500/50"
                      }`}
                    />
                    <span className="truncate">{tool.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
