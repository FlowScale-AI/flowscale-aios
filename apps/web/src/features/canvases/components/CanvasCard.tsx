"use client";
import { Canvas } from "@/features/canvases/types";
import { Icon } from "@iconify/react";

import { useState, useRef, useEffect } from "react";
import { useDeleteCanvas } from "@/features/canvases/api";
import { Modal } from "@flowscale/ui";

export default function CanvasCard({ canvas }: { canvas: Canvas }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { mutate: deleteCanvas, isPending } = useDeleteCanvas();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleDelete = () => {
    deleteCanvas(canvas._id, {
      onSuccess: () => {
        setIsDeleteModalOpen(false);
      },
    });
  };

  const handleNavigate = () => {
    window.location.href = `/studio/canvases/${canvas._id}`;
  };

  return (
    <div
      onClick={handleNavigate}
      className="group bg-zinc-900/50 border border-white/5 p-5 rounded-2xl transition-all duration-300 hover:bg-zinc-900 hover:border-emerald-500/30 hover:shadow-xl hover:shadow-emerald-900/10 hover:-translate-y-1 flex flex-col aspect-square relative cursor-pointer"
    >
      {/* Thumbnail Placeholder */}
      <div className="flex-1 bg-gradient-to-br from-white/5 to-white/[0.02] rounded-xl mb-4 overflow-hidden relative border border-white/5 group-hover:border-white/10 transition-colors">
        <div className="absolute inset-0 flex items-center justify-center text-zinc-700 group-hover:text-emerald-500/50 transition-colors duration-300">
          <Icon icon="solar:gallery-wide-linear" width="32" />
        </div>
      </div>

      <div className="flex justify-between items-start mb-1">
        <h3 className="text-white font-medium group-hover:text-emerald-400 transition-colors font-tech truncate pr-8 text-lg">
          {canvas.name}
        </h3>
      </div>

      <p className="text-zinc-500 text-sm leading-relaxed line-clamp-2 mb-4 h-10">
        {canvas.description || "No description provided."}
      </p>

      <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-auto">
        <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-mono-custom">
          <Icon icon="solar:clock-circle-linear" width="14" />
          <span>
            {new Date(canvas.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity -mr-2">
          <Icon
            icon="solar:arrow-right-linear"
            className="text-emerald-500"
            width="20"
          />
        </div>
      </div>

      {/* Overflow Menu Trigger */}
      <div className="absolute top-4 right-4 z-10" ref={menuRef}>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          className={`p-1 rounded hover:bg-white/10 transition-colors ${
            isMenuOpen
              ? "opacity-100 bg-white/10"
              : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Icon
            icon="solar:menu-dots-bold"
            className="text-zinc-400"
            width="16"
          />
        </button>

        {/* Menu Dropdown */}
        {isMenuOpen && (
          <div className="absolute top-full right-0 mt-1 w-32 bg-zinc-800 border border-white/10 rounded-lg shadow-xl overflow-hidden z-20">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsMenuOpen(false);
                setIsDeleteModalOpen(true);
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-white/5 hover:text-red-300 transition-colors flex items-center gap-2"
            >
              <Icon icon="solar:trash-bin-trash-linear" width="14" />
              Delete
            </button>
          </div>
        )}
      </div>

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Canvas"
        maxWidth="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-zinc-400 text-sm">
            Are you sure you want to delete{" "}
            <span className="text-white font-medium">{canvas.name}</span>? This
            action cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={() => setIsDeleteModalOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors flex items-center gap-1.5"
            >
              {isPending && <Icon icon="svg-spinners:180-ring" width="12" />}
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
