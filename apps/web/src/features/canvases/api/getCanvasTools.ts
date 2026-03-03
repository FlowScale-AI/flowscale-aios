import { useQuery } from "@tanstack/react-query";
import type { CanvasTool, CanvasToolInput, CanvasToolOutput, CanvasToolsResponse } from "../types";

// WorkflowIO shape from @flowscale/workflow package
interface WorkflowIO {
  nodeId: string;
  nodeType: string;
  nodeTitle: string;
  paramName: string;
  paramType: "string" | "number" | "boolean" | "image" | "select";
  defaultValue?: unknown;
  options?: string[];
  isInput: boolean;
}

// Tool row returned by GET /api/tools
interface EiosToolRow {
  id: string;
  name: string;
  description?: string | null;
  schemaJson: string;
  comfyPort?: number | null;
  status: string;
}

function mapParamTypeToDemoType(paramType: WorkflowIO["paramType"]): string {
  switch (paramType) {
    case "image": return "image";
    case "number": return "number";
    case "boolean": return "boolean";
    case "select": return "combo";
    default: return "string";
  }
}

function mapEiosTool(row: EiosToolRow): CanvasTool {
  let schema: WorkflowIO[] = [];
  try {
    schema = JSON.parse(row.schemaJson || "[]") as WorkflowIO[];
  } catch {
    // malformed schema — continue with empty
  }

  const inputs: CanvasToolInput[] = schema
    .filter((s) => s.isInput)
    .map((s) => ({
      path: `${s.nodeId}.inputs.${s.paramName}`,
      label: s.nodeTitle || s.paramName,
      parameter_name: `${s.nodeId}::${s.paramName}`,
      demo_type: mapParamTypeToDemoType(s.paramType),
      category: s.nodeType,
      randomize: s.paramName === "seed",
      value_type: s.paramType,
      default: s.defaultValue,
      options: s.options,
    }));

  const outputSchema = schema.filter((s) => !s.isInput);
  const outputs: CanvasToolOutput[] =
    outputSchema.length > 0
      ? outputSchema.map((s) => ({
          label: s.nodeTitle || s.paramName,
          demo_type: "image",
          parameter_name: `${s.nodeId}::${s.paramName}`,
          category: s.nodeType,
        }))
      : [{ label: "Output", demo_type: "image", parameter_name: "default::Output", category: "Output" }];

  return {
    project_id: "local",
    project_name: "EIOS",
    workflow_id: `eios:${row.id}`,
    name: row.name,
    description: row.description ?? "",
    inputs,
    outputs,
    is_manual: false,
    id: row.id,
  };
}

export const getCanvasTools = async (): Promise<CanvasToolsResponse> => {
  try {
    const res = await fetch("/api/tools?status=production");
    if (!res.ok) return { status: "success", tools: [], total: 0 };
    const rows = (await res.json()) as EiosToolRow[];
    const tools: CanvasTool[] = rows.map(mapEiosTool);
    return { status: "success", tools, total: tools.length };
  } catch {
    return { status: "success", tools: [], total: 0 };
  }
};

export const useCanvasTools = () => {
  return useQuery({
    queryKey: ["canvas-tools"],
    queryFn: () => getCanvasTools(),
    refetchInterval: 30_000,
  });
};
