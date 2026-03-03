import { useMutation, useQueryClient } from "@tanstack/react-query";

export const deleteCanvasItem = async (canvasId: string, itemId: string): Promise<void> => {
  const res = await fetch(`/api/canvases/${canvasId}/items/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete canvas item");
};

export const useDeleteCanvasItem = (canvasId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => deleteCanvasItem(canvasId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas-items", canvasId] });
    },
    onError: (error) => {
      console.error("[deleteCanvasItem]", error);
    },
  });
};
