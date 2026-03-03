"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import DraggableObject from "./DraggableObject";
import { CanvasToolbar, CanvasToolType } from "./CanvasToolbar";
import { ContextMenu, SendToTarget } from "./ContextMenu";
import { SelectionActionbar } from "./SelectionActionbar";
import {
  useSaveCanvasItems,
  useUpdateCanvasItems,
  useGetCanvasItems,
  useDeleteCanvasItem,
  useGetCanvas,
  CanvasItem,
} from "@/features/canvases/api";
import { useParams } from "next/navigation";
import { useCanvasState } from "./CanvasStateContext";
import { Tooltip } from "@flowscale/ui";
import ExportModal from "@/features/canvases/components/ExportModal";
import { useToolExecution } from "@/features/canvases/hooks/useToolExecution";
import { useComfyUIExecution } from "@/features/canvases/hooks/useComfyUIExecution";
import { usePodsExecution } from "@/features/canvases/hooks/usePodsExecution";
import { isDesktop } from "@/lib/platform";
import { usePodsStore } from "@/store/podsStore";
import ExecutionMenu from "./ExecutionMenu";
import { Minus, Plus } from "phosphor-react";
import { useCanvasTools } from "@/features/canvases/api/getCanvasTools";
import type { ToolConfig } from "@/features/canvases/types";
import type { ToolInputConfig } from "@/features/canvases/types";

/** Rewrites a stored operator proxy URL to use the current operator host:port. */
function rewriteOperatorUrl(url: string, currentOperatorUrl: string | null): string {
  if (!url || !currentOperatorUrl) return url;
  const match = url.match(/(\/api\/pods\/.+)$/);
  if (match) return `${currentOperatorUrl}${match[1]}`;
  return url;
}

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasObject {
  id: string;
  type:
    | "image"
    | "text"
    | "rectangle"
    | "ellipse"
    | "line"
    | "arrow"
    | "artboard"
    | "audio"
    | "model3d"; // Added new types
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  scaleX?: number; // New: for flipping
  scaleY?: number; // New: for flipping
  style?: {
    // Optional style properties for shapes
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
  };
  rotation?: number; // New: rotation in degrees
  label?: string; // New: for artboard label
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
}

const convertToCanvasItem = (obj: CanvasObject): CanvasItem => {
  return {
    _id: obj.id,
    type: obj.type,
    position: {
      x: obj.x,
      y: obj.y,
      width: obj.w,
      height: obj.h,
      rotation: obj.rotation || 0,
      scale_x: obj.scaleX || 1,
      scale_y: obj.scaleY || 1,
    },
    z_index: 0, // Default
    locked: false,
    hidden: false,
    data: {
      source: obj.source || {
        kind: "manual", // Required field - indicates user-created object
      },
      label: obj.type === "text" ? obj.content : obj.label || obj.content,
    },
    properties: {
      background_color: obj.style?.backgroundColor,
      border_color: obj.style?.borderColor,
      border_width: obj.style?.borderWidth,
      text_color: obj.style?.textColor,
      font_size: obj.style?.fontSize,
      font_family: obj.style?.fontFamily,
    },
  };
};

const convertFromCanvasItem = (item: CanvasItem): CanvasObject => {
  // Get content from s3_key (which stores the URL)
  const contentUrl = item.data?.source?.s3_key || "";
  const textContent = item.data?.label || "";

  return {
    id: item._id,
    type: item.type as
      | "image"
      | "text"
      | "rectangle"
      | "ellipse"
      | "line"
      | "arrow"
      | "artboard"
      | "audio"
      | "model3d",
    x: item.position.x,
    y: item.position.y,
    w: item.position.width,
    h: item.position.height,
    content: item.type === "text" ? textContent : contentUrl,
    scaleX: item.position.scale_x,
    scaleY: item.position.scale_y,
    rotation: item.position.rotation,
    label: item.data?.label,
    source: item.data?.source,
    style: {
      backgroundColor: item.properties?.background_color,
      borderColor: item.properties?.border_color,
      borderWidth: item.properties?.border_width,
      textColor: item.properties?.text_color,
      fontSize: item.properties?.font_size,
      fontFamily: item.properties?.font_family,
    },
  };
};

interface CanvasSurfaceProps {
  activeToolId?: string;
  toolInputs?: Record<string, any>;
  onExecutionStateChange?: (isExecuting: boolean) => void;
  projectApiKey?: string;
  executionApiUrl?: string;
  projectId?: string;
  onToolInputChange?: (parameterName: string, value: any) => void;
}

