import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";

export interface SendToTarget {
  parameterName: string;
  label: string;
  mediaType: string;
  hint?: string; // e.g. node class or parameter path for disambiguation
}

export interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  hasSelection: boolean;
  hasClipboard: boolean;
  sendToTargets?: SendToTarget[];
  onSendTo?: (target: SendToTarget) => void;
}

export function ContextMenu({
  x,
  y,
  onClose,
  onCopy,
  onPaste,
  onDuplicate,
  onFlipHorizontal,
  onFlipVertical,
  onDelete,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  hasSelection,
  hasClipboard,
  sendToTargets,
  onSendTo,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Use mousedown to capture the click before it might trigger other things
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // Simple boundary checking to keep menu in view could be added here
  // For now, we trust the caller or CSS constraints

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-[#18181b] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[180px] backdrop-blur-xl"
      style={{ left: x, top: y }}
    >
      <ContextMenuItem
        icon="solar:copy-linear"
        label="Copy"
        shortcut="Ctrl+C"
        onClick={onCopy}
        disabled={!hasSelection}
      />
      <ContextMenuItem
        icon="solar:clipboard-list-linear"
        label="Paste"
        shortcut="Ctrl+V"
        onClick={onPaste}
        disabled={!hasClipboard}
      />
      <ContextMenuItem
        icon="solar:copy-bold-duotone"
        label="Duplicate"
        shortcut="Ctrl+D"
        onClick={onDuplicate}
        disabled={!hasSelection}
      />
      <div className="h-px bg-white/5 my-1" />
      <ContextMenuSubmenu
        icon="solar:arrow-right-up-linear"
        label="Send To"
        targets={sendToTargets ?? []}
        onSelect={(target) => {
          onSendTo?.(target);
          onClose();
        }}
      />
      <div className="h-px bg-white/5 my-1" />
      <ContextMenuItem
        icon="solar:flip-horizontal-linear"
        label="Flip Horizontal"
        onClick={onFlipHorizontal}
        disabled={!hasSelection}
      />
      <ContextMenuItem
        icon="solar:flip-vertical-linear"
        label="Flip Vertical"
        onClick={onFlipVertical}
        disabled={!hasSelection}
      />
      <div className="h-px bg-white/5 my-1" />
      <ContextMenuItem
        icon="solar:layers-minimalistic-linear"
        label="Bring to Front"
        shortcut="]"
        onClick={onBringToFront}
        disabled={!hasSelection}
      />
      <ContextMenuItem
        icon="solar:layers-linear"
        label="Bring Forward"
        shortcut="Ctrl+]"
        onClick={onBringForward}
        disabled={!hasSelection}
      />
      <ContextMenuItem
        icon="solar:layers-linear"
        label="Send Backward"
        shortcut="Ctrl+["
        onClick={onSendBackward}
        disabled={!hasSelection}
      />
      <ContextMenuItem
        icon="solar:layers-minimalistic-linear"
        label="Send to Back"
        shortcut="["
        onClick={onSendToBack}
        disabled={!hasSelection}
      />
      <div className="h-px bg-white/5 my-1" />
      <ContextMenuItem
        icon="solar:trash-bin-trash-linear"
        label="Delete"
        shortcut="Del"
        onClick={onDelete}
        danger
        disabled={!hasSelection}
      />
    </div>
  );
}

interface ContextMenuItemProps {
  icon: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function ContextMenuItem({
  icon,
  label,
  shortcut,
  danger = false,
  disabled = false,
  onClick,
}: ContextMenuItemProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors
                ${
                  disabled
                    ? "opacity-50 cursor-not-allowed text-zinc-500"
                    : danger
                      ? "text-red-400 hover:bg-red-500/10"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                }
            `}
    >
      <Icon
        icon={icon}
        width="14"
        className={
          disabled ? "text-zinc-600" : danger ? "text-red-400" : "text-zinc-400"
        }
      />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-zinc-600 text-[10px]">{shortcut}</span>
      )}
    </button>
  );
}

const MEDIA_TYPE_ICONS: Record<string, string> = {
  image: "solar:gallery-linear",
  video: "solar:videocamera-linear",
  audio: "solar:music-library-linear",
  "3d": "solar:cube-linear",
};

interface ContextMenuSubmenuProps {
  icon: string;
  label: string;
  targets: SendToTarget[];
  onSelect: (target: SendToTarget) => void;
}

function ContextMenuSubmenu({ icon, label, targets, onSelect }: ContextMenuSubmenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setIsOpen(true);
  };

  const handleLeave = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  };

  useEffect(() => {
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-zinc-300 hover:bg-white/5 hover:text-white"
      >
        <Icon icon={icon} width="14" className="text-zinc-400" />
        <span className="flex-1 text-left">{label}</span>
        <Icon icon="solar:alt-arrow-right-linear" width="12" className="text-zinc-500" />
      </button>

      {isOpen && (
        <div
          className="absolute left-full top-0 bg-[#18181b] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px] backdrop-blur-xl z-50"
          style={{ marginLeft: -4 , paddingLeft: 4 }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          {targets.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-zinc-500 italic">
              No compatible inputs
            </div>
          ) : targets.map((target) => (
            <button
              key={target.parameterName}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(target);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-zinc-300 hover:bg-white/5 hover:text-white"
            >
              <Icon
                icon={MEDIA_TYPE_ICONS[target.mediaType] || "solar:document-linear"}
                width="14"
                className="text-zinc-400 shrink-0"
              />
              <div className="flex-1 min-w-0 text-left">
                <span className="block truncate">{target.label}</span>
                {target.hint && (
                  <span className="block text-[10px] text-zinc-600 truncate">{target.hint}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
