import { openDB, type IDBPDatabase } from "idb";
import type { Canvas, CanvasItem, CreateCanvasDTO, ToolConfig } from "@/features/canvases/types";
import type { RunItem, RunOutput } from "@/features/canvases/api/getAllRunsList";

// ── Schema ──────────────────────────────────────────────────────────────────

interface FlowscaleDB {
  canvases: {
    key: string;
    value: Canvas;
    indexes: { updated_at: string };
  };
  canvas_items: {
    key: [string, string]; // [canvas_id, _id]
    value: CanvasItem & { canvas_id: string };
    indexes: { canvas_id: string };
  };
  runs: {
    key: string;
    value: RunItem;
    indexes: { canvas_id: string; created_at: string };
  };
  tool_configs: {
    key: string;
    value: ToolConfig;
  };
}

let dbPromise: Promise<IDBPDatabase<FlowscaleDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<FlowscaleDB>("flowscale_studio", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // canvases
          const canvasStore = db.createObjectStore("canvases", {
            keyPath: "_id",
          });
          canvasStore.createIndex("updated_at", "updated_at");

          // canvas_items – compound key [canvas_id, _id]
          const itemsStore = db.createObjectStore("canvas_items", {
            keyPath: ["canvas_id", "_id"],
          });
          itemsStore.createIndex("canvas_id", "canvas_id");

          // runs
          const runsStore = db.createObjectStore("runs", { keyPath: "_id" });
          runsStore.createIndex("canvas_id", "canvas_id");
          runsStore.createIndex("created_at", "created_at");
        }

        if (oldVersion < 2) {
          db.createObjectStore("tool_configs", { keyPath: "workflow_id" });
        }
      },
      blocked() {
        // If another tab holds the old version, reset so we retry on next call
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

// ── Canvas CRUD ─────────────────────────────────────────────────────────────

export async function localGetCanvasList(): Promise<Canvas[]> {
  const db = await getDB();
  const all = await db.getAll("canvases");
  return all.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export async function localGetCanvas(id: string): Promise<Canvas> {
  const db = await getDB();
  const canvas = await db.get("canvases", id);
  if (!canvas) throw new Error(`Canvas ${id} not found`);
  return canvas;
}

export async function localCreateCanvas(
  data: CreateCanvasDTO,
): Promise<Canvas> {
  const db = await getDB();
  const now = new Date().toISOString();
  const canvas: Canvas = {
    _id: crypto.randomUUID(),
    name: data.name,
    description: data.description || "",
    team_id: "local",
    viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
    settings: data.settings || {
      grid_size: 8,
      snap_to_grid: false,
      background: "#ffffff",
    },
    created_at: now,
    updated_at: now,
    deleted_at: "",
  };
  await db.put("canvases", canvas);
  return canvas;
}

export async function localDeleteCanvas(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("canvases", id);

  // Also delete all items belonging to this canvas
  const tx = db.transaction("canvas_items", "readwrite");
  const idx = tx.store.index("canvas_id");
  let cursor = await idx.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ── Canvas Items CRUD ───────────────────────────────────────────────────────

export async function localGetCanvasItems(
  canvasId: string,
): Promise<CanvasItem[]> {
  const db = await getDB();
  const idx = db.transaction("canvas_items").store.index("canvas_id");
  const items = await idx.getAll(canvasId);
  // Strip the canvas_id helper field before returning
  return items.map(({ canvas_id, ...rest }) => rest);
}

export async function localSaveCanvasItems(
  canvasId: string,
  items: CanvasItem[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("canvas_items", "readwrite");
  for (const item of items) {
    await tx.store.put({ ...item, canvas_id: canvasId });
  }
  await tx.done;

  // Touch canvas updated_at
  await touchCanvas(canvasId);
}

export async function localUpdateCanvasItems(
  canvasId: string,
  items: CanvasItem[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("canvas_items", "readwrite");

  // Clear existing items for this canvas, then re-add all
  const idx = tx.store.index("canvas_id");
  let cursor = await idx.openCursor(canvasId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  for (const item of items) {
    await tx.store.put({ ...item, canvas_id: canvasId });
  }
  await tx.done;

  await touchCanvas(canvasId);
}

export async function localDeleteCanvasItem(
  canvasId: string,
  itemId: string,
): Promise<void> {
  const db = await getDB();
  await db.delete("canvas_items", [canvasId, itemId]);
  await touchCanvas(canvasId);
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function localGetAllRunsList(params: {
  filter_by: string;
  filter_value: string;
  page_size: number;
  page_number: number;
}) {
  const db = await getDB();
  let runs: RunItem[];

  if (params.filter_by === "canvas_id" && params.filter_value) {
    const idx = db.transaction("runs").store.index("canvas_id");
    runs = await idx.getAll(params.filter_value);
  } else {
    runs = await db.getAll("runs");
  }

  // Sort by created_at descending
  runs.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const start = (params.page_number - 1) * params.page_size;
  const page = runs.slice(start, start + params.page_size);

  return {
    status: "success",
    data: page,
    total: runs.length,
    total_pages: Math.ceil(runs.length / params.page_size),
    page_size: params.page_size,
    page_number: params.page_number,
  };
}

export async function localSaveRun(run: RunItem): Promise<void> {
  const db = await getDB();
  await db.put("runs", run);
}

// ── Tool Configs ─────────────────────────────────────────────────────────────

export async function getToolConfig(workflowId: string): Promise<ToolConfig | undefined> {
  const db = await getDB();
  return db.get("tool_configs", workflowId);
}

export async function saveToolConfig(workflowId: string, config: ToolConfig): Promise<void> {
  const db = await getDB();
  await db.put("tool_configs", { ...config, workflow_id: workflowId });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function touchCanvas(canvasId: string) {
  const db = await getDB();
  const canvas = await db.get("canvases", canvasId);
  if (canvas) {
    canvas.updated_at = new Date().toISOString();
    await db.put("canvases", canvas);
  }
}
