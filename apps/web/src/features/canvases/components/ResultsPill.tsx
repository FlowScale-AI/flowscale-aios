"use client";
import { Icon } from "@iconify/react";
import { useState, useEffect } from "react";

// Load model-viewer web component from CDN (shared across components)
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

interface ResultItem {
  content_type: string;
  data: string;
  filename: string;
  label: string;
  size?: number;
  download_url?: string;
  run_id?: string | null;
}

interface ResultsPillProps {
  results: Record<string, ResultItem>;
  onDragStart: (filename: string, result: ResultItem) => void;
  onRemoveResult?: (filename: string) => void;
  onClearAll?: () => void;
}

export default function ResultsPill({
  results,
  onDragStart,
  onRemoveResult,
  onClearAll,
}: ResultsPillProps) {
  const resultEntries = Object.entries(results);

  if (resultEntries.length === 0) return null;

  const getResultIcon = (contentType: string) => {
    if (contentType.startsWith("image/")) return "solar:gallery-bold";
    if (contentType.startsWith("video/")) return "solar:video-library-bold";
    if (contentType.startsWith("audio/")) return "solar:music-library-2-bold";
    if (contentType.startsWith("text/")) return "solar:document-text-bold";
    if (contentType.startsWith("model/")) return "solar:box-minimalistic-bold";
    return "solar:file-bold";
  };

  const getResultPreview = (result: ResultItem) => {
    if (result.content_type.startsWith("image/")) {
      return (
        <img
          src={result.data || result.download_url}
          alt={result.label}
          className="w-full h-full object-cover"
        />
      );
    }
    if (result.content_type.startsWith("video/")) {
      return (
        <video
          src={result.data || result.download_url}
          className="w-full h-full object-cover"
          muted
        />
      );
    }
    if (result.content_type.startsWith("audio/")) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 gap-1.5">
          <Icon
            icon="solar:music-library-2-bold"
            width="20"
            className="text-emerald-500"
          />
          <span className="text-[8px] text-zinc-400 px-1 truncate max-w-full">
            {result.label || "Audio"}
          </span>
        </div>
      );
    }
    if (
      result.content_type.startsWith("model/") ||
      /\.(glb|gltf|obj|fbx|stl)$/i.test(result.filename || "")
    ) {
      const modelUrl = result.download_url || result.data;
      const isViewable = /\.(glb|gltf)([?&#]|$)/i.test(result.filename || modelUrl || "");
      if (isViewable && modelUrl) {
        return <Model3dResultPreview src={modelUrl} label={result.label} />;
      }
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 gap-1.5">
          <Icon
            icon="solar:box-minimalistic-bold"
            width="20"
            className="text-violet-500"
          />
          <span className="text-[8px] text-zinc-400 px-1 truncate max-w-full">
            {result.label || "3D Model"}
          </span>
        </div>
      );
    }
    if (result.content_type === "text/plain") {
      return (
        <div className="w-full h-full flex items-center justify-center bg-zinc-800 p-1.5">
          <p className="text-[8px] text-zinc-300 text-center leading-tight line-clamp-5 break-words">
            {result.data}
          </p>
        </div>
      );
    }
    // For other types, show icon
    return (
      <div className="w-full h-full flex items-center justify-center bg-zinc-800">
        <Icon
          icon={getResultIcon(result.content_type)}
          width="24"
          className="text-zinc-500"
        />
      </div>
    );
  };

  return (
    <div className="flex items-center gap-2 bg-[#111] border border-white/10 rounded-full p-2 shadow-2xl backdrop-blur-sm max-w-4xl">
      <div className="flex items-center gap-2 px-2">
        <Icon
          icon="solar:check-circle-bold"
          width="16"
          className="text-emerald-500"
        />
        <span className="text-xs text-zinc-400">Results:</span>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto max-w-3xl custom-scrollbar">
        {resultEntries.map(([filename, result]) => (
          <div
            key={filename}
            draggable
            onDragStart={(e) => {
              onDragStart(filename, result);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="shrink-0 group cursor-grab active:cursor-grabbing"
          >
            <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-white/10 bg-zinc-900 hover:border-emerald-500/50 transition-all hover:scale-105">
              {getResultPreview(result)}

              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                <Icon
                  icon="solar:move-linear"
                  width="16"
                  className="text-white"
                />
                <span className="text-[10px] text-white font-medium">Drag</span>
              </div>

              {/* Badge for type */}
              <div className="absolute top-1 right-1 bg-black/80 rounded px-1.5 py-0.5">
                <Icon
                  icon={getResultIcon(result.content_type)}
                  width="10"
                  className="text-emerald-400"
                />
              </div>

              {/* Delete button */}
              {onRemoveResult && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onRemoveResult(filename);
                  }}
                  className="absolute top-1 left-1 bg-black/80 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/80"
                >
                  <Icon
                    icon="solar:x-bold"
                    width="12"
                    className="text-zinc-400 hover:text-white"
                  />
                </button>
              )}
            </div>

            {/* Filename
            <div className="mt-1 text-[10px] text-zinc-500 text-center truncate max-w-20">
              {result.label}
            </div> */}
          </div>
        ))}
      </div>

      <div className="w-px h-8 bg-white/10 mx-1"></div>

      {/* <button
        className="p-2 hover:bg-white/5 rounded-full transition-colors group"
        title="Download all"
      >
        <Icon
          icon="solar:download-minimalistic-linear"
          width="16"
          className="text-zinc-500 group-hover:text-emerald-500"
        />
      </button> */}

      {onClearAll && (
        <button
          onClick={onClearAll}
          className="p-2 hover:bg-white/5 rounded-full transition-colors group"
          title="Clear all results"
        >
          <Icon
            icon="solar:trash-bin-trash-linear"
            width="16"
            className="text-zinc-500 group-hover:text-red-500"
          />
        </button>
      )}
    </div>
  );
}

function Model3dResultPreview({ src, label }: { src: string; label?: string }) {
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    loadModelViewer().then(() => {
      if (typeof window !== "undefined" && customElements.get("model-viewer")) {
        setViewerReady(true);
      }
    });
  }, []);

  if (!viewerReady) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 gap-1.5">
        <Icon icon="solar:box-minimalistic-bold" width="20" className="text-violet-500" />
        <span className="text-[8px] text-zinc-400 px-1 truncate max-w-full">{label || "3D Model"}</span>
      </div>
    );
  }

  return (
    // @ts-ignore model-viewer is a web component
    <model-viewer
      src={src}
      alt={label || "3D Model"}
      auto-rotate
      style={{ width: "100%", height: "100%", background: "#27272a" }}
    />
  );
}
