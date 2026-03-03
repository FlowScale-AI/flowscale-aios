import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Canvas, CreateCanvasDTO } from "../types";
import { localCreateCanvas } from "@/lib/local-db";

export const createCanvas = async (data: CreateCanvasDTO): Promise<Canvas> => {
  return localCreateCanvas(data);
};

export const useCreateCanvas = (options?: { onSuccess?: () => void }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCanvas,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvases"] });
      options?.onSuccess?.();
    },
    onError: (error) => {
      console.error("[createCanvas]", error);
    },
  });
};
