"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";

// Load model-viewer web component from CDN
let modelViewerLoaded = false;
let modelViewerLoading = false;

const loadModelViewer = (): Promise<void> => {
  return new Promise((resolve) => {
    if (modelViewerLoaded) {
      resolve();
      return;
    }
    if (modelViewerLoading) {
      // Wait for existing load
      const checkLoaded = setInterval(() => {
        if (modelViewerLoaded) {
          clearInterval(checkLoaded);
          resolve();
        }
      }, 100);
      return;
    }
    modelViewerLoading = true;
    const script = document.createElement("script");
    script.type = "module";
    script.src =
      "https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js";
    script.onload = () => {
      modelViewerLoaded = true;
      modelViewerLoading = false;
      resolve();
    };
    script.onerror = () => {
      modelViewerLoading = false;
      resolve(); // Resolve anyway, fallback will be shown
    };
    document.head.appendChild(script);
  });
};

// 3D Model Content Component with dynamic model-viewer loading
function Model3dContent({
  content,
  label,
  isSelected,
}: {
  content: string;
  label?: string;
  isSelected: boolean;
}) {
  const [viewerReady, setViewerReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // model-viewer only supports GLB/GLTF — check filename param or path
  const isViewerSupported = /\.(glb|gltf)([?&#]|$)/i.test(content || "");

  useEffect(() => {
    if (content && isViewerSupported) {
      loadModelViewer()
        .then(() => {
          if (
            typeof window !== "undefined" &&
            customElements.get("model-viewer")
          ) {
            setViewerReady(true);
          }
        })
        .catch(() => setLoadError(true));
    }
  }, [content, isViewerSupported]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (content) {
      const link = document.createElement("a");
      link.href = content;
      link.download =
        label || content.split("/").pop()?.split("?")[0] || "model.glb";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div
      className={`w-full h-full bg-zinc-900 p-5 rounded-lg overflow-hidden ${
        isSelected ? "border-2 border-emerald-500" : "border border-white/5"
      }`}
    >
      <div className="w-full h-full relative">
        {viewerReady && isViewerSupported && content ? (
          // @ts-ignore - model-viewer is a web component
          <model-viewer
            src={content}
            alt={label || "3D Model"}
            auto-rotate
            camera-controls
            shadow-intensity="1"
            style={{ width: "100%", height: "100%", background: "#18181b" }}
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          />
        ) : (
          /* Fallback/Loading placeholder for 3D models */
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 bg-gradient-to-br from-zinc-900 to-zinc-800">
            <div className="w-16 h-16 bg-zinc-800 rounded-xl flex items-center justify-center border border-white/5">
              <Icon
                icon="solar:box-minimalistic-bold"
                className="w-8 h-8 text-violet-500"
              />
            </div>
            <p className="text-xs text-zinc-300 text-center truncate max-w-full font-medium">
              {label || "3D Model"}
            </p>
            <p className="text-[10px] text-zinc-500">
              {content?.split("/").pop()?.split("?")[0] || "model.glb"}
            </p>
            {!viewerReady && !loadError && (
              <p className="text-[10px] text-zinc-600">Loading viewer...</p>
            )}
            {/* Download button */}
            <button
              onClick={handleDownload}
              onPointerDown={(e) => e.stopPropagation()}
              className="mt-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Icon icon="lucide:download" className="w-3.5 h-3.5" />
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface DraggableObjectProps {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type:
    | "image"
    | "text"
    | "rectangle"
    | "ellipse"
    | "line"
    | "arrow"
    | "artboard"
    | "audio"
    | "model3d";
  content: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  scale: number; // Viewport scale needed for correct drag calculation
  scaleX?: number; // New for flipping
  scaleY?: number; // New for flipping
  rotation?: number; // New
  label?: string; // New
  style?: {
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
  };
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
  isFrozen?: boolean; // New: to prevent dragging when actively drawing another tool
  isSpacePressed?: boolean; // New: for space-based canvas panning
  onUpdate?: (id: string, updates: any) => void;
  onResizeStart?: (e: React.MouseEvent, direction: string) => void; // New
  onRotateStart?: (e: React.MouseEvent) => void; // New
  forceBack?: boolean; // New: maintain low z-index
}

export default function DraggableObject({
  id,
  x,
  y,
  w,
  h,
  type,
  content,
  isSelected,
  onSelect,
  onMove,
  scale,
  scaleX,
  scaleY,
  rotation = 0,
  label,
  style,
  onContextMenu,
  isFrozen,
  isSpacePressed,
  onUpdate,
  onResizeStart,
  onRotateStart,
  forceBack,
}: DraggableObjectProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false); // For text editing & artboard label
  const [isLabelEditing, setIsLabelEditing] = useState(false); // Specifically for artboard label

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const initialPosRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerDownTimeRef = useRef<number | null>(null); // Track when pointer was pressed
  const isDraggingRef = useRef(false); // Ref for immediate access in event handlers
  const isPotentialDragRef = useRef(false); // Ref for immediate access in event handlers
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const DRAG_THRESHOLD = 10; // Pixels to move before starting drag
  const DRAG_TIME_THRESHOLD = 300; // Milliseconds to hold before drag can start

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isLabelEditing && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [isLabelEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (type === "text") {
      e.stopPropagation();
      e.preventDefault();
      setIsEditing(true);
      // Cancel any ongoing drag
      isDraggingRef.current = false;
      isPotentialDragRef.current = false;
      setIsDragging(false);
      dragStartRef.current = null;
      initialPosRef.current = null;
      activePointerIdRef.current = null;
    }
  };

  const handleLabelDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLabelEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    setIsLabelEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsEditing(false);
      setIsLabelEditing(false);
    } else if (e.key === "Enter" && isLabelEditing) {
      setIsLabelEditing(false);
    }
    // Stop propagation so delete/backspace doesn't delete the object
    e.stopPropagation();
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onUpdate?.(id, { content: e.target.value });
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate?.(id, { label: e.target.value });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isFrozen || isEditing || isLabelEditing) return;

    // Allow panning if Space is pressed (don't start drag, let event bubble to canvas)
    if (isSpacePressed) {
      return;
    }

    // Don't start drag if clicking on a resize/rotate handle or interactive element
    const target = e.target as HTMLElement;
    if (
      target.closest("[data-resize-handle]") ||
      target.closest("[data-rotate-handle]") ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT"
    ) {
      return;
    }

    e.stopPropagation(); // Prevent canvas panning
    if (e.button === 0) {
      // Only left click - select immediately, but don't start dragging yet
      onSelect(id);
      // Store initial state for potential drag, but don't enable drag tracking yet
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      initialPosRef.current = { x, y };
      activePointerIdRef.current = e.pointerId;
      pointerDownTimeRef.current = Date.now(); // Track when pointer went down
      // Note: isPotentialDragRef stays false until time + distance thresholds are met
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isFrozen) return;

    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
    onContextMenu?.(e, id);
  };

  useEffect(() => {
    const clearDragState = () => {
      isDraggingRef.current = false;
      isPotentialDragRef.current = false;
      setIsDragging(false);
      dragStartRef.current = null;
      initialPosRef.current = null;
      activePointerIdRef.current = null;
      pointerDownTimeRef.current = null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      // Use refs for all checks to avoid stale closures
      if (
        !dragStartRef.current ||
        !initialPosRef.current ||
        activePointerIdRef.current === null ||
        e.pointerId !== activePointerIdRef.current ||
        pointerDownTimeRef.current === null
      )
        return;

      // If no mouse button is pressed, clear state and bail
      // This handles cases where pointerup was missed
      if (e.buttons === 0) {
        clearDragState();
        return;
      }

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const timeHeld = Date.now() - pointerDownTimeRef.current;

      // Only enable potential drag if pointer has been held for minimum time
      // This prevents accidental drags from quick clicks
      if (!isPotentialDragRef.current && timeHeld >= DRAG_TIME_THRESHOLD) {
        isPotentialDragRef.current = true;
      }

      // If we're in potential drag state and moved beyond threshold, promote to actual drag
      if (
        isPotentialDragRef.current &&
        !isDraggingRef.current &&
        distance >= DRAG_THRESHOLD
      ) {
        isDraggingRef.current = true;
        setIsDragging(true); // Update state for cursor rendering
      }

      // Only move the object if we're actually dragging (ref is immediately true)
      if (isDraggingRef.current) {
        const scaledDx = dx / scale;
        const scaledDy = dy / scale;
        onMove(
          id,
          initialPosRef.current.x + scaledDx,
          initialPosRef.current.y + scaledDy,
        );
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      // Always clear drag state if we have any active drag-related state
      // This ensures we never get stuck in drag mode
      if (
        activePointerIdRef.current !== null ||
        isPotentialDragRef.current ||
        isDraggingRef.current
      ) {
        clearDragState();
      }
    };

    const handlePointerLeave = () => {
      // If pointer leaves window while dragging, clean up
      if (isPotentialDragRef.current || isDraggingRef.current) {
        clearDragState();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key cancels any ongoing drag
      if (
        e.key === "Escape" &&
        (isPotentialDragRef.current || isDraggingRef.current)
      ) {
        clearDragState();
      }
    };

    // Always listen - handlers early-return via refs when not dragging
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, onMove, scale]);

  const renderContent = () => {
    switch (type) {
      case "image":
        // Detect video URLs by extension
        const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(content || "");
        return (
          <div className="w-full h-full relative">
            {isVideo ? (
              <video
                src={content}
                className="w-full h-full object-cover pointer-events-none"
                muted
                loop
                playsInline
                autoPlay
              />
            ) : (
              <img
                src={content}
                className="w-full h-full object-cover pointer-events-none"
                alt=""
              />
            )}
            {isSelected && (
              <div className="absolute inset-0 border-2 border-emerald-500 rounded-lg pointer-events-none"></div>
            )}
          </div>
        );
      case "text":
        return (
          <div
            className={`w-full h-full p-2 flex items-center justify-start ${isSelected && !isEditing ? "border border-emerald-500 border-dashed" : ""}`}
            onDoubleClick={handleDoubleClick}
          >
            {isEditing ? (
              <textarea
                ref={textareaRef}
                className="w-full h-full bg-transparent text-zinc-300 text-sm font-sans resize-none outline-none"
                style={{
                  color: style?.textColor,
                  fontSize: style?.fontSize,
                  fontFamily: style?.fontFamily,
                }}
                value={content}
                onChange={handleTextChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <p
                className="text-zinc-300 text-sm font-sans leading-relaxed pointer-events-none select-none whitespace-pre-wrap"
                style={{
                  color: style?.textColor,
                  fontSize: style?.fontSize,
                  fontFamily: style?.fontFamily,
                }}
              >
                {content || "Double click to edit"}
              </p>
            )}
          </div>
        );
      case "rectangle":
      case "artboard":
        return (
          <div
            className={`w-full h-full transition-colors`}
            style={{
              borderWidth: style?.borderWidth || 1,
              borderColor: isSelected
                ? "#10b981"
                : style?.borderColor || "#52525b",
              backgroundColor:
                style?.backgroundColor ||
                (type === "artboard" ? "#3f3f46" : "#3f3f46"),
            }}
          >
            {type === "artboard" && (
              <>
                {/* Artboard Label */}
                {isLabelEditing ? (
                  <div className="absolute -top-7 left-0 h-6 w-full">
                    <input
                      ref={labelInputRef}
                      className="bg-transparent text-xs text-zinc-300 font-medium outline-none border border-emerald-500/50 rounded px-1.5 py-0.5 w-auto min-w-[60px]"
                      value={label || "Board"}
                      onChange={handleLabelChange}
                      onBlur={handleBlur}
                      onKeyDown={handleKeyDown}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  </div>
                ) : (
                  <div
                    className="absolute -top-6 left-0 text-xs text-zinc-500 font-medium select-none cursor-text hover:text-zinc-300 transition-colors"
                    onDoubleClick={handleLabelDoubleClick}
                  >
                    {label || "Board"}
                  </div>
                )}
              </>
            )}
          </div>
        );
      case "ellipse":
        return (
          <div
            className={`w-full h-full rounded-full transition-colors`}
            style={{
              borderWidth: style?.borderWidth || 1,
              borderColor: isSelected
                ? "#10b981"
                : style?.borderColor || "#52525b",
              backgroundColor: style?.backgroundColor || "#3f3f46",
            }}
          />
        );
      case "line":
        return (
          <div className="w-full h-full relative">
            <svg className="w-full h-full overflow-visible">
              <line
                x1="0"
                y1="0"
                x2="100%"
                y2="100%"
                stroke={style?.borderColor || "#a1a1aa"}
                strokeWidth="2"
              />
            </svg>
          </div>
        );
      case "arrow":
        return (
          <div className="w-full h-full relative">
            <svg className="w-full h-full overflow-visible">
              <defs>
                <marker
                  id={`arrowhead-${id}`}
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill={style?.borderColor || "#a1a1aa"}
                  />
                </marker>
              </defs>
              <line
                x1="0"
                y1="0"
                x2="100%"
                y2="100%"
                stroke={style?.borderColor || "#a1a1aa"}
                strokeWidth="2"
                markerEnd={`url(#arrowhead-${id})`}
              />
            </svg>
          </div>
        );
      case "audio":
        return (
          <div
            className={`w-full h-full bg-zinc-800/80 rounded-lg flex flex-col items-center justify-center p-3 gap-2 ${
              isSelected
                ? "border-2 border-emerald-500"
                : "border border-white/5"
            }`}
          >
            <div className="flex items-center gap-2 w-full">
              <div className="w-10 h-10 bg-zinc-700 rounded-lg flex items-center justify-center shrink-0">
                <svg
                  className="w-5 h-5 text-emerald-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-400 truncate">
                  {label || "Audio"}
                </p>
              </div>
            </div>
            <audio
              src={content}
              controls
              className="w-full h-8"
              style={{ colorScheme: "dark" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
        );
      case "model3d":
        return (
          <Model3dContent
            content={content}
            label={label}
            isSelected={isSelected}
          />
        );
      default:
        return null; // Should not happen
    }
  };

  const ResizeHandle = ({
    direction,
    cursor,
  }: {
    direction: string;
    cursor: string;
  }) => (
    <div
      data-resize-handle={direction}
      className={`absolute w-3 h-3 bg-white border border-zinc-400 rounded-full z-20 ${cursor}`}
      style={{
        top: direction.includes("n")
          ? -6
          : direction.includes("s")
            ? "calc(100% - 6px)"
            : "calc(50% - 6px)",
        left: direction.includes("w")
          ? -6
          : direction.includes("e")
            ? "calc(100% - 6px)"
            : "calc(50% - 6px)",
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onResizeStart?.(e as unknown as React.MouseEvent, direction);
      }}
    />
  );

  return (
    <div
      data-canvas-object="true"
      data-object-id={id}
      className={`absolute group
                ${isDragging ? "cursor-move" : isSpacePressed ? "cursor-grab" : isFrozen ? "cursor-default" : "cursor-pointer"}
            `}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        // Apply rotation in transform
        transform: `translate(0, 0) rotate(${rotation}deg) scale(${scaleX || 1}, ${scaleY || 1})`,
        transformOrigin: "center center", // Rotate around center
        zIndex: forceBack ? 0 : isSelected ? 10 : 1, // Artboards always 0
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {renderContent()}

      {/* Resize Handles */}
      {isSelected && (
        <>
          {/* Rotation Handle - Moved to Bottom */}
          <div
            data-rotate-handle="true"
            className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-5 h-5 bg-white border border-zinc-400 rounded-full z-20 cursor-grab flex items-center justify-center shadow-sm"
            onPointerDown={(e) => {
              e.stopPropagation();
              onRotateStart?.(e as unknown as React.MouseEvent);
            }}
          >
            <Icon
              icon="lucide:rotate-cw"
              width="12"
              height="12"
              className="text-black"
            />
          </div>

          {/* Connecting line for rotation handle */}
          <div className="absolute -bottom-10 left-1/2 w-px h-10 bg-emerald-500 z-10" />

          {/* Corner Handles */}
          <ResizeHandle direction="nw" cursor="cursor-nwse-resize" />
          <ResizeHandle direction="ne" cursor="cursor-nesw-resize" />
          <ResizeHandle direction="sw" cursor="cursor-nesw-resize" />
          <ResizeHandle direction="se" cursor="cursor-nwse-resize" />

          {/* Edge Handles */}
          <ResizeHandle direction="n" cursor="cursor-ns-resize" />
          <ResizeHandle direction="s" cursor="cursor-ns-resize" />
          <ResizeHandle direction="w" cursor="cursor-ew-resize" />
          <ResizeHandle direction="e" cursor="cursor-ew-resize" />
        </>
      )}
    </div>
  );
}
