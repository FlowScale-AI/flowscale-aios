import type {
  CanvasTool,
  CanvasToolInput,
  CanvasToolOutput,
  CanvasToolsResponse,
} from "@/features/canvases/types";
import {
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
  getObjectInfo,
} from "./comfyui-client";
import { BUILT_IN_TOOLS, BUILT_IN_WORKFLOWS } from "./built-in-tools";

// ── Node classifications ────────────────────────────────────────────────────

const OUTPUT_NODE_TYPES = new Set([
  // ComfyUI built-in
  "SaveImage",
  "PreviewImage",
  "SaveAnimatedWEBP",
  "SaveAnimatedPNG",
  "VHS_VideoCombine",
  "SaveAudio",
  "Preview3D",
  // FlowScale custom nodes
  "FSHunyuan3DGenerate",
  "FSSave3D",
  "FSSaveImage",
  "FSSaveAudio",
  "FSSaveVideo",
]);

const FILE_INPUT_TYPES = new Set(["IMAGE", "MASK", "AUDIO", "VIDEO"]);

// ── Main mapper ─────────────────────────────────────────────────────────────

/**
 * Discovers saved workflows from ComfyUI, parses them against object_info,
 * and returns a CanvasToolsResponse compatible with the existing UI.
 *
 * @param baseUrl Optional ComfyUI base URL. Defaults to the configured URL.
 */
export async function discoverComfyUITools(baseUrl?: string): Promise<CanvasToolsResponse> {
  const [filenames, objectInfo] = await Promise.all([
    listWorkflows(baseUrl),
    getObjectInfo(baseUrl),
  ]);

  const tools: CanvasTool[] = [];

  for (const filename of filenames) {
    try {
      const workflow = await loadWorkflow(filename, baseUrl);
      const tool = mapWorkflowToTool(filename, workflow, objectInfo);
      if (tool) tools.push(tool);
    } catch (err) {
      console.warn(`[ComfyUI] Failed to parse workflow "${filename}":`, err);
    }
  }

  // Sync any built-in workflows that aren't yet on this ComfyUI instance
  const filenameSet = new Set(filenames);
  for (const [filename, workflow] of Object.entries(BUILT_IN_WORKFLOWS)) {
    if (!filenameSet.has(filename)) {
      try {
        await saveWorkflow(filename, workflow, baseUrl);
        console.info(`[ComfyUI] Synced built-in workflow: ${filename}`);
      } catch (err) {
        console.warn(`[ComfyUI] Failed to sync built-in workflow "${filename}":`, err);
      }
    }
  }

  // Apply built-in tool definitions, overriding auto-discovered ones with the same
  // workflow_id so that input types (e.g. image file upload) are always correct.
  for (const builtIn of BUILT_IN_TOOLS) {
    const idx = tools.findIndex((t) => t.workflow_id === builtIn.workflow_id);
    if (idx >= 0) {
      tools[idx] = builtIn;
    } else {
      tools.push(builtIn);
    }
  }

  return { status: "success", tools, total: tools.length };
}

// ── Graph → API format conversion ───────────────────────────────────────────

/**
 * ComfyUI saves workflows in "graph" format (nodes array + links array).
 * The execution API needs "prompt" format ({ nodeId: { class_type, inputs } }).
 * This function converts graph → API format.
 */
