import type { CanvasTool } from "@/features/canvases/types";

// EIOS: no built-in tools bundled — tools come from /api/tools (local SQLite)
export const BUILT_IN_TOOLS: CanvasTool[] = [];
export const BUILT_IN_WORKFLOWS: Record<string, any> = {};
