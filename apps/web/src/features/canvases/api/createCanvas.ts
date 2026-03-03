import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Canvas, CreateCanvasDTO } from "../types";

export const createCanvas = async (data: CreateCanvasDTO): Promise<Canvas> => {
  const res = await fetch("/api/canvases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create canvas");
  return res.json();
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
