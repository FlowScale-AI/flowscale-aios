import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localDeleteCanvasItem } from "@/lib/local-db";

export const deleteCanvasItem = async (
  canvasId: string,
  itemId: string,
): Promise<void> => {
  return localDeleteCanvasItem(canvasId, itemId);
};

export const useDeleteCanvasItem = (canvasId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => deleteCanvasItem(canvasId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvasItems", canvasId] });
    },
    onError: (error) => {
      console.error("[deleteCanvasItem]", error);
    },
  });
};
