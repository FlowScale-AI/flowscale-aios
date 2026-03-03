import { useMutation } from "@tanstack/react-query";
import { axios } from "@/lib/axios";
import { CanvasItem } from "../types";
import { isDesktop } from "@/lib/platform";
import { localUpdateCanvasItems } from "@/lib/local-db";

export const updateCanvasItems = async (
  canvasId: string,
  items: CanvasItem[],
): Promise<void> => {
  if (isDesktop()) return localUpdateCanvasItems(canvasId, items);

  await axios.patch(`/v1/canvas/${canvasId}/items`, { items });
};

export const useUpdateCanvasItems = (canvasId: string) => {
  return useMutation({
    mutationFn: (items: CanvasItem[]) => updateCanvasItems(canvasId, items),
  });
};
