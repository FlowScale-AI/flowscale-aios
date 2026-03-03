import { useQuery } from "@tanstack/react-query";
import { localGetAllRunsList } from "@/lib/local-db";

export interface RunOutput {
  content_type?: string;
  filename: string;
  s3_key?: string;
  url?: string;
  size?: number;
  label?: string;
  parameter_name?: string;
  node_path?: string;
  node_id?: string;
  data?: string; // For text outputs
}

export interface RunItem {
  _id: string;
  pod_id: string;
  cluster_id: string;
  team_id: string;
  project_id: string;
  workflow_id: string;
  group_id: string;
  status: string;
  trigger_type: string;
  inputs: any[];
  canvas_id: string | null;
  output_metadata: any[];
  outputs: RunOutput[];
  error: string | null;
  execution_time_ms: number | null;
  started_at: string;
  completed_at: string;
  created_at: string;
  updated_at: string;
  container_id: string;
  prompt_id: string;
  progress: number | null;
  can_regenerate: boolean;
  project_name: string;
  workflow_name: string;
  regenerations: any[];
}

export interface RunsListResponse {}

export const getAllRunsList = async ({
  filter_by,
  filter_value,
  page_size,
  page_number,
}: {
  filter_by: string;
  filter_value: string;
  category?: string;
  page_size: number;
  page_number: number;
}): Promise<RunsListResponse | undefined> => {
  return localGetAllRunsList({ filter_by, filter_value, page_size, page_number });
};

export const useGetAllRunsList = (
  filter_by: string,
  filter_value: string,
  category: string,
  page_size: number,
  page_number: number,
  config = {},
) => {
  return useQuery<RunsListResponse | undefined, Error>({
    queryKey: ["getAllRuns", filter_by, filter_value, category, page_number],
    queryFn: () => getAllRunsList({ filter_by, filter_value, category, page_size, page_number }),
    enabled: !!filter_by && !!filter_value,
    ...config,
  });
};