export function graphToApiFormat(graph: any): Record<string, any> | null {
  if (!graph?.nodes || !Array.isArray(graph.nodes)) return null;

  const apiFormat: Record<string, any> = {};

  // Build a lookup: linkId → [sourceNodeId, sourceOutputIndex]
  const linkMap = new Map<number, [number, number]>();
  if (Array.isArray(graph.links)) {
    for (const link of graph.links) {
      // link format: [linkId, sourceNodeId, sourceOutputIndex, targetNodeId, targetInputIndex, type]
      const [linkId, sourceNodeId, sourceOutputIndex] = link;
      linkMap.set(linkId, [sourceNodeId, sourceOutputIndex]);
    }
  }

  for (const node of graph.nodes) {
    const nodeId = String(node.id);
    const classType = node.type;
    if (!classType) continue;

    const inputs: Record<string, any> = {};

    // Process widget values (primitive inputs set via UI)
    // ComfyUI stores widget values in order matching the node's widget list
    const widgetValues = node.widgets_values || [];

    // Process explicit inputs (both connected and widget-based)
    if (Array.isArray(node.inputs)) {
      for (const inp of node.inputs) {
        if (inp.link != null && linkMap.has(inp.link)) {
          // Connected input → reference to source node
          const [srcNodeId, srcOutIdx] = linkMap.get(inp.link)!;
          inputs[inp.name] = [String(srcNodeId), srcOutIdx];
        }
        // Widget inputs without links get their values from widgets_values
      }
    }

    // Map widget values to input names using order
    // We need to figure out which inputs correspond to widgets
    // Widgets are inputs that are NOT of a connectable type (like IMAGE, LATENT etc.)
    // or they have a "widget" property in the node's input list
    const widgetNames: string[] = [];
    if (Array.isArray(node.inputs)) {
      for (const inp of node.inputs) {
        if (inp.widget) {
          widgetNames.push(inp.name);
        }
      }
    }

    // If we have widget names, assign widget values to them.
    // ComfyUI's frontend inserts a "control_after_generate" value ("randomize",
    // "fixed", "increment", "decrement") after seed-type INT inputs in widgets_values.
    // These are UI-only and not in the widget names list, so we skip them.
    if (widgetNames.length > 0 && widgetValues.length > 0) {
      const SEED_CONTROL = new Set(["fixed", "increment", "decrement", "randomize"]);
      const widgetNameSet = new Set(widgetNames);
      let vi = 0;
      for (let i = 0; i < widgetNames.length && vi < widgetValues.length; i++) {
        // Skip seed-control sentinel values that don't match any widget name
        while (vi < widgetValues.length && SEED_CONTROL.has(widgetValues[vi]) && !widgetNameSet.has(widgetValues[vi])) {
          vi++;
        }
        if (vi >= widgetValues.length) break;
        const name = widgetNames[i];
        if (!(name in inputs)) {
          inputs[name] = widgetValues[vi];
        }
        vi++;
      }
    }

    // For nodes without explicit widget mappings, use widgets_values with
    // a simple index approach — this is a fallback
    if (widgetNames.length === 0 && widgetValues.length > 0) {
      // We'll resolve these later when we have objectInfo
      (inputs as any).__widget_values__ = widgetValues;
    }

    apiFormat[nodeId] = {
      class_type: classType,
      inputs,
    };
  }

  return apiFormat;
}

/**
 * Resolve __widget_values__ using object_info to get proper input names.
 */
export function resolveWidgetValues(
  apiFormat: Record<string, any>,
  objectInfo: Record<string, any>,
) {
  for (const [_nodeId, node] of Object.entries(apiFormat)) {
    const widgetValues = node.inputs?.__widget_values__;
    if (!widgetValues) continue;
    delete node.inputs.__widget_values__;

    const nodeDef = objectInfo[node.class_type];
    if (!nodeDef?.input) continue;

    const requiredInputs = nodeDef.input.required || {};
    const optionalInputs = nodeDef.input.optional || {};

    // Get ordered list of widget-like input names (non-connectable or explicitly widgets)
    const widgetInputNames: string[] = [];
    for (const [name, def] of Object.entries(requiredInputs) as [string, any][]) {
      const typeSpec = Array.isArray(def) ? def[0] : def;
      // Primitive types or combo arrays are widget inputs
      if (
        Array.isArray(typeSpec) ||
        typeof typeSpec === "string" &&
          ["INT", "FLOAT", "STRING", "BOOLEAN"].includes(typeSpec)
      ) {
        widgetInputNames.push(name);
      }
    }
    for (const [name, def] of Object.entries(optionalInputs) as [string, any][]) {
      const typeSpec = Array.isArray(def) ? def[0] : def;
      if (
        Array.isArray(typeSpec) ||
        typeof typeSpec === "string" &&
          ["INT", "FLOAT", "STRING", "BOOLEAN"].includes(typeSpec)
      ) {
        widgetInputNames.push(name);
      }
    }

    // ComfyUI's frontend inserts a "control_after_generate" value ("randomize",
    // "fixed", "increment", "decrement") after seed-type INT inputs in widgets_values.
    // These are UI-only and absent from objectInfo, so we must skip them when mapping.
    const SEED_CONTROL_VALUES = new Set(["fixed", "increment", "decrement", "randomize"]);
    let vi = 0;
    for (let i = 0; i < widgetInputNames.length && vi < widgetValues.length; i++) {
      const name = widgetInputNames[i];
      const inputDef = (requiredInputs[name] ?? optionalInputs[name]) as any;
      const typeSpec = Array.isArray(inputDef) ? inputDef[0] : inputDef;
      // Skip seed-control sentinels when the expected input type is not a combo containing them
      while (
        vi < widgetValues.length &&
        SEED_CONTROL_VALUES.has(widgetValues[vi]) &&
        !(Array.isArray(typeSpec) && (typeSpec as string[]).includes(widgetValues[vi]))
      ) {
        vi++;
      }
      if (vi >= widgetValues.length) break;
      if (!(name in node.inputs)) {
        node.inputs[name] = widgetValues[vi];
      }
      vi++;
    }
  }
}

