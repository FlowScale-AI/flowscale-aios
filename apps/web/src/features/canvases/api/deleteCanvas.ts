import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localDeleteCanvas } from "@/lib/local-db";

export const deleteCanvas = async (id: string): Promise<void> => {
  return localDeleteCanvas(id);
};

export const useDeleteCanvas = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCanvas,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvases"] });
    },
    onError: (error) => {
      console.error("[deleteCanvas]", error);
    },
  });
};
