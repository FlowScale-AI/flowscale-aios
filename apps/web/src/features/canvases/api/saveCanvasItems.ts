import { useMutation } from "@tanstack/react-query";
import type { CanvasItem } from "../types";

export const saveCanvasItems = async (canvasId: string, items: CanvasItem[]): Promise<void> => {
  const res = await fetch(`/api/canvases/${canvasId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error("Failed to save canvas items");
};

export const useSaveCanvasItems = (canvasId: string) => {
  return useMutation({
    mutationFn: (items: CanvasItem[]) => saveCanvasItems(canvasId, items),
  });
};
