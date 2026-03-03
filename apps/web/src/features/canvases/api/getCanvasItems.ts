import { useQuery } from "@tanstack/react-query";
import { axios } from "@/lib/axios";
import { CanvasItem } from "../types";
import { isDesktop } from "@/lib/platform";
import { localGetCanvasItems } from "@/lib/local-db";

export interface GetCanvasItemsResponse {
  items: CanvasItem[];
}

export const getCanvasItems = async (
  canvasId: string,
): Promise<CanvasItem[]> => {
  if (isDesktop()) return localGetCanvasItems(canvasId);

  const response = await axios.get<GetCanvasItemsResponse>(
    `/v1/canvas/${canvasId}/items?${Math.random()}`, // Add cache buster
  );
  return response.data.items;
};

export const useGetCanvasItems = (canvasId: string) => {
  return useQuery({
    queryKey: ["canvas-items", canvasId],
    queryFn: () => getCanvasItems(canvasId),
    enabled: !!canvasId,
  });
};
