"use client";

import { useState, useCallback } from "react";
import ToolCategories from "./ToolCategories";
import InputsPanel from "./InputsPanel";
import CanvasSurface from "./CanvasSurface";
import { useCanvasTools } from "@/features/canvases/api/getCanvasTools";

export default function StudioLayout({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [activeToolId, setActiveToolId] = useState<string | undefined>(
    undefined,
  );
  const [toolInputs, setToolInputs] = useState<Record<string, any>>({});
  const [isExecuting, setIsExecuting] = useState(false);

  const {
    data: toolsData,
    isLoading: isToolsLoading,
    refetch: refetchTools,
    isRefetching: isToolsRefetching,
  } = useCanvasTools();

  const handleSelectTool = (toolId: string) => {
    // Prevent tool switching during execution
    if (isExecuting) return;

    // Toggle tool if already active, or select new
    if (activeToolId === toolId) {
      setActiveToolId(undefined);
    } else {
      setActiveToolId(toolId);
      // Reset inputs when switching tools
      setToolInputs({});
    }
  };

  const handleInputsChange = useCallback((inputs: Record<string, any>) => {
    setToolInputs(inputs);
  }, []);

  const handleToolInputChange = useCallback(
    (parameterName: string, value: any) => {
      setToolInputs((prev) => ({ ...prev, [parameterName]: value }));
    },
    [],
  );

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left: Tool Categories — hidden in read-only (shared view) */}
      {!readOnly && (
        <ToolCategories
          toolsData={toolsData}
          isToolsLoading={isToolsLoading}
          onSelectTool={handleSelectTool}
          activeToolId={activeToolId}
          isExecuting={isExecuting}
          onSync={() => refetchTools()}
          isSyncing={isToolsRefetching}
        />
      )}

      {/* Center: Canvas Surface */}
      <CanvasSurface
        activeToolId={activeToolId}
        toolInputs={toolInputs}
        onExecutionStateChange={setIsExecuting}
        onToolInputChange={handleToolInputChange}
        readOnly={readOnly}
      />

      {/* Right: Inputs Panel — hidden in read-only (shared view) */}
      {!readOnly && (
        <InputsPanel
          activeToolId={activeToolId}
          onInputsChange={handleInputsChange}
          externalInputs={toolInputs}
        />
      )}
    </div>
  );
}
