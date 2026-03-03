"use client";

import { ReactNode, useState } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  delay = 500,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    const id = setTimeout(() => setIsVisible(true), delay);
    setTimeoutId(id);
  };

  const handleMouseLeave = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    setIsVisible(false);
  };

  const getTooltipPosition = () => {
    switch (side) {
      case "top":
        return "bottom-full left-1/2 -translate-x-1/2 mb-2";
      case "bottom":
        return "top-full left-1/2 -translate-x-1/2 mt-2";
      case "left":
        return "right-full top-1/2 -translate-y-1/2 mr-2";
      case "right":
        return "left-full top-1/2 -translate-y-1/2 ml-2";
    }
  };

  const getArrowPosition = () => {
    switch (side) {
      case "top":
        return "top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45";
      case "bottom":
        return "bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45";
      case "left":
        return "left-full top-1/2 -translate-y-1/2 translate-x-1/2 rotate-45";
      case "right":
        return "right-full top-1/2 -translate-y-1/2 -translate-x-1/2 rotate-45";
    }
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute ${getTooltipPosition()} z-9999 pointer-events-none animate-in fade-in zoom-in-95 duration-100`}
        >
          <div className="relative bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
            <span className="text-xs text-zinc-200 font-medium">{content}</span>
            <div
              className={`absolute ${getArrowPosition()} w-2 h-2 bg-zinc-900 border-white/10 ${
                side === "top" || side === "bottom"
                  ? "border-b border-r"
                  : "border-t border-r"
              }`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
