import { useQuery } from "@tanstack/react-query";
import type { Canvas } from "../types";

export const getCanvasList = async (): Promise<Canvas[]> => {
  const res = await fetch("/api/canvases");
  if (!res.ok) throw new Error("Failed to fetch canvases");
  return res.json();
};

export const useCanvasList = () => {
  return useQuery({
    queryKey: ["canvases"],
    queryFn: getCanvasList,
  });
};
