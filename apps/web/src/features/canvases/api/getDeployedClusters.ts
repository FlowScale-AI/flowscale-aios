import { useQuery } from "@tanstack/react-query";

export interface DeployedCluster {
  public_url: string;
  pod_name: string;
  cluster_id: string;
  status: string;
  gpu_type: string;
  mode: "api" | "comfyui" | string;
  created_at: string;
  subdomain: string;
  project_api_key: string;
}

interface DeployedClustersResponse {
  status: string;
  data: DeployedCluster[];
}

// EIOS: no cloud clusters — all execution is local via ComfyUI proxy
export const getDeployedClusters = async (
  _projectId: string,
): Promise<DeployedClustersResponse> => {
  return { status: "success", data: [] };
};

export const useGetDeployedClusters = (projectId: string | undefined) => {
  return useQuery({
    queryKey: ["deployed-clusters", projectId],
    queryFn: () => getDeployedClusters(projectId!),
    enabled: !!projectId,
  });
};
