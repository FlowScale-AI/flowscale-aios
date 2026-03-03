import { useMutation } from "@tanstack/react-query";
import type { CanvasItem } from "../types";

export const updateCanvasItems = async (canvasId: string, items: CanvasItem[]): Promise<void> => {
  const res = await fetch(`/api/canvases/${canvasId}/items`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error("Failed to update canvas items");
};

export const useUpdateCanvasItems = (canvasId: string) => {
  return useMutation({
    mutationFn: (items: CanvasItem[]) => updateCanvasItems(canvasId, items),
  });
};
