import { useMutation } from "@tanstack/react-query";
import { axios } from "@/lib/axios";
import { CanvasItem } from "../types";
import { isDesktop } from "@/lib/platform";
import { localSaveCanvasItems } from "@/lib/local-db";

export const saveCanvasItems = async (
  canvasId: string,
  items: CanvasItem[],
): Promise<void> => {
  if (isDesktop()) return localSaveCanvasItems(canvasId, items);

  await axios.post(`/v1/canvas/${canvasId}/items`, { items });
};

export const useSaveCanvasItems = (canvasId: string) => {
  return useMutation({
    mutationFn: (items: CanvasItem[]) => saveCanvasItems(canvasId, items),
  });
};
