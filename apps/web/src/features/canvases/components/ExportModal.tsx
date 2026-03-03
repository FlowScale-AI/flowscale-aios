"use client";

import { useState, useMemo } from "react";
import { Icon } from "@iconify/react";
import { Modal } from "@flowscale/ui";

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
    | "model3d";
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  scaleX?: number;
  scaleY?: number;
  style?: {
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    textColor?: string;
    fontSize?: number;
    fontFamily?: string;
  };
  rotation?: number;
  label?: string;
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

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
  objects: CanvasObject[];
  selectedObjectIds: Set<string>;
}

type ExportFormat = "png" | "jpg" | "pdf";

// Helper to check if a URL is a downloadable media URL
const isDownloadableUrl = (url: string): boolean => {
  if (!url) return false;
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:")
  );
};

// Helper to check if content appears to be a video
const isVideoContent = (content: string): boolean => {
  if (!content) return false;
  const videoExtensions = [
    ".mp4",
    ".webm",
    ".mov",
    ".avi",
    ".mkv",
    ".m4v",
    ".flv",
    ".wmv",
    ".mpg",
    ".mpeg",
    ".3gp",
    ".ogv",
  ];
  const lowerContent = content.toLowerCase();
  return videoExtensions.some((ext) => lowerContent.includes(ext));
};

// Helper to check if content appears to be audio
const isAudioContent = (content: string): boolean => {
  if (!content) return false;
  const audioExtensions = [
    ".mp3",
    ".wav",
    ".ogg",
    ".flac",
    ".aac",
    ".m4a",
    ".wma",
    ".aiff",
    ".opus",
  ];
  const lowerContent = content.toLowerCase();
  return audioExtensions.some((ext) => lowerContent.includes(ext));
};

// Helper to check if content appears to be a 3D model
const isModel3dContent = (content: string): boolean => {
  if (!content) return false;
  const model3dExtensions = [
    ".glb",
    ".gltf",
    ".obj",
    ".fbx",
    ".stl",
    ".3ds",
    ".dae",
    ".ply",
    ".usdz",
  ];
  const lowerContent = content.toLowerCase();
  return model3dExtensions.some((ext) => lowerContent.includes(ext));
};

// Helper to get file extension from URL
const getExtensionFromUrl = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    return ext || "file";
  } catch {
    return "file";
  }
};

// Helper to get appropriate file extension based on content type
const getExtensionFromMimeType = (mimeType: string): string => {
  const mimeMap: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/x-matroska": "mkv",
    "video/x-m4v": "m4v",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/opus": "opus",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "model/obj": "obj",
    "model/stl": "stl",
  };
  return mimeMap[mimeType] || "file";
};