// ── Workflow → Tool mapping ─────────────────────────────────────────────────

function mapWorkflowToTool(
  filename: string,
  rawWorkflow: Record<string, any>,
  objectInfo: Record<string, any>,
): CanvasTool | null {
  // Detect format: graph format has a "nodes" array, API format has string-keyed node objects
  let apiNodes: Record<string, any> | null;

  if (Array.isArray(rawWorkflow?.nodes)) {
    // Graph format → convert to API format
    apiNodes = graphToApiFormat(rawWorkflow);
    if (apiNodes) resolveWidgetValues(apiNodes, objectInfo);
  } else {
    // Already in API format
    apiNodes = rawWorkflow;
  }

  if (!apiNodes || typeof apiNodes !== "object") return null;

  const inputs: CanvasToolInput[] = [];
  const outputs: CanvasToolOutput[] = [];

  // Build a set of values that are links (i.e. connected to other node outputs)
  // In ComfyUI API format, links are arrays like [nodeId, outputIndex]
  const linkedInputs = new Set<string>();

  for (const [nodeId, node] of Object.entries(apiNodes) as [string, any][]) {
    if (!node?.inputs) continue;
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") {
        // This is a link – mark it
        linkedInputs.add(`${nodeId}.${inputName}`);
      }
    }
  }

  for (const [nodeId, node] of Object.entries(apiNodes) as [string, any][]) {
    const classType: string = node?.class_type;
    if (!classType) continue;
    const nodeDef = objectInfo[classType];

    // ── Collect outputs (SaveImage, 3D nodes, etc.) ──
    if (OUTPUT_NODE_TYPES.has(classType)) {
      const is3D = classType.includes("3D") || classType.includes("3d");
      const isAudio = classType.toLowerCase().includes("audio");
      const isVideo = classType.toLowerCase().includes("video");
      // Strip leading "FS" prefix before humanizing (e.g. FSSave3D → Save 3D)
      const humanLabel = humanize(classType.replace(/^FS/, "").replace(/3D/g, " 3D").replace(/\s+/g, " ").trim());
      outputs.push({
        label: humanLabel,
        demo_type: is3D ? "3d" : isAudio ? "audio" : isVideo ? "video" : "image",
        parameter_name: `${nodeId}::${classType}`,
        category: classType,
      });
    }

    // ── Collect "free" inputs (not connected, primitive values) ──
    if (!node.inputs || !nodeDef?.input) continue;

    const requiredInputs = nodeDef.input.required || {};
    const optionalInputs = nodeDef.input.optional || {};
    const allInputDefs = { ...requiredInputs, ...optionalInputs };

    for (const [inputName, value] of Object.entries(node.inputs)) {
      const key = `${nodeId}.${inputName}`;
      // Skip if this input is connected to another node
      if (linkedInputs.has(key)) continue;

      const inputDef = allInputDefs[inputName];
      if (!inputDef) continue;

      const mapped = mapInputDef(
        nodeId,
        classType,
        inputName,
        value,
        inputDef,
      );
      if (mapped) inputs.push(mapped);
    }
  }

  // Skip workflows with no discoverable inputs or outputs
  if (inputs.length === 0 && outputs.length === 0) return null;

  const workflowName = filename.replace(/\.json$/i, "");
  const workflowId = `comfyui:${filename}`;

  return {
    project_id: "local",
    project_name: "ComfyUI",
    workflow_id: workflowId,
    name: workflowName,
    description: `ComfyUI workflow – ${inputs.length} inputs, ${outputs.length} outputs`,
    inputs,
    outputs: outputs.length > 0 ? outputs : [{ label: "Output", demo_type: "image", parameter_name: "default::Output", category: "Output" }],
    is_manual: false,
    id: workflowId,
  };
}

