"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";
import { CanvasObject } from "./CanvasSurface";
import { Tooltip } from "@flowscale/ui";

interface SelectionActionbarProps {
  selectedObject: CanvasObject;
  onUpdateObject: (updates: any) => void;
  onExport: () => void;
}

export function SelectionActionbar({
  selectedObject,
  onUpdateObject,
  onExport,
}: SelectionActionbarProps) {
  const [isFontFamilyOpen, setIsFontFamilyOpen] = useState(false);
  const [activeColorPicker, setActiveColorPicker] = useState<
    "fill" | "stroke" | null
  >(null);

  const fontFamilies = [
    { label: "Inter", value: "Inter" },
    { label: "Arial", value: "Arial" },
    { label: "Serif", value: "serif" },
    { label: "Mono", value: "monospace" },
    { label: "Comic Sans", value: '"Comic Sans MS", "Comic Sans", cursive' },
  ];

  const COLORS = [
    "#ef4444", // red-500
    "#f97316", // orange-500
    "#f59e0b", // amber-500
    "#eab308", // yellow-500
    "#84cc16", // lime-500
    "#22c55e", // green-500
    "#10b981", // emerald-500
    "#14b8a6", // teal-500
    "#06b6d4", // cyan-500
    "#0ea5e9", // sky-500
    "#3b82f6", // blue-500
    "#6366f1", // indigo-500
    "#8b5cf6", // violet-500
    "#a855f7", // purple-500
    "#d946ef", // fuchsia-500
    "#ec4899", // pink-500
    "#f43f5e", // rose-500
    "#71717a", // zinc-500
  ];

  const PRESET_COLORS_GRID = [
    ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e"],
    ["#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1"],
    ["#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#71717a"],
  ];

  // Show color picker for text, rectangle, ellipse, artboard, line, arrow
  const showColorPicker = [
    "text",
    "rectangle",
    "ellipse",
    "artboard",
    "line",
    "arrow",
  ].includes(selectedObject.type);

  // Always show the actionbar for any selected object (including images/videos for Export button)
  // Just hide color/text controls for non-applicable types

  return (
    <div
      className="flex items-center gap-1 bg-zinc-900 border border-white/10 rounded-full p-1 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200"
      onMouseDown={(e) => e.stopPropagation()} // Prevent drag/selection of canvas
    >
      {/* Font Family Dropdown - Only for text */}
      {selectedObject.type === "text" && (
        <div className="relative">
          <Tooltip content="Font Family" side="top" delay={700}>
            <button
              onClick={() => setIsFontFamilyOpen(!isFontFamilyOpen)}
              className="h-8 px-3 flex items-center gap-2 rounded-full text-zinc-300 hover:text-white hover:bg-white/5 transition-all text-xs font-medium"
            >
              <span className="truncate max-w-20">
                {fontFamilies.find(
                  (f) => f.value === selectedObject.style?.fontFamily,
                )?.label || "Inter"}
              </span>
              <Icon icon="lucide:chevron-down" width="12" height="12" />
            </button>
          </Tooltip>

          {isFontFamilyOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsFontFamilyOpen(false)}
              />
              <div className="absolute top-full left-0 mt-2 w-32 bg-zinc-900 border border-white/10 rounded-lg shadow-xl z-50 py-1 flex flex-col overflow-hidden">
                {fontFamilies.map((font) => (
                  <button
                    key={font.value}
                    onClick={() => {
                      onUpdateObject({
                        style: {
                          ...selectedObject.style,
                          fontFamily: font.value,
                        },
                      });
                      setIsFontFamilyOpen(false);
                    }}
                    className={`px-3 py-2 text-left text-xs hover:bg-white/5 transition-colors
                    ${
                      selectedObject.style?.fontFamily === font.value
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-zinc-400"
                    }
                  `}
                    style={{ fontFamily: font.value }}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {selectedObject.type === "text" && (
        <div className="w-px h-4 bg-white/10 mx-1" />
      )}

      {/* Font Size Input - Only for text */}
      {selectedObject.type === "text" && (
        <div className="flex items-center gap-1 bg-white/5 rounded-full px-2 h-8 border border-transparent focus-within:border-emerald-500/50 transition-colors">
          <Icon
            icon="lucide:type"
            width="12"
            height="12"
            className="text-zinc-500"
          />
          <input
            type="number"
            value={selectedObject.style?.fontSize || 16}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (!isNaN(val) && val > 0) {
                onUpdateObject({
                  style: { ...selectedObject.style, fontSize: val },
                });
              }
            }}
            className="w-8 bg-transparent text-xs text-center text-zinc-300 focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            min="1"
            max="200"
          />
        </div>
      )}

      {/* Color Pickers */}
      {showColorPicker && (
        <>
          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Fill Color Picker (Primary) */}
          <div className="relative">
            <Tooltip
              content={
                ["line", "arrow"].includes(selectedObject.type)
                  ? "Color"
                  : selectedObject.type === "text"
                    ? "Text Color"
                    : "Fill Color"
              }
              side="top"
              delay={700}
            >
              <button
                onClick={() =>
                  setActiveColorPicker(
                    activeColorPicker === "fill" ? null : "fill",
                  )
                }
                className={`w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors ${activeColorPicker === "fill" ? "bg-white/10" : ""}`}
              >
                <div
                  className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                  style={{
                    backgroundColor:
                      selectedObject.type === "text"
                        ? selectedObject.style?.textColor || "#ffffff"
                        : ["line", "arrow"].includes(selectedObject.type)
                          ? selectedObject.style?.borderColor || "#a1a1aa"
                          : selectedObject.style?.backgroundColor ||
                            "transparent",
                    backgroundImage:
                      !selectedObject.style?.backgroundColor &&
                      !["text", "line", "arrow"].includes(selectedObject.type)
                        ? "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)"
                        : undefined,
                    backgroundSize:
                      !selectedObject.style?.backgroundColor &&
                      !["text", "line", "arrow"].includes(selectedObject.type)
                        ? "4px 4px"
                        : undefined,
                    backgroundPosition:
                      !selectedObject.style?.backgroundColor &&
                      !["text", "line", "arrow"].includes(selectedObject.type)
                        ? "0 0, 0 2px, 2px -2px, -2px 0px"
                        : undefined,
                  }}
                />
              </button>
            </Tooltip>

            {activeColorPicker === "fill" && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setActiveColorPicker(null)}
                />
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 bg-zinc-900 border border-white/10 rounded-xl shadow-xl z-50 min-w-50 flex flex-col gap-3">
                  {/* No Color Option - Hide for line/arrow/text */}
                  {!["text", "line", "arrow"].includes(selectedObject.type) && (
                    <button
                      onClick={() => {
                        onUpdateObject({
                          style: {
                            ...selectedObject.style,
                            backgroundColor: undefined,
                          },
                        });
                        setActiveColorPicker(null);
                      }}
                      className="flex items-center gap-2 p-1.5 rounded-md hover:bg-white/5 transition-colors text-xs text-zinc-400 hover:text-white mb-1"
                    >
                      <div className="w-5 h-5 rounded-full border border-white/20 relative overflow-hidden">
                        <div className="absolute inset-0 bg-red-500/80 rotate-45 w-px left-1/2 -ml-[0.5px]"></div>
                      </div>
                      <span>No Color</span>
                    </button>
                  )}

                  {/* Preset Grid */}
                  <div className="grid grid-cols-6 gap-1.5">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          if (selectedObject.type === "text") {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                textColor: color,
                              },
                            });
                          } else if (
                            ["line", "arrow"].includes(selectedObject.type)
                          ) {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                borderColor: color,
                              },
                            });
                          } else {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                backgroundColor: color,
                              },
                            });
                          }
                          setActiveColorPicker(null);
                        }}
                        className="w-6 h-6 rounded-full border border-transparent hover:border-white shadow-sm hover:scale-110 transition-all"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>

                  <div className="h-px bg-white/10 w-full" />

                  {/* Custom Color Input */}
                  <div className="flex items-center gap-2">
                    <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/20 shrink-0">
                      <input
                        type="color"
                        value={
                          selectedObject.type === "text"
                            ? selectedObject.style?.textColor || "#ffffff"
                            : ["line", "arrow"].includes(selectedObject.type)
                              ? selectedObject.style?.borderColor || "#a1a1aa"
                              : selectedObject.style?.backgroundColor ||
                                "#27272a"
                        }
                        onChange={(e) => {
                          if (selectedObject.type === "text") {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                textColor: e.target.value,
                              },
                            });
                          } else if (
                            ["line", "arrow"].includes(selectedObject.type)
                          ) {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                borderColor: e.target.value,
                              },
                            });
                          } else {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                backgroundColor: e.target.value,
                              },
                            });
                          }
                        }}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 m-0 border-0 cursor-pointer"
                      />
                    </div>
                    <input
                      type="text"
                      value={
                        selectedObject.type === "text"
                          ? selectedObject.style?.textColor || "#ffffff"
                          : ["line", "arrow"].includes(selectedObject.type)
                            ? selectedObject.style?.borderColor || "#a1a1aa"
                            : selectedObject.style?.backgroundColor ||
                              "transparent"
                      }
                      onChange={(e) => {
                        if (selectedObject.type === "text") {
                          onUpdateObject({
                            style: {
                              ...selectedObject.style,
                              textColor: e.target.value,
                            },
                          });
                        } else if (
                          ["line", "arrow"].includes(selectedObject.type)
                        ) {
                          onUpdateObject({
                            style: {
                              ...selectedObject.style,
                              borderColor: e.target.value,
                            },
                          });
                        } else {
                          onUpdateObject({
                            style: {
                              ...selectedObject.style,
                              backgroundColor: e.target.value,
                            },
                          });
                        }
                      }}
                      className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-300 font-mono outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Stroke Color Picker (Secondary) - For shapes only */}
          {["rectangle", "ellipse", "artboard"].includes(
            selectedObject.type,
          ) && (
            <div className="relative">
              <Tooltip content="Border Color" side="top" delay={700}>
                <button
                  onClick={() =>
                    setActiveColorPicker(
                      activeColorPicker === "stroke" ? null : "stroke",
                    )
                  }
                  className={`w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors ${activeColorPicker === "stroke" ? "bg-white/10" : ""}`}
                >
                  <div
                    className="w-4 h-4 rounded-full border-2 shadow-sm bg-transparent"
                    style={{
                      borderColor:
                        selectedObject.style?.borderColor || "#52525b",
                    }}
                  />
                </button>
              </Tooltip>

              {activeColorPicker === "stroke" && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setActiveColorPicker(null)}
                  />
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 bg-zinc-900 border border-white/10 rounded-xl shadow-xl z-50 min-w-50 flex flex-col gap-3">
                    {/* Preset Grid */}
                    <div className="grid grid-cols-6 gap-1.5">
                      {COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                borderColor: color,
                              },
                            });
                            setActiveColorPicker(null);
                          }}
                          className="w-6 h-6 rounded-full border border-transparent hover:border-white shadow-sm hover:scale-110 transition-all"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>

                    <div className="h-px bg-white/10 w-full" />

                    {/* Custom Color Input */}
                    <div className="flex items-center gap-2">
                      <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/20 shrink-0">
                        <input
                          type="color"
                          value={selectedObject.style?.borderColor || "#52525b"}
                          onChange={(e) => {
                            onUpdateObject({
                              style: {
                                ...selectedObject.style,
                                borderColor: e.target.value,
                              },
                            });
                          }}
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 m-0 border-0 cursor-pointer"
                        />
                      </div>
                      <input
                        type="text"
                        value={selectedObject.style?.borderColor || "#52525b"}
                        onChange={(e) => {
                          onUpdateObject({
                            style: {
                              ...selectedObject.style,
                              borderColor: e.target.value,
                            },
                          });
                        }}
                        className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-300 font-mono outline-none focus:border-emerald-500/50"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="w-px h-4 bg-white/10 mx-1" />
        </>
      )}

      <Tooltip content="Export" side="top" delay={700}>
        <button
          onClick={onExport}
          className="h-8 px-3 flex items-center gap-2 rounded-full text-zinc-300 hover:text-white hover:bg-white/5 transition-all text-xs font-medium"
        >
          <Icon icon="lucide:download" width="14" height="14" />
          Export
        </button>
      </Tooltip>
    </div>
  );
}
