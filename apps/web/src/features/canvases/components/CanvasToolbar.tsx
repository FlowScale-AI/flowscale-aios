"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";
import { Tooltip } from "@flowscale/ui";

export type CanvasToolType =
  | "select"
  | "artboard"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "text";

interface CanvasToolbarProps {
  activeTool: CanvasToolType;
  onSelectTool: (tool: CanvasToolType) => void;
}

export function CanvasToolbar({
  activeTool,
  onSelectTool,
}: CanvasToolbarProps) {
  const [isShapesOpen, setIsShapesOpen] = useState(false);

  // Tools that are always visible
  const mainTools: { id: CanvasToolType; icon: string; label: string }[] = [
    { id: "select", icon: "lucide:mouse-pointer-2", label: "Select" },
    { id: "artboard", icon: "lucide:layout-template", label: "Board" },
    { id: "text", icon: "lucide:type", label: "Text" },
  ];

  // Shapes for the dropdown
  const shapeTools: { id: CanvasToolType; icon: string; label: string }[] = [
    { id: "rectangle", icon: "lucide:square", label: "Rectangle" },
    { id: "ellipse", icon: "lucide:circle", label: "Ellipse" },
    { id: "line", icon: "lucide:minus", label: "Line" },
    { id: "arrow", icon: "lucide:move-up-right", label: "Arrow" },
  ];

  const currentShape =
    shapeTools.find((t) => t.id === activeTool) || shapeTools[0];
  const isShapeActive = shapeTools.some((t) => t.id === activeTool);

  return (
    <div className="absolute top-4 left-4 z-30 flex flex-col gap-1 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-lg p-1 shadow-xl">
      {/* Select Tool */}
      <Tooltip content="Select (V)" side="right" delay={600}>
        <button
          onClick={() => onSelectTool("select")}
          className={`w-10 h-10 flex items-center justify-center rounded-md transition-all duration-200 group relative
            ${
              activeTool === "select"
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }
          `}
        >
          <Icon icon="lucide:mouse-pointer-2" width="20" height="20" />
        </button>
      </Tooltip>

      {/* Artboard Tool */}
      <Tooltip content="Board (A)" side="right" delay={600}>
        <button
          onClick={() => onSelectTool("artboard")}
          className={`w-10 h-10 flex items-center justify-center rounded-md transition-all duration-200 group relative
            ${
              activeTool === "artboard"
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }
          `}
        >
          <Icon icon="lucide:layout-template" width="20" height="20" />
        </button>
      </Tooltip>

      {/* Shapes Dropdown Group */}
      <div
        className="relative flex items-center justify-center"
        onMouseEnter={() => setIsShapesOpen(true)}
        onMouseLeave={() => setIsShapesOpen(false)}
      >
        <button
          className={`w-10 h-10 flex items-center justify-center rounded-md transition-all duration-200 group relative
            ${
              isShapeActive
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }
          `}
          title="Shapes"
          onClick={() => onSelectTool(currentShape.id)} // Select last used or default shape
        >
          <Icon
            icon={isShapeActive ? currentShape.icon : "lucide:shapes"}
            width="20"
            height="20"
          />
          {/* Component for arrow indicator if needed, but keeping it simple */}
          <div className="absolute right-0.5 bottom-0.5 opacity-50">
            <Icon icon="lucide:chevron-right" width="8" height="8" />
          </div>
        </button>

        {/* Dropdown Menu */}
        {isShapesOpen && (
          <div className="absolute left-full top-0 pl-2 z-50 animate-in fade-in slide-in-from-left-2 duration-150">
            <div className="bg-zinc-900/95 backdrop-blur-md border border-white/10 rounded-lg p-1 shadow-xl flex flex-col gap-1 w-max">
              {shapeTools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTool(tool.id);
                    setIsShapesOpen(false);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group
                    ${
                      activeTool === tool.id
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }
                  `}
                >
                  <Icon icon={tool.icon} width="18" height="18" />
                  <span className="text-sm font-medium">{tool.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Text Tool */}
      <Tooltip content="Text (T)" side="right" delay={600}>
        <button
          onClick={() => onSelectTool("text")}
          className={`w-10 h-10 flex items-center justify-center rounded-md transition-all duration-200 group relative
            ${
              activeTool === "text"
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }
          `}
        >
          <Icon icon="lucide:type" width="20" height="20" />
        </button>
      </Tooltip>
    </div>
  );
}
