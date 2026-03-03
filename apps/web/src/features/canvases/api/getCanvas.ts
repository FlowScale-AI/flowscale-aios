import { useQuery } from "@tanstack/react-query";
import type { Canvas } from "../types";

export const getCanvas = async (id: string): Promise<Canvas> => {
  const res = await fetch(`/api/canvases/${id}`);
  if (!res.ok) throw new Error(`Canvas ${id} not found`);
  return res.json();
};

export const useGetCanvas = (id: string) => {
  return useQuery({
    queryKey: ["canvas", id],
    queryFn: () => getCanvas(id),
    enabled: !!id,
  });
};
