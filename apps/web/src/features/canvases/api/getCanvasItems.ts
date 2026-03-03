import { useQuery } from "@tanstack/react-query";
import type { CanvasItem } from "../types";

export const getCanvasItems = async (canvasId: string): Promise<CanvasItem[]> => {
  const res = await fetch(`/api/canvases/${canvasId}/items`);
  if (!res.ok) throw new Error("Failed to fetch canvas items");
  return res.json();
};

export const useGetCanvasItems = (canvasId: string) => {
  return useQuery({
    queryKey: ["canvas-items", canvasId],
    queryFn: () => getCanvasItems(canvasId),
    enabled: !!canvasId,
  });
};
