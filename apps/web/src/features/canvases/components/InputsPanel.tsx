"use client";
import { useCanvasTools } from "@/features/canvases/api/getCanvasTools";
import type { ToolConfig } from "@/features/canvases/types";
import type { ToolInputConfig, ToolOutputConfig } from "@/features/canvases/types";
import { Icon } from "@iconify/react";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";

// Load model-viewer web component from CDN (shared with DraggableObject)
let modelViewerLoaded = false;
let modelViewerLoading = false;
const loadModelViewer = (): Promise<void> => {
  return new Promise((resolve) => {
    if (modelViewerLoaded) { resolve(); return; }
    if (typeof window !== "undefined" && customElements.get("model-viewer")) {
      modelViewerLoaded = true; resolve(); return;
    }
    if (modelViewerLoading) {
      const check = setInterval(() => { if (modelViewerLoaded) { clearInterval(check); resolve(); } }, 100);
      return;
    }
    modelViewerLoading = true;
    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js";
    script.onload = () => { modelViewerLoaded = true; modelViewerLoading = false; resolve(); };
    script.onerror = () => { modelViewerLoading = false; resolve(); };
    document.head.appendChild(script);
  });
};

const TYPE_OPTIONS = [
  "text",
  "textarea",
  "number",
  "image",
  "video",
  "audio",
  "3d",
  "combo",
  "boolean",
] as const;

const OUTPUT_TYPE_OPTIONS = ["image", "video", "audio", "3d", "text"] as const;

/** Infer a better input type from the name, label, and node class when demo_type is generic. */
function inferInputType(parameterName: string, label: string, category: string, demoType: string): string {
  // If the tool mapper already set a specific file type, keep it
  if (["image", "video", "audio", "3d"].includes(demoType)) return demoType;

  const haystack = `${parameterName} ${label} ${category}`.toLowerCase();

  if (/\bimage\b|\.png|\.jpg|\.jpeg|\.webp|\bimg\b|\bphoto\b|\bpicture\b/.test(haystack)) return "image";
  if (/\bvideo\b|\.mp4|\.mov|\.webm|\bclip\b|\banimation\b/.test(haystack)) return "video";
  if (/\baudio\b|\.wav|\.mp3|\.flac|\bsound\b|\bmusic\b/.test(haystack)) return "audio";
  if (/\b3d\b|\bmesh\b|\.glb|\.gltf|\.obj|\.fbx|\bmodel_?file\b/.test(haystack)) return "3d";
  if (/\bprompt\b|\bdescription\b/.test(haystack) && demoType === "string") return "textarea";

  return demoType;
}

interface InputsPanelProps {
  activeToolId?: string;
  onInputsChange?: (inputs: Record<string, any>) => void;
  externalInputs?: Record<string, any>;
}

