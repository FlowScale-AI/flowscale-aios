export interface Canvas {
  _id: string;
  name: string;
  description: string;
  team_id: string;
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  settings: {
    grid_size: number;
    snap_to_grid: boolean;
    background: string;
  };
  created_at: string;
  updated_at: string;
  deleted_at: string;
}

export interface CreateCanvasDTO {
  name: string;
  description?: string;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  settings?: {
    grid_size: number;
    snap_to_grid: boolean;
    background: string;
  };
}

export interface CanvasToolInput {
  path: string;
  label: string;
  parameter_name: string;
  demo_type: string;
  category: string;
  randomize: boolean;
  value_type: string;
  default?: unknown;
  options?: string[];
}

export interface CanvasToolOutput {
  label: string;
  demo_type: string;
  path?: string;
  parameter_name?: string | null;
  value_type?: string | null;
  category?: string | null;
  randomize?: boolean;
}

export interface CanvasTool {
  project_id: string;
  project_name: string;
  workflow_id: string;
  name: string;
  description: string;
  inputs: CanvasToolInput[];
  outputs: CanvasToolOutput[];
  is_manual: boolean;
  // Computed property for frontend use
  id?: string;
}

export interface CanvasToolsResponse {
  status: string;

  tools: CanvasTool[];
  total: number;
}

export interface CanvasItemPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
}

export interface CanvasItemData {
  source?: {
    kind: string;
    run_id?: string | null;
    output_selector?: {
      filename: string;
      output_index: number;
      iteration_index: number;
    };
    s3_key?: string | null;
  };
  label?: string;
  media_cache?: Record<string, any>;
}

export interface CanvasItemProperties {
  font_family?: string;
  font_size?: number;
  background_color?: string;
  border_color?: string;
  border_width?: number;
  text_color?: string;
}

export interface CanvasItem {
  _id: string;
  type: string;
  position: CanvasItemPosition;
  z_index: number;
  locked: boolean;
  hidden: boolean;
  data?: CanvasItemData;
  properties?: CanvasItemProperties;
}

export interface SaveCanvasItemsRequest {
  items: CanvasItem[];
}

export interface ToolInputConfig {
  visible: boolean;
  type: string; // "text" | "textarea" | "number" | "image" | "video" | "audio" | "3d" | "combo" | "boolean"
  label?: string;
}

export interface ToolOutputConfig {
  visible: boolean;
  type: string;
  label?: string;
}

export interface ToolConfig {
  workflow_id: string;
  inputs: Record<string, ToolInputConfig>; // keyed by parameter_name
  outputs?: Record<string, ToolOutputConfig>; // keyed by output parameter_name
}

export interface ExecutionState {
  status: "idle" | "submitting" | "running" | "completed" | "error";
  // progress is less relevant in manual polling but kept for compatibility
  progress: number;
  logs: string[];
  results: Record<string, any>;
  error?: string;
  run_id?: string;
}
