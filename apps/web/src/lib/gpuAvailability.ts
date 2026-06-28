"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "flowscale-gpu-availability";
const CHANGE_EVENT = "flowscale-gpu-availability-change";

export function readGpuAvailability(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function writeGpuAvailability(map: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Devices default to available; only explicit `false` disables them.
 * Key formats:
 *   - GPU: `${backend}:${index}` e.g. "cuda:0", "rocm:1"
 *   - CPU: "cpu"
 */
export function isDeviceAvailable(
  key: string,
  map?: Record<string, boolean>,
): boolean {
  const m = map ?? readGpuAvailability();
  return m[key] !== false;
}

/**
 * Map an AIOS-managed instance's `device` field to the availability key.
 * Returns null for non-managed devices (e.g. "external") which should never
 * be filtered.
 */
export function deviceKeyForInstance(device: string): string | null {
  if (device === "cpu") return "cpu";
  // ComfyUI manager uses "cuda:N" / "rocm:N" — same shape as the availability key.
  if (/^(cuda|rocm):\d+$/.test(device)) return device;
  return null;
}

/** React hook — re-renders when availability changes in this tab or another. */
export function useGpuAvailability(): Record<string, boolean> {
  const [map, setMap] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setMap(readGpuAvailability());
    const handler = () => setMap(readGpuAvailability());
    window.addEventListener("storage", handler);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(CHANGE_EVENT, handler);
    };
  }, []);
  return map;
}
