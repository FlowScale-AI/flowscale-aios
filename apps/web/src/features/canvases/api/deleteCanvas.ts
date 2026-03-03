import { useMutation, useQueryClient } from "@tanstack/react-query";

export const deleteCanvas = async (id: string): Promise<void> => {
  const res = await fetch(`/api/canvases/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete canvas");
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
