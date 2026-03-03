import { useQuery } from "@tanstack/react-query";
import { axios } from "@/lib/axios";
import { Canvas } from "../types";
import { isDesktop } from "@/lib/platform";
import { localGetCanvas } from "@/lib/local-db";

export const getCanvas = async (id: string): Promise<Canvas> => {
  if (isDesktop()) return localGetCanvas(id);

  const response = await axios.get(`/v1/canvas/${id}`);
  return response.data;
};

export const useGetCanvas = (id: string) => {
  return useQuery({
    queryKey: ["canvas", id],
    queryFn: () => getCanvas(id),
    enabled: !!id,
  });
};