// ── Input mapping ───────────────────────────────────────────────────────────

function mapInputDef(
  nodeId: string,
  classType: string,
  inputName: string,
  currentValue: any,
  inputDef: any,
): CanvasToolInput | null {
  // inputDef is typically [type, config?] where type is a string or array of strings
  const typeSpec = Array.isArray(inputDef) ? inputDef[0] : inputDef;
  const config = Array.isArray(inputDef) && inputDef.length > 1 ? inputDef[1] : {};

  // ComfyUI combo inputs are arrays of string options
  if (Array.isArray(typeSpec)) {
    return {
      path: `${nodeId}.inputs.${inputName}`,
      label: humanize(inputName),
      parameter_name: `${nodeId}::${inputName}`,
      demo_type: "combo",
      category: classType,
      randomize: false,
      value_type: "combo",
      // Stash combo options + default in a way InputsPanel can read
      ...(({ options: typeSpec, default: currentValue } as any)),
    };
  }

  if (typeof typeSpec === "string") {
    // Primitive types
    if (typeSpec === "INT" || typeSpec === "FLOAT") {
      return {
        path: `${nodeId}.inputs.${inputName}`,
        label: humanize(inputName),
        parameter_name: `${nodeId}::${inputName}`,
        demo_type: "number",
        category: classType,
        randomize: typeSpec === "INT" && inputName === "seed",
        value_type: typeSpec.toLowerCase(),
        ...(({
          default: currentValue,
          min: config?.min,
          max: config?.max,
          step: config?.step,
        } as any)),
      };
    }

    if (typeSpec === "STRING") {
      const isMultiline = config?.multiline === true;
      return {
        path: `${nodeId}.inputs.${inputName}`,
        label: humanize(inputName),
        parameter_name: `${nodeId}::${inputName}`,
        demo_type: isMultiline ? "textarea" : "string",
        category: classType,
        randomize: false,
        value_type: "string",
        ...(({ default: currentValue } as any)),
      };
    }

    if (typeSpec === "BOOLEAN") {
      return {
        path: `${nodeId}.inputs.${inputName}`,
        label: humanize(inputName),
        parameter_name: `${nodeId}::${inputName}`,
        demo_type: "boolean",
        category: classType,
        randomize: false,
        value_type: "boolean",
        ...(({ default: currentValue } as any)),
      };
    }

    // File-like inputs that show up as free (not connected)
    if (FILE_INPUT_TYPES.has(typeSpec)) {
      const demoType =
        typeSpec === "AUDIO" ? "audio" :
        typeSpec === "VIDEO" ? "video" :
        "image"; // IMAGE and MASK
      return {
        path: `${nodeId}.inputs.${inputName}`,
        label: humanize(inputName),
        parameter_name: `${nodeId}::${inputName}`,
        demo_type: demoType,
        category: classType,
        randomize: false,
        value_type: "file",
      };
    }
  }

  // Unknown type – skip
  return null;
}

// ── Utils ───────────────────────────────────────────────────────────────────

function humanize(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
