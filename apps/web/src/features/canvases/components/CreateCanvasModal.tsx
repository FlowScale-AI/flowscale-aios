"use client";

import { useState } from "react";
import { Modal } from "@flowscale/ui";
import { Icon } from "@iconify/react";
import { useCreateCanvas } from "@/features/canvases/api";

interface CreateCanvasModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateCanvasModal({
  isOpen,
  onClose,
}: CreateCanvasModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState({ name: false });

  const { mutate, isPending } = useCreateCanvas({
    onSuccess: () => {
      // Reset form
      setName("");
      setDescription("");
      setTouched({ name: false });
      onClose();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setTouched({ ...touched, name: true });
      return;
    }

    mutate({
      name,
      description: description || "",
    });
  };

  const isNameInvalid = touched.name && name.trim().length === 0;
  const isNameTooLong = name.length > 50;
  const isDescriptionTooLong = description.length > 200;
  const isValid =
    name.trim().length > 0 && !isNameTooLong && !isDescriptionTooLong;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Canvas">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          {/* Name Input */}
          <div className="space-y-1.5">
            <label
              htmlFor="canvas-name"
              className="text-xs font-semibold text-zinc-400 uppercase tracking-wider"
            >
              Canvas Name <span className="text-red-500">*</span>
            </label>
            <input
              id="canvas-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched({ ...touched, name: true })}
              placeholder="e.g. Cyberpunk Character Design"
              className={`w-full bg-black/20 border ${isNameInvalid || isNameTooLong ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-emerald-500/50"} rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 ${isNameInvalid || isNameTooLong ? "focus:ring-red-500/20" : "focus:ring-emerald-500/20"} transition-all`}
              autoFocus
            />
            {isNameInvalid && (
              <p className="text-xs text-red-400">Canvas name is required</p>
            )}
            {isNameTooLong && (
              <p className="text-xs text-red-400">
                Name cannot exceed 50 characters
              </p>
            )}
          </div>

          {/* Description Input */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label
                htmlFor="canvas-desc"
                className="text-xs font-semibold text-zinc-400 uppercase tracking-wider"
              >
                Description
              </label>
              <span
                className={`text-[10px] ${isDescriptionTooLong ? "text-red-400" : "text-zinc-600"}`}
              >
                {description.length}/200
              </span>
            </div>
            <textarea
              id="canvas-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your project..."
              rows={4}
              className={`w-full bg-black/20 border ${isDescriptionTooLong ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-emerald-500/50"} rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 ${isDescriptionTooLong ? "focus:ring-red-500/20" : "focus:ring-emerald-500/20"} transition-all resize-none`}
            />
            {isDescriptionTooLong && (
              <p className="text-xs text-red-400">
                Description cannot exceed 200 characters
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || isPending}
            className="px-6 py-2 text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-black rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Icon icon="svg-spinners:ring-resize" />
                <span>Creating...</span>
              </>
            ) : (
              <span>Create Canvas</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