export default function InputsPanel({
  activeToolId,
  onInputsChange,
  externalInputs,
}: InputsPanelProps) {
  const { data: toolsData } = useCanvasTools();
  const [inputValues, setInputValues] = useState<Record<string, any>>({});
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});

  // Config mode state
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [savedConfig, setSavedConfig] = useState<Record<string, ToolInputConfig> | null>(null);
  const [draftConfig, setDraftConfig] = useState<Record<string, ToolInputConfig>>({});
  const [savedOutputConfig, setSavedOutputConfig] = useState<Record<string, ToolOutputConfig> | null>(null);
  const [draftOutputConfig, setDraftOutputConfig] = useState<Record<string, ToolOutputConfig>>({});

  // Find active tool from API data
  const activeTool = useMemo(() => {
    if (!activeToolId || !toolsData?.tools) return undefined;
    return toolsData.tools.find((t) => t.workflow_id === activeToolId);
  }, [toolsData, activeToolId]);

  // Load config from IndexedDB when tool changes
  useEffect(() => {
    if (!activeToolId) {
      setSavedConfig(null);
      setSavedOutputConfig(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/tool-configs/${encodeURIComponent(activeToolId)}`)
      .then((r) => (r.status === 204 ? null : r.json()))
      .then((config: ToolConfig | null) => {
        if (cancelled) return;
        setSavedConfig(config?.inputs ?? null);
        setSavedOutputConfig(config?.outputs ?? null);
      })
      .catch(() => { /* no config yet */ });
    return () => { cancelled = true; };
  }, [activeToolId]);

  // Filter inputs based on saved config.
  // When no canvas-specific config has been saved yet, show all inputs —
  // the schema is already the user's selected subset from the build step.
  const visibleInputs = useMemo(() => {
    if (!activeTool) return [];
    if (!savedConfig) return activeTool.inputs;
    return activeTool.inputs.filter(
      (input) => savedConfig[input.parameter_name]?.visible,
    );
  }, [activeTool, savedConfig]);

  // Get the effective type for an input (config override or original)
  const getEffectiveType = useCallback(
    (parameterName: string, originalType: string) => {
      if (savedConfig?.[parameterName]?.type) {
        return savedConfig[parameterName].type;
      }
      return originalType;
    },
    [savedConfig],
  );

  // Stable ref for onInputsChange so the reset effect doesn't re-fire on callback identity changes
  const onInputsChangeRef = useRef(onInputsChange);
  onInputsChangeRef.current = onInputsChange;

  // Reset inputs only when the actual tool ID changes (not on data refetch)
  useEffect(() => {
    if (activeTool) {
      const initialValues: Record<string, any> = {};
      activeTool.inputs.forEach((input) => {
        if (input.demo_type === "number") {
          initialValues[input.parameter_name] = input.default ?? 0;
        } else if (input.demo_type === "combo") {
          initialValues[input.parameter_name] = input.default ?? (input.options?.[0] || "");
        } else if (input.demo_type === "boolean") {
          initialValues[input.parameter_name] = input.default ?? false;
        } else {
          initialValues[input.parameter_name] = input.default ?? "";
        }
      });
      setInputValues(initialValues);
      setFilePreviews({});
      setIsConfiguring(false);
      onInputsChangeRef.current?.(initialValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToolId]);

  const handleInputChange = (parameterName: string, value: any) => {
    const newInputs = { ...inputValues, [parameterName]: value };
    setInputValues(newInputs);
    onInputsChange?.(newInputs);
  };

  const handleFileChange = async (parameterName: string, file: File) => {
    handleInputChange(parameterName, file);
    const fileType = file.type.split("/")[0];
    if (fileType === "image" || fileType === "video") {
      const previewUrl = URL.createObjectURL(file);
      setFilePreviews((prev) => ({ ...prev, [parameterName]: previewUrl }));
    }
  };

  // Sync externally-set File values (e.g. from "Send To" context menu)
  useEffect(() => {
    if (!externalInputs) return;
    for (const [key, value] of Object.entries(externalInputs)) {
      if (value instanceof File && value !== inputValues[key]) {
        setInputValues((prev) => ({ ...prev, [key]: value }));
        const fileType = value.type.split("/")[0];
        if (fileType === "image" || fileType === "video") {
          const previewUrl = URL.createObjectURL(value);
          setFilePreviews((prev) => {
            // Revoke old preview if it exists
            if (prev[key]) URL.revokeObjectURL(prev[key]);
            return { ...prev, [key]: previewUrl };
          });
        }
      }
    }
  }, [externalInputs]);

  // Cleanup preview URLs when component unmounts or tool changes
  useEffect(() => {
    return () => {
      Object.values(filePreviews).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [activeTool]);

  // Enter config mode
  const handleStartConfig = () => {
    if (!activeTool) return;
    // Initialize draft from saved config, or default all to unchecked with original types
    const draft: Record<string, ToolInputConfig> = {};
    activeTool.inputs.forEach((input) => {
      if (savedConfig?.[input.parameter_name]) {
        draft[input.parameter_name] = { ...savedConfig[input.parameter_name] };
      } else {
        draft[input.parameter_name] = {
          visible: false,
          type: inferInputType(input.parameter_name, input.label, input.category, input.demo_type),
          label: input.label,
        };
      }
    });
    setDraftConfig(draft);

    // Initialize output draft config
    const outputDraft: Record<string, ToolOutputConfig> = {};
    activeTool.outputs.forEach((output) => {
      const key = output.parameter_name || output.label;
      if (savedOutputConfig?.[key]) {
        outputDraft[key] = { ...savedOutputConfig[key] };
      } else {
        outputDraft[key] = {
          visible: true,
          type: output.demo_type,
          label: output.label,
        };
      }
    });
    setDraftOutputConfig(outputDraft);
    setIsConfiguring(true);
  };

  const handleSaveConfig = async () => {
    if (!activeToolId) return;
    try {
      await fetch(`/api/tool-configs/${encodeURIComponent(activeToolId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: activeToolId,
          inputs: draftConfig,
          outputs: draftOutputConfig,
        }),
      });
    } catch (err) {
      console.error("Failed to save tool config:", err);
    }
    setSavedConfig({ ...draftConfig });
    setSavedOutputConfig({ ...draftOutputConfig });
    setIsConfiguring(false);
  };

  const handleCancelConfig = () => {
    setIsConfiguring(false);
  };

  const handleToggleVisibility = (parameterName: string) => {
    setDraftConfig((prev) => ({
      ...prev,
      [parameterName]: {
        ...prev[parameterName],
        visible: !prev[parameterName].visible,
      },
    }));
  };

  const handleTypeChange = (parameterName: string, type: string) => {
    setDraftConfig((prev) => ({
      ...prev,
      [parameterName]: {
        ...prev[parameterName],
        type,
      },
    }));
  };

  const handleOutputToggleVisibility = (key: string) => {
    setDraftOutputConfig((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        visible: !prev[key].visible,
      },
    }));
  };

  const handleOutputTypeChange = (key: string, type: string) => {
    setDraftOutputConfig((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        type,
      },
    }));
  };

  if (!activeTool) {
    return (
      <div className="w-80 bg-background-panel border-l border-white/5 flex flex-col items-center justify-center p-8 text-center h-full">
        <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4 text-zinc-600">
          <Icon icon="solar:settings-minimalistic-linear" width="24" />
        </div>
        <p className="text-zinc-500 text-sm">
          Select a tool to configure inputs.
        </p>
      </div>
    );
  }

  // ── Config Mode ──────────────────────────────────────────────────────────
  if (isConfiguring) {
    return (
      <div className="w-80 bg-background-panel border-l border-white/5 flex flex-col h-full shrink-0">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5">
          <div className="flex items-center justify-between">
            <h2 className="text-base text-white font-medium font-tech">
              Configure I/O
            </h2>
            <button
              onClick={handleCancelConfig}
              className="p-1.5 text-zinc-500 hover:text-white transition-colors"
              title="Cancel"
            >
              <Icon icon="lucide:x" width="16" />
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Choose which inputs and outputs to expose.
          </p>
        </div>

        {/* Config List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
          {/* ── Inputs Section ── */}
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1">
            Inputs
          </div>
          {activeTool.inputs.map((input) => {
            const cfg = draftConfig[input.parameter_name];
            if (!cfg) return null;

            // Format default value for display
            const rawDefault = (input as any).default;
            let valueDisplay: string;
            if (rawDefault === undefined || rawDefault === null) {
              valueDisplay = "(no default)";
            } else if (typeof rawDefault === "boolean") {
              valueDisplay = String(rawDefault);
            } else if (typeof rawDefault === "number") {
              valueDisplay = String(rawDefault);
            } else if (typeof rawDefault === "string") {
              const truncated = rawDefault.length > 40 ? rawDefault.slice(0, 40) + "..." : rawDefault;
              valueDisplay = `"${truncated}"`;
            } else {
              valueDisplay = String(rawDefault);
            }

            return (
              <div
                key={input.parameter_name}
                className={`rounded-lg border p-3 transition-colors ${
                  cfg.visible
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-white/5 bg-white/2"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleVisibility(input.parameter_name)}
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      cfg.visible
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-white/20 text-transparent hover:border-white/40"
                    }`}
                  >
                    <Icon icon="lucide:check" width="12" />
                  </button>

                  {/* Label */}
                  <span className="text-sm text-zinc-300 flex-1 truncate">
                    {input.label}
                  </span>
                </div>

                {/* Type dropdown - only show when visible */}
                {cfg.visible && (
                  <div className="mt-2 ml-8">
                    <select
                      value={cfg.type}
                      onChange={(e) =>
                        handleTypeChange(input.parameter_name, e.target.value)
                      }
                      className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                    >
                      {TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Parameter name hint */}
                <div className="mt-1 ml-8 text-[10px] text-zinc-600 font-mono truncate">
                  {input.parameter_name}
                </div>

                {/* Default value display */}
                <div className="mt-0.5 ml-8 text-[10px] text-zinc-500 truncate">
                  Value: {valueDisplay}
                </div>
              </div>
            );
          })}

          {/* ── Outputs Section ── */}
          {activeTool.outputs.length > 0 && (
            <>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mt-6 mb-1">
                Outputs
              </div>
              {activeTool.outputs.map((output) => {
                const key = output.parameter_name || output.label;
                const cfg = draftOutputConfig[key];
                if (!cfg) return null;
                return (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 transition-colors ${
                      cfg.visible
                        ? "border-blue-500/30 bg-blue-500/5"
                        : "border-white/5 bg-white/2"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Toggle */}
                      <button
                        onClick={() => handleOutputToggleVisibility(key)}
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          cfg.visible
                            ? "bg-blue-500 border-blue-500 text-white"
                            : "border-white/20 text-transparent hover:border-white/40"
                        }`}
                      >
                        <Icon icon="lucide:check" width="12" />
                      </button>

                      {/* Label */}
                      <span className="text-sm text-zinc-300 flex-1 truncate">
                        {cfg.label || output.label}
                      </span>
                    </div>

                    {/* Type dropdown - only show when visible */}
                    {cfg.visible && (
                      <div className="mt-2 ml-8">
                        <select
                          value={cfg.type}
                          onChange={(e) =>
                            handleOutputTypeChange(key, e.target.value)
                          }
                          className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                        >
                          {OUTPUT_TYPE_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Parameter name hint */}
                    <div className="mt-1 ml-8 text-[10px] text-zinc-600 font-mono truncate">
                      {key}
                    </div>

                    {/* Current type display */}
                    <div className="mt-0.5 ml-8 text-[10px] text-zinc-500">
                      Type: {output.demo_type}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Save / Cancel Buttons */}
        <div className="px-5 py-4 border-t border-white/5 flex gap-3">
          <button
            onClick={handleCancelConfig}
            className="flex-1 px-4 py-2 text-sm text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveConfig}
            className="flex-1 px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  // ── Normal Mode ──────────────────────────────────────────────────────────
  return (
    <div className="w-80 bg-background-panel border-l border-white/5 flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <h2 className="text-base text-white font-medium font-tech">
            {activeTool.name}
          </h2>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          {(() => {
            if (!savedConfig) return activeTool.description || "No description available";
            const visibleOutCount = savedOutputConfig
              ? Object.values(savedOutputConfig).filter((o) => o.visible).length
              : activeTool.outputs.length;
            return `ComfyUI workflow – ${visibleInputs.length} inputs, ${visibleOutCount} outputs`;
          })()}
        </p>
      </div>

      {/* Inputs Scroll Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
        {/* Dynamic Inputs — only visible ones */}
        {visibleInputs.map((input, index) => {
          const effectiveType = getEffectiveType(input.parameter_name, input.demo_type);

          return (
            <div key={input.parameter_name} className="space-y-3">
              <label className="text-xs text-zinc-400 font-medium uppercase tracking-wider block">
                {input.label}
              </label>

              {effectiveType === "number" ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={inputValues[input.parameter_name] ?? 0}
                      min={(input as any).min}
                      max={(input as any).max}
                      step={(input as any).step || (input.value_type === "int" ? 1 : 0.01)}
                      onChange={(e) =>
                        handleInputChange(
                          input.parameter_name,
                          input.value_type === "int"
                            ? parseInt(e.target.value) || 0
                            : parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                      placeholder={`Enter ${input.label.toLowerCase()}...`}
                    />
                    {input.randomize && (
                      <button
                        onClick={() =>
                          handleInputChange(
                            input.parameter_name,
                            Math.floor(Math.random() * 2147483647),
                          )
                        }
                        className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors shrink-0"
                        title="Randomize"
                      >
                        <Icon icon="lucide:dice-5" width="16" />
                      </button>
                    )}
                  </div>
                  {(input as any).min !== undefined && (input as any).max !== undefined && (
                    <input
                      type="range"
                      min={(input as any).min}
                      max={(input as any).max}
                      step={(input as any).step || (input.value_type === "int" ? 1 : 0.01)}
                      value={inputValues[input.parameter_name] ?? 0}
                      onChange={(e) =>
                        handleInputChange(
                          input.parameter_name,
                          input.value_type === "int"
                            ? parseInt(e.target.value)
                            : parseFloat(e.target.value),
                        )
                      }
                      className="w-full accent-emerald-500"
                    />
                  )}
                </div>
              ) : effectiveType === "combo" ? (
                <select
                  value={inputValues[input.parameter_name] ?? ""}
                  onChange={(e) =>
                    handleInputChange(input.parameter_name, e.target.value)
                  }
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                >
                  {((input as any).options || []).map((opt: string) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : effectiveType === "boolean" ? (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!inputValues[input.parameter_name]}
                    onChange={(e) =>
                      handleInputChange(input.parameter_name, e.target.checked)
                    }
                    className="w-4 h-4 accent-emerald-500 rounded"
                  />
                  <span className="text-sm text-zinc-300">
                    {inputValues[input.parameter_name] ? "Enabled" : "Disabled"}
                  </span>
                </label>
              ) : effectiveType === "textarea" ? (
                <textarea
                  value={inputValues[input.parameter_name] || ""}
                  onChange={(e) =>
                    handleInputChange(input.parameter_name, e.target.value)
                  }
                  rows={4}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50 resize-y"
                  placeholder={`Enter ${input.label.toLowerCase()}...`}
                />
              ) : effectiveType === "image" ||
                effectiveType === "video" ||
                effectiveType === "audio" ||
                effectiveType === "3d" ? (
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="file"
                      accept={
                        effectiveType === "image"
                          ? "image/*"
                          : effectiveType === "video"
                            ? "video/*"
                            : effectiveType === "audio"
                              ? "audio/*"
                              : ".gltf,.glb,.obj,.fbx,.stl"
                      }
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileChange(input.parameter_name, file);
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="h-32 border border-dashed border-white/10 rounded-lg flex flex-col items-center justify-center text-zinc-600 gap-2 bg-white/1 hover:bg-white/3 transition-colors cursor-pointer group">
                      <Icon
                        icon={
                          effectiveType === "image"
                            ? "solar:gallery-add-linear"
                            : effectiveType === "video"
                              ? "solar:videocamera-add-linear"
                              : effectiveType === "audio"
                                ? "solar:music-library-linear"
                                : "solar:cube-linear"
                        }
                        width="24"
                        className="group-hover:text-emerald-500 transition-colors"
                      />
                      <span className="text-xs">
                        {inputValues[input.parameter_name]
                          ? `Change ${effectiveType}`
                          : `Upload ${effectiveType}`}
                      </span>
                    </div>
                  </div>

                  {/* File Preview */}
                  {inputValues[input.parameter_name] && (
                    <div className="rounded-lg border border-white/10 overflow-hidden bg-zinc-900">
                      {effectiveType === "image" &&
                        filePreviews[input.parameter_name] && (
                          <img
                            src={filePreviews[input.parameter_name]}
                            alt="Preview"
                            className="w-full h-48 object-cover"
                          />
                        )}
                      {effectiveType === "video" &&
                        filePreviews[input.parameter_name] && (
                          <video
                            src={filePreviews[input.parameter_name]}
                            controls
                            className="w-full h-48"
                          />
                        )}
                      {effectiveType === "audio" && (
                        <div className="p-4">
                          <audio
                            src={
                              filePreviews[input.parameter_name] ||
                              URL.createObjectURL(
                                inputValues[input.parameter_name],
                              )
                            }
                            controls
                            className="w-full"
                          />
                        </div>
                      )}
                      {effectiveType === "3d" && (
                        <Model3dPreview file={inputValues[input.parameter_name]} />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={inputValues[input.parameter_name] || ""}
                  onChange={(e) =>
                    handleInputChange(input.parameter_name, e.target.value)
                  }
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                  placeholder={`Enter ${input.label.toLowerCase()}...`}
                />
              )}
              {input.path && (
                <div className="text-[10px] text-zinc-600 font-mono truncate">
                  Param: {input.parameter_name}
                </div>
              )}
            </div>
          );
        })}

        {visibleInputs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center mb-3 text-zinc-600">
              <Icon icon="solar:settings-minimalistic-linear" width="20" />
            </div>
            <p className="text-zinc-500 text-xs text-balance">
              No inputs configured yet.
            </p>
            <button
              onClick={handleStartConfig}
              className="mt-3 px-4 py-1.5 text-xs text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-colors"
            >
              Configure Inputs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline 3D model preview using model-viewer web component */
function Model3dPreview({ file }: { file: File | null | undefined }) {
  const [viewerReady, setViewerReady] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    loadModelViewer().then(() => {
      if (typeof window !== "undefined" && customElements.get("model-viewer")) {
        setViewerReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!file || !(file instanceof File)) { setObjectUrl(null); return; }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isGlb = file instanceof File && /\.(glb|gltf)$/i.test(file.name);
  const sizeKB = file instanceof File ? (file.size / 1024).toFixed(1) : null;

  return (
    <div>
      {viewerReady && isGlb && objectUrl ? (
        <div className="w-full h-40 bg-zinc-900 rounded-t-lg overflow-hidden">
          {/* @ts-ignore model-viewer is a web component */}
          <model-viewer
            src={objectUrl}
            alt={file?.name || "3D Model"}
            auto-rotate
            camera-controls
            style={{ width: "100%", height: "100%", background: "transparent" }}
          />
        </div>
      ) : (
        <div className="w-full h-24 bg-zinc-900 rounded-t-lg flex items-center justify-center">
          <Icon icon="solar:cube-bold" width="32" className="text-violet-500" />
        </div>
      )}
      {file instanceof File && (
        <div className="p-3 flex items-center gap-3">
          <Icon icon="solar:cube-bold" width="20" className="text-violet-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-300 truncate">{file.name}</p>
            {sizeKB && <p className="text-[10px] text-zinc-500">{sizeKB} KB</p>}
          </div>
        </div>
      )}
    </div>
  );
}