export default function ExportModal({
  isOpen,
  onClose,
  canvasId,
  canvasName,
  objects,
  selectedObjectIds,
}: ExportModalProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("png");
  const [isExporting, setIsExporting] = useState(false);

  // Determine if all selected objects are downloadable media (images/videos with URLs)
  const selectedObjects = useMemo(() => {
    return objects.filter((obj) => selectedObjectIds.has(obj.id));
  }, [objects, selectedObjectIds]);

  const downloadableMedia = useMemo(() => {
    if (selectedObjects.length === 0) return [];
    return selectedObjects.filter((obj) => {
      // Include images, videos, audio, and 3D models that have downloadable URLs
      const isImageOrVideo =
        obj.type === "image" ||
        obj.source?.kind === "image" ||
        obj.source?.kind === "video";
      const isAudio = obj.type === "audio" || obj.source?.kind === "audio";
      const isModel3d =
        obj.type === "model3d" || obj.source?.kind === "model3d";
      return (
        (isImageOrVideo || isAudio || isModel3d) &&
        isDownloadableUrl(obj.content)
      );
    });
  }, [selectedObjects]);

  // Check if all selected items are downloadable media
  const isAllDownloadableMedia = useMemo(() => {
    return (
      selectedObjects.length > 0 &&
      downloadableMedia.length === selectedObjects.length
    );
  }, [selectedObjects, downloadableMedia]);

  const exportFormats: {
    value: ExportFormat;
    label: string;
    icon: string;
    description: string;
  }[] = [
    {
      value: "png",
      label: "PNG",
      icon: "lucide:image",
      description: "Best for web and digital use",
    },
    {
      value: "jpg",
      label: "JPG",
      icon: "lucide:image",
      description: "Smaller file size, lossy compression",
    },
    {
      value: "pdf",
      label: "PDF",
      icon: "lucide:file-text",
      description: "Best for printing and sharing",
    },
  ];

  // Handle direct download for media with URLs
  const handleDirectDownload = async () => {
    setIsExporting(true);

    try {
      for (const obj of downloadableMedia) {
        const url = obj.content;
        const isVideo = obj.source?.kind === "video" || isVideoContent(url);
        const ext = getExtensionFromUrl(url);
        const filename =
          obj.label ||
          obj.source?.output_selector?.filename ||
          `${canvasName || "download"}.${ext}`;

        // Fetch the file and create a blob for download
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Failed to fetch file");

          const blob = await response.blob();
          const contentType = response.headers.get("content-type");

          // Determine the best extension to use
          let finalExtension = ext;
          if (contentType && !filename.includes(".")) {
            // Try to get extension from MIME type if filename doesn't have one
            const mimeExt = getExtensionFromMimeType(contentType);
            if (mimeExt !== "file") {
              finalExtension = mimeExt;
            }
          }

          // Create blob with proper MIME type for videos
          const downloadBlob =
            contentType && isVideo
              ? new Blob([blob], { type: contentType })
              : blob;
          const blobUrl = URL.createObjectURL(downloadBlob);

          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = filename.includes(".")
            ? filename
            : `${filename}.${finalExtension}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Clean up blob URL after a short delay to ensure download starts
          setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

          // Small delay between downloads if multiple files
          if (downloadableMedia.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        } catch (fetchError) {
          // Fallback: try opening in new tab if fetch fails (e.g., CORS)
          console.warn(
            "Direct download failed, opening in new tab:",
            fetchError,
          );
          window.open(url, "_blank");
        }
      }

      setTimeout(() => {
        onClose();
        setIsExporting(false);
      }, 500);
    } catch (error) {
      console.error("Download failed:", error);
      alert(
        `Download failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      if (selectedObjectIds.size === 0) {
        throw new Error("No items selected to export");
      }

      // Get objects to export
      let objectsToExport = objects.filter((obj) =>
        selectedObjectIds.has(obj.id),
      );

      // If any artboard is selected, include all objects within the artboard bounds
      const selectedArtboards = objectsToExport.filter(
        (obj) => obj.type === "artboard",
      );

      if (selectedArtboards.length > 0) {
        const artboardIds = new Set(selectedArtboards.map((a) => a.id));
        const childObjects = objects.filter((obj) => {
          if (artboardIds.has(obj.id)) return false; // Skip artboard itself
          // Check if object is within any selected artboard
          return selectedArtboards.some((artboard) => {
            const objCenterX = obj.x + obj.w / 2;
            const objCenterY = obj.y + obj.h / 2;
            return (
              objCenterX >= artboard.x &&
              objCenterX <= artboard.x + artboard.w &&
              objCenterY >= artboard.y &&
              objCenterY <= artboard.y + artboard.h
            );
          });
        });

        objectsToExport = [...objectsToExport, ...childObjects];
      }

      if (objectsToExport.length === 0) {
        throw new Error("No objects to export");
      }

      // Calculate bounds of objects to export
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      objectsToExport.forEach((obj) => {
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x + obj.w);
        maxY = Math.max(maxY, obj.y + obj.h);
      });

      // Add padding
      const padding = 40;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;

      const exportWidth = maxX - minX;
      const exportHeight = maxY - minY;

      // Create canvas with 2x scale for better quality
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = exportWidth * scale;
      canvas.height = exportHeight * scale;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Failed to create canvas context");
      }

      // Scale for retina quality
      ctx.scale(scale, scale);

      // Fill background
      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, 0, exportWidth, exportHeight);

      // Sort objects: artboards first (background), then others
      const sortedObjects = [...objectsToExport].sort((a, b) => {
        if (a.type === "artboard" && b.type !== "artboard") return -1;
        if (a.type !== "artboard" && b.type === "artboard") return 1;
        return 0;
      });

      // Helper to load images
      const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      };

      // Draw each object
      for (const obj of sortedObjects) {
        const x = obj.x - minX;
        const y = obj.y - minY;
        const w = obj.w;
        const h = obj.h;
        const rotation = obj.rotation || 0;
        const scaleX = obj.scaleX || 1;
        const scaleY = obj.scaleY || 1;

        ctx.save();

        // Apply transformations (rotate around center)
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.scale(scaleX, scaleY);
        ctx.translate(-w / 2, -h / 2);

        switch (obj.type) {
          case "image":
            try {
              const img = await loadImage(obj.content);
              ctx.drawImage(img, 0, 0, w, h);
            } catch {
              // Draw placeholder if image fails to load
              ctx.fillStyle = "#27272a";
              ctx.fillRect(0, 0, w, h);
              ctx.fillStyle = "#71717a";
              ctx.font = "14px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText("Image", w / 2, h / 2);
            }
            break;

          case "text":
            ctx.fillStyle = obj.style?.textColor || "#d4d4d8";
            ctx.font = `${obj.style?.fontSize || 16}px ${obj.style?.fontFamily || "Inter, sans-serif"}`;
            ctx.textBaseline = "top";

            // Word wrap text
            const text = obj.content || "Double click to edit";
            const words = text.split(" ");
            let line = "";
            let lineY = 8; // padding
            const lineHeight = (obj.style?.fontSize || 16) * 1.4;
            const maxWidth = w - 16; // padding

            for (const word of words) {
              const testLine = line + word + " ";
              const metrics = ctx.measureText(testLine);
              if (metrics.width > maxWidth && line !== "") {
                ctx.fillText(line.trim(), 8, lineY);
                line = word + " ";
                lineY += lineHeight;
              } else {
                line = testLine;
              }
            }
            ctx.fillText(line.trim(), 8, lineY);
            break;

          case "rectangle":
          case "artboard":
            // Fill
            if (obj.style?.backgroundColor) {
              ctx.fillStyle = obj.style.backgroundColor;
              ctx.fillRect(0, 0, w, h);
            } else if (obj.type === "artboard") {
              ctx.fillStyle = "#3f3f46";
              ctx.fillRect(0, 0, w, h);
            }
            // Border
            if (obj.style?.borderWidth) {
              ctx.strokeStyle = obj.style?.borderColor || "#52525b";
              ctx.lineWidth = obj.style.borderWidth;
              ctx.strokeRect(0, 0, w, h);
            }
            break;

          case "ellipse":
            ctx.beginPath();
            ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            if (obj.style?.backgroundColor) {
              ctx.fillStyle = obj.style.backgroundColor;
              ctx.fill();
            }
            if (obj.style?.borderWidth) {
              ctx.strokeStyle = obj.style?.borderColor || "#52525b";
              ctx.lineWidth = obj.style.borderWidth;
              ctx.stroke();
            }
            break;

          case "line":
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(w, h);
            ctx.strokeStyle = obj.style?.borderColor || "#a1a1aa";
            ctx.lineWidth = 2;
            ctx.stroke();
            break;

          case "arrow":
            // Draw line
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(w, h);
            ctx.strokeStyle = obj.style?.borderColor || "#a1a1aa";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw arrowhead
            const angle = Math.atan2(h, w);
            const headLength = 10;
            ctx.beginPath();
            ctx.moveTo(w, h);
            ctx.lineTo(
              w - headLength * Math.cos(angle - Math.PI / 6),
              h - headLength * Math.sin(angle - Math.PI / 6),
            );
            ctx.moveTo(w, h);
            ctx.lineTo(
              w - headLength * Math.cos(angle + Math.PI / 6),
              h - headLength * Math.sin(angle + Math.PI / 6),
            );
            ctx.stroke();
            break;
        }

        ctx.restore();
      }

      // Export based on format
      let dataUrl: string;

      if (selectedFormat === "jpg") {
        dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      } else {
        dataUrl = canvas.toDataURL("image/png");
      }

      if (selectedFormat === "pdf") {
        const { jsPDF } = await import("jspdf");

        const pdf = new jsPDF({
          orientation: canvas.width > canvas.height ? "landscape" : "portrait",
          unit: "px",
          format: [canvas.width, canvas.height],
        });

        pdf.addImage(dataUrl, "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save(`${canvasName || "canvas"}.pdf`);
      } else {
        const link = document.createElement("a");
        link.download = `${canvasName || "canvas"}.${selectedFormat}`;
        link.href = dataUrl;
        link.click();
      }

      // Close modal after successful export
      setTimeout(() => {
        onClose();
        setIsExporting(false);
      }, 500);
    } catch (error) {
      console.error("Export failed:", error);
      alert(
        `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsExporting(false);
    }
  };

  // Render different UI based on whether all selected items are downloadable media
  const renderDownloadableMediaUI = () => {
    const hasVideos = downloadableMedia.some(
      (obj) => obj.source?.kind === "video" || isVideoContent(obj.content),
    );
    const hasImages = downloadableMedia.some(
      (obj) =>
        (obj.source?.kind === "image" || !obj.source?.kind) &&
        !isVideoContent(obj.content) &&
        !isAudioContent(obj.content) &&
        !isModel3dContent(obj.content),
    );
    const hasAudio = downloadableMedia.some(
      (obj) =>
        obj.source?.kind === "audio" ||
        obj.type === "audio" ||
        isAudioContent(obj.content),
    );
    const hasModel3d = downloadableMedia.some(
      (obj) =>
        obj.source?.kind === "model3d" ||
        obj.type === "model3d" ||
        isModel3dContent(obj.content),
    );

    // Determine media type label and icon
    const mediaTypes: string[] = [];
    if (hasImages) mediaTypes.push("image");
    if (hasVideos) mediaTypes.push("video");
    if (hasAudio) mediaTypes.push("audio");
    if (hasModel3d) mediaTypes.push("3D model");

    let mediaType = "file";
    let mediaIcon = "lucide:file";

    if (mediaTypes.length > 1) {
      mediaType = "media";
      mediaIcon = "lucide:files";
    } else if (hasVideos) {
      mediaType = "video";
      mediaIcon = "lucide:video";
    } else if (hasImages) {
      mediaType = "image";
      mediaIcon = "lucide:image";
    } else if (hasAudio) {
      mediaType = "audio";
      mediaIcon = "lucide:music";
    } else if (hasModel3d) {
      mediaType = "3D model";
      mediaIcon = "lucide:box";
    }

    return (
      <div className="w-full max-w-md">
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-white/10 bg-zinc-900/50">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                <Icon icon={mediaIcon} className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <span className="font-medium text-white">
                  Download{" "}
                  {downloadableMedia.length > 1
                    ? `${downloadableMedia.length} ${mediaType}s`
                    : mediaType}
                </span>
                <p className="text-sm text-zinc-400 mt-1">
                  {downloadableMedia.length > 1
                    ? `Download ${downloadableMedia.length} files in their original format`
                    : "Download in original format"}
                </p>
              </div>
            </div>
          </div>

          {/* Show file list if multiple items */}
          {downloadableMedia.length > 1 && (
            <div className="max-h-32 overflow-y-auto space-y-1">
              {downloadableMedia.map((obj) => {
                const isVideo =
                  obj.source?.kind === "video" || isVideoContent(obj.content);
                const isAudio =
                  obj.source?.kind === "audio" ||
                  obj.type === "audio" ||
                  isAudioContent(obj.content);
                const isModel3d =
                  obj.source?.kind === "model3d" ||
                  obj.type === "model3d" ||
                  isModel3dContent(obj.content);
                const filename =
                  obj.label || obj.source?.output_selector?.filename || "file";

                // Determine icon
                let icon = "lucide:image";
                if (isVideo) icon = "lucide:video";
                else if (isAudio) icon = "lucide:music";
                else if (isModel3d) icon = "lucide:box";

                return (
                  <div
                    key={obj.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800/50 text-xs text-zinc-400"
                  >
                    <Icon icon={icon} className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{filename}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 h-10 px-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
              disabled={isExporting}
            >
              Cancel
            </button>
            <button
              onClick={handleDirectDownload}
              disabled={isExporting}
              className="flex-1 h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isExporting ? (
                <>
                  <Icon
                    icon="lucide:loader-2"
                    className="w-4 h-4 animate-spin"
                  />
                  Downloading...
                </>
              ) : (
                <>
                  <Icon icon="lucide:download" className="w-4 h-4" />
                  Download
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderCanvasExportUI = () => (
    <div className="w-full max-w-md">
      <div className="space-y-4">
        <div>
          <label className="text-sm text-zinc-400 mb-3 block">
            Choose format
          </label>
          <div className="space-y-2">
            {exportFormats.map((format) => (
              <button
                key={format.value}
                onClick={() => setSelectedFormat(format.value)}
                className={`w-full p-4 rounded-lg border transition-all text-left ${
                  selectedFormat === format.value
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-white/10 bg-zinc-900/50 hover:border-white/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      selectedFormat === format.value
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    <Icon icon={format.icon} className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">
                        {format.label}
                      </span>
                      {selectedFormat === format.value && (
                        <Icon
                          icon="lucide:check"
                          className="w-5 h-5 text-emerald-400"
                        />
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 mt-1">
                      {format.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={onClose}
            className="flex-1 h-10 px-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1 h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isExporting ? (
              <>
                <Icon icon="lucide:loader-2" className="w-4 h-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Icon icon="lucide:download" className="w-4 h-4" />
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isAllDownloadableMedia ? "Download" : "Export As"}
    >
      {isAllDownloadableMedia
        ? renderDownloadableMediaUI()
        : renderCanvasExportUI()}
    </Modal>
  );
}