export default function CanvasSurface({
  activeToolId,
  toolInputs,
  onExecutionStateChange,
  projectApiKey,
  executionApiUrl,
  projectId,
  onToolInputChange,
}: CanvasSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [activeTool, setActiveTool] = useState<CanvasToolType>("select"); // New: Active Tool State
  const [drawingObject, setDrawingObject] = useState<CanvasObject | null>(null); // New: Object being drawn
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
    objectId?: string;
  } | null>(null);
  const [clipboard, setClipboard] = useState<CanvasObject | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [draggedResult, setDraggedResult] = useState<{
    filename: string;
    result: any;
  } | null>(null);

  // Operator URL for rewriting stored localhost URLs to current operator
  const storeOperatorUrl = usePodsStore((s) => s.operatorUrl);
  const currentOperatorUrl = storeOperatorUrl ?? (isDesktop() ? "http://localhost:30000" : null);

  // Tool Execution State – use pods execution in desktop mode
  const selectedPodId = usePodsStore((s) => s.selectedPodId);
  const cloudExecution = useToolExecution({
    apiUrl: executionApiUrl || "",
    apiKey: projectApiKey || "",
  });
  const comfyExecution = useComfyUIExecution();
  const podsExecution = usePodsExecution(selectedPodId);
  // In desktop mode: use pods execution if a pod is selected, else fall back to legacy ComfyUI execution
  const desktopExecution = selectedPodId ? podsExecution : comfyExecution;
  // EIOS tools (eios: prefix) always go through the API server regardless of desktop mode
  const isEiosTool = activeToolId?.startsWith('eios:');
  const { executionState, executeWorkflow, cancelWorkflow, reset } =
    (isDesktop() && !isEiosTool) ? desktopExecution : cloudExecution;

  // Tool config for "Send To" feature
  const { data: toolsData } = useCanvasTools();
  const [toolConfig, setToolConfig] = useState<Record<string, ToolInputConfig> | null>(null);

  // Load tool config when active tool changes
  useEffect(() => {
    if (!activeToolId) { setToolConfig(null); return; }
    let cancelled = false;
    fetch(`/api/tool-configs/${encodeURIComponent(activeToolId)}`)
      .then((r) => (r.status === 204 ? null : r.json()))
      .then((config: ToolConfig | null) => {
        if (!cancelled) setToolConfig(config?.inputs ?? null);
      })
      .catch(() => { /* no config yet */ });
    return () => { cancelled = true; };
  }, [activeToolId]);

  const params = useParams();
  const canvasId = params?.id as string;
  const { data: canvas } = useGetCanvas(canvasId);
  const { mutate: saveItems } = useSaveCanvasItems(canvasId);
  const { mutate: updateItems, isPending: isUpdatePending } =
    useUpdateCanvasItems(canvasId);
  const { mutate: deleteItem } = useDeleteCanvasItem(canvasId);
  const { data: canvasItems, isLoading: isLoadingItems } =
    useGetCanvasItems(canvasId);

  const { setIsSaving, registerSaveFunction } = useCanvasState();

  // Sync saving state to context
  useEffect(() => {
    setIsSaving(isUpdatePending);
  }, [isUpdatePending, setIsSaving]);

  // Register save function for TopBar navigation
  useEffect(() => {
    const saveFunction = () => {
      if (objectsRef.current.length > 0) {
        const itemsToSave = objectsRef.current.map(convertToCanvasItem);
        updateItems(itemsToSave);
        // Clear modified tracking after save
        setModifiedObjectIds(new Set());
      }
    };
    registerSaveFunction(saveFunction);
  }, [registerSaveFunction, updateItems]);

  // Notify parent of execution state changes
  useEffect(() => {
    const isExecuting =
      executionState.status === "submitting" ||
      executionState.status === "running";
    onExecutionStateChange?.(isExecuting);
  }, [executionState.status, onExecutionStateChange]);

  // Resize/Rotate State
  const [interactionState, setInteractionState] = useState<{
    type: "idle" | "resizing" | "rotating" | "moving";
    startX: number;
    startY: number;
    startW?: number;
    startH?: number;
    startXObj?: number; // Object's initial X
    startYObj?: number; // Object's initial Y
    startRotation?: number; // Object's initial rotation
    startAngle?: number; // Pointer angle at rotation start
    handle?: string; // Resize handle being dragged
  }>({ type: "idle", startX: 0, startY: 0 });

  const interactionStateRef = useRef(interactionState);

  // Track modified objects during interaction for batch auto-save
  const [modifiedObjectIds, setModifiedObjectIds] = useState<Set<string>>(
    new Set(),
  );
  const modifiedObjectIdsRef = useRef(modifiedObjectIds);

  // Canvas Objects State (loaded from API)
  const [objects, setObjects] = useState<CanvasObject[]>([]);

  // State refs for event listeners
  const objectsRef = useRef(objects);
  const selectedObjectIdsRef = useRef(selectedObjectIds);
  const clipboardRef = useRef(clipboard);
  const viewRef = useRef(view);
  const contextMenuRef = useRef(contextMenu);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const activeToolRef = useRef(activeTool); // Ref for active tool
  const drawingObjectRef = useRef(drawingObject); // Ref for drawing object
  const dragStartRef = useRef<{ x: number; y: number } | null>(null); // To track start of drawing
  const selectionBoxRef = useRef(selectionBox); // Ref for selection box

  // Load canvas items from API when they're fetched
  useEffect(() => {
    if (canvasItems) {
      const loadedObjects = canvasItems.map(convertFromCanvasItem);
      setObjects(loadedObjects);
    }
  }, [canvasItems]);

  // Auto-save
  useEffect(() => {
    const interval = setInterval(() => {
      if (objects.length > 0) {
        const itemsToSave = objects.map(convertToCanvasItem);
        updateItems(itemsToSave);
        // Clear modified tracking after save
        setModifiedObjectIds(new Set());
      }
    }, 20000); // 20 seconds

    return () => clearInterval(interval);
  }, [objects, updateItems]);

  // Sync refs
  useEffect(() => {
    objectsRef.current = objects;
    selectedObjectIdsRef.current = selectedObjectIds;
    clipboardRef.current = clipboard;
    viewRef.current = view;
    contextMenuRef.current = contextMenu;
    activeToolRef.current = activeTool;
    drawingObjectRef.current = drawingObject;
    interactionStateRef.current = interactionState;
    modifiedObjectIdsRef.current = modifiedObjectIds;
    selectionBoxRef.current = selectionBox;
  }, [
    objects,
    selectedObjectIds,
    clipboard,
    view,
    contextMenu,
    activeTool,
    drawingObject,
    interactionState,
    modifiedObjectIds,
    selectionBox,
  ]);

  // ... (useEffect for wheel and click outside remains same)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleWheel = (e: WheelEvent) => {
      // ... (existing zoom logic)
      // Check for Ctrl key for zoom (standard on most platforms for pinch-to-zoom mapping)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        // Multiplicative zoom for "Figma-like" feel
        // Use a smaller coefficient for smooth trackpad zooming
        const ZOOM_SENSITIVITY = 0.005;

        // Calculate new scale
        // -e.deltaY because scrolling up (negative delta) usually means zoom in
        const delta = -e.deltaY;
        const scaleFactor = Math.exp(delta * ZOOM_SENSITIVITY);

        // Get mouse position relative to wrapper
        const rect = wrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setView((prev) => {
          const newScale = Math.min(Math.max(0.1, prev.scale * scaleFactor), 8);

          // Zoom towards mouse logic
          // We want the point under the mouse to remain strictly in the same place
          // relative to the viewport after the zoom.
          // Point In World Space = (MousePos - ViewPos) / Scale
          // New ViewPos = MousePos - (Point In World Space * NewScale)

          const worldPointX = (x - prev.x) / prev.scale;
          const worldPointY = (y - prev.y) / prev.scale;

          const newX = x - worldPointX * newScale;
          const newY = y - worldPointY * newScale;

          return {
            x: newX,
            y: newY,
            scale: newScale,
          };
        });
      } else {
        e.preventDefault();
        e.stopPropagation();

        setView((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    wrapper.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    // Only allow resizing if exactly one object is selected
    if (selectedObjectIds.size !== 1) return;

    const selectedId = Array.from(selectedObjectIds)[0];
    const obj = objects.find((o) => o.id === selectedId);
    if (!obj) return;

    setInteractionState({
      type: "resizing",
      startX: e.clientX,
      startY: e.clientY,
      startW: obj.w,
      startH: obj.h,
      startXObj: obj.x,
      startYObj: obj.y,
      handle: direction,
    });
  };

  const handleRotateStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Only allow rotating if exactly one object is selected
    if (selectedObjectIds.size !== 1) return;

    const selectedId = Array.from(selectedObjectIds)[0];
    const obj = objects.find((o) => o.id === selectedId);
    if (!obj) return;

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;

    const centerX = obj.x + obj.w / 2;
    const centerY = obj.y + obj.h / 2;
    const screenCenterX = centerX * viewRef.current.scale + viewRef.current.x;
    const screenCenterY = centerY * viewRef.current.scale + viewRef.current.y;

    const startAngle = Math.atan2(
      e.clientY - rect.top - screenCenterY,
      e.clientX - rect.left - screenCenterX,
    );

    setInteractionState({
      type: "rotating",
      startX: e.clientX,
      startY: e.clientY,
      startRotation: obj.rotation || 0,
      startAngle,
      startXObj: centerX, // Center X
      startYObj: centerY, // Center Y
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // If panning (middle click or space+click), handle first
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      setIsPanning(true);
      return;
    }

    const currentTool = activeToolRef.current;

    // If interacting (resizing/rotating), don't start drawing/selecting
    // Also check if we are already in a "moving" phase of drawing (Line/Arrow)
    if (interactionStateRef.current.type !== "idle") return;

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const worldX = (clientX - viewRef.current.x) / viewRef.current.scale;
    const worldY = (clientY - viewRef.current.y) / viewRef.current.scale;

    // --- Drawing Logic ---
    if (currentTool !== "select") {
      if (e.button === 0) {
        e.stopPropagation();

        // Check if we are already drawing (for Click-Move-Click line/arrow)
        if (
          drawingObjectRef.current &&
          (currentTool === "line" || currentTool === "arrow")
        ) {
          // Finish drawing
          const obj = drawingObjectRef.current;
          // Ensure it has some size
          if (Math.abs(obj.w) > 0 || Math.abs(obj.h) > 0) {
            setObjects((prev) => [...prev, obj]);
            setSelectedObjectIds(new Set([obj.id]));
          }
          setDrawingObject(null);
          dragStartRef.current = null;
          setActiveTool("select");
          return;
        }

        // Start Drawing
        dragStartRef.current = { x: worldX, y: worldY };

        const newId = uuidv4(); // Generate proper UUID
        const newObj: CanvasObject = {
          id: newId,
          type: currentTool,
          x: worldX,
          y: worldY,
          w: 0, // Start Size 0
          h: 0,
          content: currentTool === "text" ? "Double click to edit" : "",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          // source: {
          //   kind: "manual",
          //   // run_id: "", // Use object ID as run_id for manual objects
          // },
          style: {
            backgroundColor:
              currentTool === "artboard"
                ? "#3f3f46"
                : currentTool === "rectangle" || currentTool === "ellipse"
                  ? "#3f3f46"
                  : undefined,
            borderColor: "#52525b",
            borderWidth: 1,
          },
        };

        if (currentTool === "text") {
          newObj.w = 200;
          newObj.h = 40;
        }

        setDrawingObject(newObj);
        return;
      }
    }

    // --- Selection Logic ---
    if (currentTool === "select" && e.button === 0) {
      // Deselect if clicking on background (wrapper or transform layer)
      if (
        e.target === wrapperRef.current ||
        e.target === transformLayerRef.current
      ) {
        // Start, but check if we should clear selection first
        if (!e.shiftKey) {
          setSelectedObjectIds(new Set());
        }

        // Start Marquee Selection
        setSelectionBox({
          startX: worldX,
          startY: worldY,
          x: worldX,
          y: worldY,
          w: 0,
          h: 0,
        });
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, id?: string) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        visible: true,
        objectId: id,
      });
    }
  };

  const handleObjectMove = (id: string, newX: number, newY: number) => {
    setObjects((prev) => {
      // Find the delta for the primary moved object
      const movingObj = prev.find((o) => o.id === id);
      if (!movingObj) return prev;

      const dx = newX - movingObj.x;
      const dy = newY - movingObj.y;

      // If the moved object is part of the selection, move all selected objects
      if (selectedObjectIdsRef.current.has(id)) {
        const updated = prev.map((obj) => {
          if (selectedObjectIdsRef.current.has(obj.id)) {
            return { ...obj, x: obj.x + dx, y: obj.y + dy };
          }
          return obj;
        });
        // Track all selected items for batch update on mouseup
        setModifiedObjectIds(new Set(selectedObjectIdsRef.current));
        return updated;
      }

      // Otherwise just move the single object (shouldn't really happen if drag implies selection, but safe to handle)
      const updated = prev.map((obj) =>
        obj.id === id ? { ...obj, x: newX, y: newY } : obj,
      );
      setModifiedObjectIds(new Set([id]));
      return updated;
    });
  };

  const handleObjectUpdate = (id: string, updates: Partial<CanvasObject>) => {
    setObjects((prev) =>
      prev.map((obj) => (obj.id === id ? { ...obj, ...updates } : obj)),
    );
    // Track modified object for auto-save (e.g., color changes, text edits)
    setModifiedObjectIds((prev) => new Set(prev).add(id));
  };

  // --- Context Menu Actions (Existing) ---
  const handleCopy = () => {
    // Current implementation only supports copying a single object
    const selectedIds = Array.from(selectedObjectIdsRef.current);
    if (selectedIds.length > 0) {
      // Just copy the first one for now or last selected?
      // Better: Copy the "primary" one (e.g. first in set)
      const obj = objectsRef.current.find((o) => o.id === selectedIds[0]);
      if (obj) {
        setClipboard(obj);
        setContextMenu(null);
      }
    }
  };

  const handlePaste = () => {
    const clip = clipboardRef.current;
    const ctxMenu = contextMenuRef.current;
    const viewState = viewRef.current;

    if (clip) {
      // If context menu is open/visible, paste there.
      // Otherwise, paste offset from original.
      let newX, newY;

      if (ctxMenu && ctxMenu.visible) {
        // Transform screen coordinates (ctxMenu) to world coordinates
        newX = (ctxMenu.x - viewState.x) / viewState.scale;
        newY = (ctxMenu.y - viewState.y) / viewState.scale;
      } else {
        newX = clip.x + 20;
        newY = clip.y + 20;
      }

      const newId = uuidv4(); // Generate proper UUID
      const newObj = {
        ...clip,
        id: newId,
        x: newX,
        y: newY,
      };
      setObjects((prev) => [...prev, newObj]);
      setSelectedObjectIds(new Set([newId]));
      setContextMenu(null);
      saveItems([convertToCanvasItem(newObj)]);
    }
  };

  const handleDuplicate = () => {
    const selectedIds = Array.from(selectedObjectIdsRef.current);
    if (selectedIds.length > 0) {
      const newObjectsToAdd: CanvasObject[] = [];
      const newIds = new Set<string>();

      selectedIds.forEach((id) => {
        const obj = objectsRef.current.find((o) => o.id === id);
        if (obj) {
          const newId = uuidv4(); // Generate proper UUID
          const newObj = {
            ...obj,
            id: newId,
            x: obj.x + 20,
            y: obj.y + 20,
          };
          newObjectsToAdd.push(newObj);
          newIds.add(newId);
        }
      });

      if (newObjectsToAdd.length > 0) {
        setObjects((prev) => [...prev, ...newObjectsToAdd]);
        setSelectedObjectIds(newIds);
        setContextMenu(null);
        saveItems(newObjectsToAdd.map(convertToCanvasItem));
      }
    }
  };

  const handleFlipHorizontal = () => {
    if (selectedObjectIdsRef.current.size > 0) {
      setObjects((prev) => {
        const updated = prev.map((obj) =>
          selectedObjectIdsRef.current.has(obj.id)
            ? { ...obj, scaleX: (obj.scaleX || 1) * -1 }
            : obj,
        );
        return updated;
      });
      // Track modified objects for auto-save
      setModifiedObjectIds((prev) => {
        const next = new Set(prev);
        selectedObjectIdsRef.current.forEach((id) => next.add(id));
        return next;
      });
      setContextMenu(null);
    }
  };

  const handleFlipVertical = () => {
    if (selectedObjectIdsRef.current.size > 0) {
      setObjects((prev) => {
        const updated = prev.map((obj) =>
          selectedObjectIdsRef.current.has(obj.id)
            ? { ...obj, scaleY: (obj.scaleY || 1) * -1 }
            : obj,
        );
        return updated;
      });
      // Track modified objects for auto-save
      setModifiedObjectIds((prev) => {
        const next = new Set(prev);
        selectedObjectIdsRef.current.forEach((id) => next.add(id));
        return next;
      });
      setContextMenu(null);
    }
  };

  const handleBringToFront = () => {
    if (selectedObjectIdsRef.current.size > 0) {
      // Naive implementation: move all selected to end
      setObjects((prev) => {
        const selected = new Set(selectedObjectIdsRef.current);
        const bottom = prev.filter((o) => !selected.has(o.id));
        const top = prev.filter((o) => selected.has(o.id));
        return [...bottom, ...top];
      });
      setContextMenu(null);
    }
  };

  const handleSendToBack = () => {
    if (selectedObjectIdsRef.current.size > 0) {
      // Naive implementation: move all selected to start
      setObjects((prev) => {
        const selected = new Set(selectedObjectIdsRef.current);
        const bottom = prev.filter((o) => !selected.has(o.id));
        const top = prev.filter((o) => selected.has(o.id));
        return [...top, ...bottom];
      });
      setContextMenu(null);
    }
  };

  const handleBringForward = () => {
    // Complex for multi-select, just doing nothing or simple reorder for single
    // For now, let's just support single or simple bulk
    if (selectedObjectIdsRef.current.size === 1) {
      const selectedId = Array.from(selectedObjectIdsRef.current)[0];
      setObjects((prev) => {
        const index = prev.findIndex((obj) => obj.id === selectedId);
        if (index === -1 || index === prev.length - 1) return prev;
        const newObjects = [...prev];
        [newObjects[index], newObjects[index + 1]] = [
          newObjects[index + 1],
          newObjects[index],
        ];
        return newObjects;
      });
      setContextMenu(null);
    }
  };

  const handleSendBackward = () => {
    if (selectedObjectIdsRef.current.size === 1) {
      const selectedId = Array.from(selectedObjectIdsRef.current)[0];
      setObjects((prev) => {
        const index = prev.findIndex((obj) => obj.id === selectedId);
        if (index === -1 || index === 0) return prev;
        const newObjects = [...prev];
        [newObjects[index], newObjects[index - 1]] = [
          newObjects[index - 1],
          newObjects[index],
        ];
        return newObjects;
      });
      setContextMenu(null);
    }
  };

  const handleDelete = () => {
    if (selectedObjectIdsRef.current.size > 0) {
      // Delete each selected item via API
      selectedObjectIdsRef.current.forEach((itemId) => {
        deleteItem(itemId);
      });

      // Update local state
      setObjects((prev) =>
        prev.filter((obj) => !selectedObjectIdsRef.current.has(obj.id)),
      );
      setSelectedObjectIds(new Set());
      setContextMenu(null);
    }
  };

  // "Send To" — compute compatible targets for right-clicked object
  const sendToTargets = useMemo<SendToTarget[]>(() => {
    if (!contextMenu?.objectId || !activeToolId || !toolsData?.tools) return [];

    const obj = objects.find((o) => o.id === contextMenu.objectId);
    if (!obj) return [];

    // Only media objects support "Send To"
    if (!["image", "audio", "model3d"].includes(obj.type)) return [];

    // Determine the media type of the right-clicked object
    let mediaType: string;
    if (obj.type === "audio") {
      mediaType = "audio";
    } else if (obj.type === "model3d") {
      mediaType = "3d";
    } else {
      // obj.type === "image" — check if content URL indicates video
      const url = obj.content?.toLowerCase() || "";
      mediaType = /\.(mp4|webm|mov)(\?|$)/.test(url) ? "video" : "image";
    }

    // Find the active tool
    const activeTool = toolsData.tools.find((t) => t.workflow_id === activeToolId);
    if (!activeTool) return [];

    // Infer effective type from input metadata (same heuristic as InputsPanel)
    const inferType = (name: string, label: string, category: string, demoType: string): string => {
      if (["image", "video", "audio", "3d"].includes(demoType)) return demoType;
      const h = `${name} ${label} ${category}`.toLowerCase();
      if (/\bimage\b|\.png|\.jpg|\.jpeg|\.webp|\bimg\b|\bphoto\b|\bpicture\b/.test(h)) return "image";
      if (/\bvideo\b|\.mp4|\.mov|\.webm|\bclip\b|\banimation\b/.test(h)) return "video";
      if (/\baudio\b|\.wav|\.mp3|\.flac|\bsound\b|\bmusic\b/.test(h)) return "audio";
      if (/\b3d\b|\bmesh\b|\.glb|\.gltf|\.obj|\.fbx|\bmodel_?file\b/.test(h)) return "3d";
      return demoType;
    };

    // Filter inputs that match the media type.
    // Visibility config is intentionally ignored here — "Send To" is an explicit
    // user action so all type-compatible inputs should be targetable.
    return activeTool.inputs
      .filter((input) => {
        const cfg = toolConfig?.[input.parameter_name];
        // Configured type takes precedence
        if (cfg?.type) return cfg.type === mediaType;
        // ComfyUI file pickers (model selectors, image selectors) come back as
        // demo_type:"combo" — for those, always fall through to name-based inference
        if (input.demo_type && input.demo_type !== "combo") return input.demo_type === mediaType;
        // Infer from parameter name / label / category
        return inferType(input.parameter_name, input.label, input.category, input.demo_type) === mediaType;
      })
      .map((input) => ({
        parameterName: input.parameter_name,
        label: toolConfig?.[input.parameter_name]?.label || input.label,
        mediaType,
        hint: input.parameter_name,
      }));
  }, [contextMenu?.objectId, activeToolId, toolsData, toolConfig, objects]);

  const handleSendTo = useCallback(async (target: SendToTarget) => {
    if (!contextMenu?.objectId) return;
    const obj = objects.find((o) => o.id === contextMenu.objectId);
    if (!obj?.content) return;

    try {
      const contentUrl = rewriteOperatorUrl(obj.content, currentOperatorUrl);
      const response = await fetch(contentUrl);
      const blob = await response.blob();

      // Extract filename from URL
      let filename = "file";
      try {
        const url = new URL(contentUrl);
        const filenameParam = url.searchParams.get("filename");
        if (filenameParam) {
          filename = filenameParam;
        } else {
          const pathParts = url.pathname.split("/").filter(Boolean);
          if (pathParts.length > 0) {
            filename = decodeURIComponent(pathParts[pathParts.length - 1]);
          }
        }
      } catch {
        // URL parsing failed, use default
      }

      const file = new File([blob], filename, { type: blob.type });
      onToolInputChange?.(target.parameterName, file);
    } catch (err) {
      console.error("Send To: failed to fetch content", err);
    }

    setContextMenu(null);
  }, [contextMenu?.objectId, objects, onToolInputChange]);

  // Tool Execution Handlers
  const handleRunGeneration = async () => {
    if (!activeToolId) {
      console.warn("No tool selected");
      return;
    }

    if (!toolInputs || Object.keys(toolInputs).length === 0) {
      console.warn("No inputs provided");
      return;
    }

    try {
      await executeWorkflow(activeToolId, toolInputs);
    } catch (error) {
      console.error("Execution error:", error);
    }
  };

  const handleStopGeneration = async () => {
    try {
      await cancelWorkflow();
    } catch (error) {
      console.error("Cancel error:", error);
    }
  };

  const handleResultDragStart = (filename: string, result: any) => {
    setDraggedResult({ filename, result });
  };

  const handleResultDrop = (e: React.DragEvent) => {
    if (!draggedResult) return;

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to world coordinates
    const worldX = (screenX - viewRef.current.x) / viewRef.current.scale;
    const worldY = (screenY - viewRef.current.y) / viewRef.current.scale;

    // Create new object based on result type
    const { result, filename } = draggedResult;
    const isImage = result.content_type?.startsWith("image/");
    const isVideo = result.content_type?.startsWith("video/");
    const isText = result.content_type?.startsWith("text/");
    const isAudio = result.content_type?.startsWith("audio/");
    const isModel3d =
      result.content_type?.startsWith("model/") ||
      /\.(glb|gltf|obj|fbx|stl|3ds|dae|ply)$/i.test(filename || "");
    const isMedia = isImage || isVideo;

    // Determine the kind based on content type
    let kind = "file";
    if (isImage) kind = "image";
    else if (isVideo) kind = "video";
    else if (isText) kind = "text";
    else if (isAudio) kind = "audio";
    else if (isModel3d) kind = "model3d";

    // Determine object type and dimensions
    let objectType: CanvasObject["type"] = "text";
    let objectWidth = 150;
    let objectHeight = 100;

    if (isMedia) {
      objectType = "image";
      objectWidth = 300;
      objectHeight = 300;
    } else if (isAudio) {
      objectType = "audio";
      objectWidth = 300;
      objectHeight = 80;
    } else if (isModel3d) {
      objectType = "model3d";
      objectWidth = 400;
      objectHeight = 400;
    }

    const newObject: CanvasObject = {
      id: uuidv4(),
      type: objectType,
      x: worldX,
      y: worldY,
      w: objectWidth,
      h: objectHeight,
      content: result.download_url || result.data,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      label: result.label || filename,
      source: {
        kind: kind,
        run_id: result.run_id || null,
        s3_key: result.download_url || null, // Store download_url as s3_key
        output_selector: {
          filename: filename,
          output_index: 0,
          iteration_index: 0,
        },
      },
    };

    setObjects((prev) => [...prev, newObject]);
    setDraggedResult(null);

    // Save to API
    const canvasItem = convertToCanvasItem(newObject);
    saveItems([canvasItem]);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if input/textarea is focused (though we don't have many yet)
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space" && !e.repeat) {
        setIsSpacePressed(true);
      }

      // Tool Switching
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            setActiveTool("select");
            break;
          case "a":
            setActiveTool("artboard");
            break;
          case "r":
            setActiveTool("rectangle");
            break;
          case "o":
            setActiveTool("ellipse");
            break;
          case "l":
            setActiveTool("line");
            break;
          case "t":
            setActiveTool("text");
            break;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "c":
            e.preventDefault();
            handleCopy();
            break;
          case "v":
            e.preventDefault();
            handlePaste();
            break;
          case "d":
            e.preventDefault();
            handleDuplicate();
            break;
          case "]":
            e.preventDefault();
            handleBringForward();
            break;
          case "[":
            e.preventDefault();
            handleSendBackward();
            break;
        }
      } else {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          handleDelete();
        } else if (e.key === "]") {
          e.preventDefault();
          handleBringToFront();
        } else if (e.key === "[") {
          e.preventDefault();
          handleSendToBack();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const zoomIn = () => {
    setView((prev) => ({
      ...prev,
      scale: Math.min(prev.scale * 1.2, 8),
    }));
  };

  const zoomOut = () => {
    setView((prev) => ({
      ...prev,
      scale: Math.max(prev.scale / 1.2, 0.1),
    }));
  };

  // ... (isPanning useEffect remains same)
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      const worldX = (clientX - viewRef.current.x) / viewRef.current.scale;
      const worldY = (clientY - viewRef.current.y) / viewRef.current.scale;

      // Handle Panning
      if (isPanning) {
        setView((prev) => ({
          ...prev,
          x: prev.x + e.movementX,
          y: prev.y + e.movementY,
        }));
        return;
      }

      // Handle Resizing
      if (interactionStateRef.current.type === "resizing") {
        const { startX, startY, startW, startH, startXObj, startYObj, handle } =
          interactionStateRef.current;
        const currentScale = viewRef.current.scale;

        if (
          startW === undefined ||
          startH === undefined ||
          startXObj === undefined ||
          startYObj === undefined
        )
          return;

        const dx = (e.clientX - startX) / currentScale;
        const dy = (e.clientY - startY) / currentScale;

        // Simple Resize Logic (Axis Aligned)
        let newX = startXObj;
        let newY = startYObj;
        let newW = startW;
        let newH = startH;

        if (handle?.includes("e")) newW = startW + dx;
        if (handle?.includes("w")) {
          newX = startXObj + dx;
          newW = startW - dx;
        }
        if (handle?.includes("s")) newH = startH + dy;
        if (handle?.includes("n")) {
          newY = startYObj + dy;
          newH = startH - dy;
        }

        // Normalize if width/height goes negative
        if (newW < 0) {
          newX = newX + newW;
          newW = Math.abs(newW);
        }
        if (newH < 0) {
          newY = newY + newH;
          newH = Math.abs(newH);
        }

        if (selectedObjectIdsRef.current.size === 1) {
          const selectedId = Array.from(selectedObjectIdsRef.current)[0];
          setObjects((prev) =>
            prev.map((obj) =>
              obj.id === selectedId
                ? { ...obj, x: newX, y: newY, w: newW, h: newH }
                : obj,
            ),
          );
          // Track modified object for batch update on pointerup
          setModifiedObjectIds(new Set([selectedId]));
        }
        return;
      }

      // Handle Rotating
      if (interactionStateRef.current.type === "rotating") {
        const { startXObj, startYObj, startRotation, startAngle } =
          interactionStateRef.current;
        if (
          startXObj === undefined ||
          startYObj === undefined ||
          startRotation === undefined ||
          startAngle === undefined
        )
          return;

        const screenCenterX =
          startXObj * viewRef.current.scale + viewRef.current.x;
        const screenCenterY =
          startYObj * viewRef.current.scale + viewRef.current.y;

        const currentAngle = Math.atan2(
          clientY - screenCenterY,
          clientX - screenCenterX,
        );
        const delta = currentAngle - startAngle;
        let degrees = startRotation + delta * (180 / Math.PI);

        if (e.shiftKey) {
          degrees = Math.round(degrees / 15) * 15;
        }

        if (selectedObjectIdsRef.current.size === 1) {
          const selectedId = Array.from(selectedObjectIdsRef.current)[0];
          setObjects((prev) =>
            prev.map((obj) =>
              obj.id === selectedId ? { ...obj, rotation: degrees } : obj,
            ),
          );
          // Track modified object for batch update on pointerup
          setModifiedObjectIds(new Set([selectedId]));
        }
        return;
      }

      // Handle Marquee Selection
      setSelectionBox((prev) => {
        if (!prev) return null;
        const w = worldX - prev.startX;
        const h = worldY - prev.startY;

        // Normalize for negative drag
        const newX = w < 0 ? worldX : prev.startX;
        const newY = h < 0 ? worldY : prev.startY;
        const newW = Math.abs(w);
        const newH = Math.abs(h);

        // Update Selection Box Visuals
        return { ...prev, x: newX, y: newY, w: newW, h: newH };
      });

      // Handle Drawing
      if (drawingObjectRef.current && dragStartRef.current) {
        const startX = dragStartRef.current.x;
        const startY = dragStartRef.current.y;

        const w = worldX - startX;
        const h = worldY - startY;

        let newX = startX;
        let newY = startY;
        let newW = w;
        let newH = h;
        let newScaleX = 1;
        let newScaleY = 1;

        if (newW < 0) {
          newX = worldX;
          newW = Math.abs(newW);
          newScaleX = -1;
        }

        if (newH < 0) {
          newY = worldY;
          newH = Math.abs(newH);
          newScaleY = -1;
        }

        // For Line/Arrow, we might want to just set end point freely, but standardizing to box is fine for now
        // BUT logic for Line/Arrow "Click-Move-Click" means we are just moving the end point.
        // My DraggableObject renders line from 0,0 to 100%, 100%.
        // So defining a box works perfectly.

        setDrawingObject((prev) =>
          prev
            ? {
                ...prev,
                x: newX,
                y: newY,
                w: newW,
                h: newH,
                scaleX: newScaleX,
                scaleY: newScaleY,
              }
            : null,
        );
      }
    };

    const handlePointerUp = () => {
      // Always reset panning and interaction state
      setIsPanning(false);
      setInteractionState({ type: "idle", startX: 0, startY: 0 });

      // Handle Marquee Selection End (only if selection box exists)
      const currentSelectionBox = selectionBoxRef.current;
      if (currentSelectionBox) {
        const newSelected = new Set(selectedObjectIdsRef.current);

        objectsRef.current.forEach((obj) => {
          const isIntersecting =
            currentSelectionBox.x < obj.x + obj.w &&
            currentSelectionBox.x + currentSelectionBox.w > obj.x &&
            currentSelectionBox.y < obj.y + obj.h &&
            currentSelectionBox.y + currentSelectionBox.h > obj.y;

          if (isIntersecting) {
            newSelected.add(obj.id);
          }
        });
        setSelectedObjectIds(newSelected);
        setSelectionBox(null);
      }

      if (drawingObjectRef.current) {
        const activeTool = activeToolRef.current;
        // If Click-Move-Click tool (Line/Arrow), DO NOT finish here (Wait for second click in MouseDown)
        if (activeTool === "line" || activeTool === "arrow") {
          return;
        }

        // Finalize drawing for others (Drag-To-Draw)
        const obj = drawingObjectRef.current;
        // Avoid creating tiny objects on accidental clicks (unless it's text)
        if (obj.w > 5 || obj.h > 5 || obj.type === "text") {
          setObjects((prev) => [...prev, obj]);
          setSelectedObjectIds(new Set([obj.id]));
          saveItems([convertToCanvasItem(obj)]);
        }
        setDrawingObject(null);
        dragStartRef.current = null;
        setActiveTool("select"); // Reset to select tool after drawing
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isPanning]);

  const getCursor = () => {
    if (isPanning) return "cursor-grabbing [&_*]:cursor-grabbing";
    if (isSpacePressed) return "cursor-grab [&_*]:cursor-grab";
    switch (activeTool) {
      case "text":
        return "cursor-text";
      case "select":
        return "cursor-default";
      default:
        return "cursor-crosshair";
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`flex-1 bg-background-canvas relative overflow-hidden select-none group ${getCursor()}`}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        handleContextMenu(e);
      }}
      onDragOver={(e) => {
        if (draggedResult) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleResultDrop}
      data-canvas-surface="true"
    >
      {/* Texture/Grid Pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle, #9fa0a1 1.5px, transparent 1.5px)",
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      ></div>

      {/* Toolbar */}
      <CanvasToolbar activeTool={activeTool} onSelectTool={setActiveTool} />

      {/* Floating Action Bar (Pill) */}
      {selectedObjectIds.size === 1 &&
        (() => {
          const selectedId = Array.from(selectedObjectIds)[0];
          const obj = objects.find((o) => o.id === selectedId);
          if (
            obj &&
            [
              "text",
              "rectangle",
              "ellipse",
              "artboard",
              "line",
              "arrow",
              "image",
              "video",
              "audio",
              "model3d",
            ].includes(obj.type)
          ) {
            // Calculate screen position for the pill

            // We need to render it absolutely in the wrapper
            // The object position is in world coordinates.
            // We need to convert world to wrapper/screen coordinates.

            // Screen = World * Scale + Pan
            const screenX = obj.x * view.scale + view.x;
            const screenY = obj.y * view.scale + view.y;
            const screenW = obj.w * view.scale;

            // Center it horizontally relative to object
            // Position it slightly above the object

            return (
              <div
                style={{
                  position: "absolute",
                  left: screenX + screenW / 2, // Center horizontally
                  top: screenY - 50, // Position above
                  transform: "translateX(-50%)", // True centering
                  zIndex: 50,
                  pointerEvents: "auto", // Ensure interaction
                }}
              >
                <SelectionActionbar
                  selectedObject={obj}
                  onUpdateObject={(updates) =>
                    handleObjectUpdate(obj.id, updates)
                  }
                  onExport={() => setShowExportModal(true)}
                />
              </div>
            );
          }
          return null;
        })()}

      {/* Scale Indicator & Zoom Controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/5 rounded-full p-1 shadow-lg">
        <Tooltip content="Zoom Out" side="bottom" delay={600}>
          <button
            onClick={zoomOut}
            className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Minus width={16} />
          </button>
        </Tooltip>
        <span className="text-zinc-300 text-xs font-mono w-10 text-center select-none">
          {Math.round(view.scale * 100)}%
        </span>
        <Tooltip content="Zoom In" side="bottom" delay={600}>
          <button
            onClick={zoomIn}
            className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Plus width={16} />
          </button>
        </Tooltip>
      </div>

      {/* Context Menu */}
      {contextMenu && contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onDuplicate={handleDuplicate}
          onFlipHorizontal={handleFlipHorizontal}
          onFlipVertical={handleFlipVertical}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onBringForward={handleBringForward}
          onSendBackward={handleSendBackward}
          onDelete={handleDelete}
          hasSelection={selectedObjectIds.size > 0}
          hasClipboard={!!clipboard}
          sendToTargets={sendToTargets}
          onSendTo={handleSendTo}
        />
      )}

      {/* Transform Container */}
      <div
        ref={transformLayerRef}
        data-transform-layer="true"
        className="absolute inset-0 origin-top-left will-change-transform"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {objects
          .sort((a, b) => {
            if (a.type === "artboard" && b.type !== "artboard") return -1;
            if (a.type !== "artboard" && b.type === "artboard") return 1;
            return 0; // Maintain relative order of others
          })
          .map((obj) => (
            <DraggableObject
              key={obj.id}
              {...obj}
              content={rewriteOperatorUrl(obj.content, currentOperatorUrl)}
              scale={view.scale}
              isSelected={selectedObjectIds.has(obj.id)}
              onSelect={(id) => {
                // If shift key, toggle selection
                // But DraggableObject.onSelect doesn't pass event.
                // We might need to update DraggableObject signature or handle it here.
                // For now, let's just select single unless shift key was handled in MouseDown?
                // Actually MouseDown on object is handled in DraggableObject.
                // We need to update DraggableObject to handle multi-select logic or pass event.
                // Let's assume onSelect sets it as the "primary" or exclusive selection for now to match old behavior
                // XOR adapt handleMouseDown in DraggableObject.
                // For this step, I will just set it as single selection to keep it simple and working.
                setSelectedObjectIds(new Set([id]));
              }}
              onMove={handleObjectMove}
              onUpdate={handleObjectUpdate}
              onResizeStart={handleResizeStart}
              onRotateStart={handleRotateStart}
              scaleX={obj.scaleX}
              scaleY={obj.scaleY}
              rotation={obj.rotation}
              label={obj.label}
              onContextMenu={handleContextMenu}
              isFrozen={
                activeTool !== "select" || interactionState.type !== "idle"
              } // Freeze when drawing or transforming
              isSpacePressed={isSpacePressed} // Pass space state for panning
              forceBack={obj.type === "artboard"} // New prop to force background
            />
          ))}

        {/* Selection Box */}
        {selectionBox && (
          <div
            className="absolute border border-blue-500 bg-blue-500/10 pointer-events-none z-50"
            style={{
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.w,
              height: selectionBox.h,
            }}
          />
        )}

        {/* Drawing Preview */}
        {drawingObject && (
          <div
            className="absolute border border-indigo-500 bg-indigo-500/10 pointer-events-none"
            style={{
              left: drawingObject.x,
              top: drawingObject.y,
              width: drawingObject.w,
              height: drawingObject.h,
              transform: `scale(${drawingObject.scaleX || 1}, ${drawingObject.scaleY || 1})`,
              transformOrigin: "top left", // Important for creating flip effect from top-left anchor
            }}
          />
        )}
      </div>

      {/* Floating Execution Menu */}
      <ExecutionMenu
        executionState={executionState}
        activeToolId={activeToolId}
        projectId={projectId}
        onRunGeneration={handleRunGeneration}
        onStopGeneration={handleStopGeneration}
        onResultDragStart={handleResultDragStart}
        onReset={reset}
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        canvasId={canvasId}
        canvasName={canvas?.name || "Untitled"}
        objects={objects}
        selectedObjectIds={selectedObjectIds}
      />
    </div>
  );
}
