"use client";

import { useState, useMemo, useCallback } from "react";
import ToolCategories from "./ToolCategories";
import InputsPanel from "./InputsPanel";
import CanvasSurface from "./CanvasSurface";
import { useCanvasTools } from "@/features/canvases/api/getCanvasTools";
import { useGetDeployedClusters } from "@/features/canvases/api";

export default function StudioLayout() {
  const [activeToolId, setActiveToolId] = useState<string | undefined>(
    undefined,
  );
  const [toolInputs, setToolInputs] = useState<Record<string, any>>({});
  const [isExecuting, setIsExecuting] = useState(false);

  // Get tools data to find the project_id for the selected tool
  const { data: toolsData, isLoading: isToolsLoading, refetch: refetchTools, isRefetching: isToolsRefetching } = useCanvasTools();

  // Find the project_id of the active tool
  const activeProjectId = useMemo(() => {
    if (!activeToolId || !toolsData?.tools) return undefined;
    const activeTool = toolsData.tools.find(
      (tool: any) => tool.workflow_id === activeToolId,
    );
    return activeTool?.project_id;
  }, [activeToolId, toolsData]);

  // Fetch deployed clusters to resolve API-mode public URL
  const { data: deployedClusters } = useGetDeployedClusters(
    activeProjectId,
  ) as any;

  // Extract the API key from deployed clusters
  const projectApiKey = useMemo(() => {
    const clusters = deployedClusters?.data || [];
    const apiCluster = clusters.find((cluster: any) => cluster.mode === "api");
    return apiCluster?.project_api_key;
  }, [deployedClusters]);

  const executionApiUrl = useMemo(() => {
    const clusters = deployedClusters?.data || [];
    const apiCluster = clusters.find((cluster: any) => cluster.mode === "api");
    return apiCluster?.public_url;
  }, [deployedClusters]);

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

  const handleToolInputChange = useCallback((parameterName: string, value: any) => {
    setToolInputs(prev => ({ ...prev, [parameterName]: value }));
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left: Tool Categories */}
      <ToolCategories
        toolsData={toolsData}
        isToolsLoading={isToolsLoading}
        onSelectTool={handleSelectTool}
        activeToolId={activeToolId}
        isExecuting={isExecuting}
        onSync={() => refetchTools()}
        isSyncing={isToolsRefetching}
      />

      {/* Center: Canvas Surface */}
      <CanvasSurface
        activeToolId={activeToolId}
        toolInputs={toolInputs}
        onExecutionStateChange={setIsExecuting}
        projectApiKey={projectApiKey}
        executionApiUrl={executionApiUrl}
        projectId={activeProjectId}
        onToolInputChange={handleToolInputChange}
      />

      {/* Right: Inputs Panel */}
      <InputsPanel
        activeToolId={activeToolId}
        onInputsChange={handleInputsChange}
        externalInputs={toolInputs}
      />
    </div>
  );
}
