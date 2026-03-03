import { useQuery } from "@tanstack/react-query";
import { Canvas } from "../types";
import { localGetCanvasList } from "@/lib/local-db";

export const getCanvasList = async (): Promise<Canvas[]> => {
  return localGetCanvasList();
};

export const useCanvasList = () => {
  return useQuery({
    queryKey: ["canvases"],
    queryFn: getCanvasList,
  });
};
