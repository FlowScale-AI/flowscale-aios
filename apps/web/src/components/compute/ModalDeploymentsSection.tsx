"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Monitor, Lightning, Stop, Trash } from "phosphor-react";
import { useModalStatus } from "@/hooks/useModalStatus";

interface PluginDeployRecord {
  id: string;
  name: string;
  status: "deploying" | "deployed" | "failed";
  appName: string;
  url: string;
  gpu: string;
  deployedAt: number;
  error?: string;
}

export function ModalDeploymentsSection() {
  const { data: modalStatus } = useModalStatus();
  const { data: modalComfyData } = useQuery<{
    instances: Array<{
      id: string;
      name: string;
      status: string;
      gpu: string;
      virtualPort: number;
    }>;
  }>({
    queryKey: ["modal-comfyui-instances"],
    queryFn: async () => {
      const res = await fetch("/api/modal/comfyui");
      if (!res.ok) return { instances: [] };
      return res.json();
    },
    enabled: modalStatus?.authenticated === true,
  });
  const { data: pluginDeployData } = useQuery<{
    deployments: Record<string, PluginDeployRecord[]>;
  }>({
    queryKey: ["modal-all-deployments"],
    queryFn: async () => {
      const res = await fetch("/api/modal/deployments");
      if (!res.ok) return { deployments: {} };
      return res.json();
    },
    enabled: modalStatus?.authenticated === true,
    refetchInterval: 15_000,
  });

  const queryClient = useQueryClient();

  const comfyInstances = modalComfyData?.instances ?? [];
  const pluginDeployments = pluginDeployData?.deployments ?? {};
  const allPluginDeploys = Object.entries(pluginDeployments).flatMap(
    ([pluginId, records]) => records.map((r) => ({ ...r, pluginId })),
  );

  const hasAnyDeployments =
    comfyInstances.length > 0 || allPluginDeploys.length > 0;

  if (!modalStatus?.authenticated) return null;

  const undeployPlugin = async (pluginId: string, deployId: string) => {
    await fetch(`/api/modal/deploy/${pluginId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undeploy", deployId }),
    });
    queryClient.invalidateQueries({ queryKey: ["modal-all-deployments"] });
  };

  const undeployComfy = async (instanceId: string) => {
    await fetch("/api/modal/comfyui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undeploy", instanceId }),
    });
    queryClient.invalidateQueries({ queryKey: ["modal-comfyui-instances"] });
  };

  return (
    <section>
      <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="size-9 rounded-lg border border-purple-500/20 bg-purple-500/10 flex items-center justify-center overflow-hidden shrink-0">
            <Cloud size={18} className="text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-200">
                Cloud Deployments
              </span>
              {hasAnyDeployments && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold text-purple-400 bg-purple-400/10 rounded-full border border-purple-400/20">
                  {comfyInstances.length + allPluginDeploys.length} active
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600 mt-0.5">
              All Modal deployments across tools and ComfyUI instances
            </p>
          </div>
        </div>

        {!hasAnyDeployments ? (
          <p className="text-xs text-zinc-600 py-2">
            No active cloud deployments.
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* ComfyUI instances */}
            {comfyInstances.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-900/50 border border-white/5"
              >
                <div className="flex items-center gap-2.5">
                  <Monitor size={13} className="text-purple-400/70" />
                  <span className="text-xs font-medium text-zinc-300">
                    {inst.name}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600">
                    {inst.gpu}
                  </span>
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 bg-zinc-800 rounded-full">
                    ComfyUI
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] ${inst.status === "deployed" ? "text-emerald-400" : inst.status === "deploying" ? "text-amber-400" : "text-red-400"}`}
                  >
                    {inst.status}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600">--/job</span>
                  {inst.status === "deployed" && (
                    <button
                      onClick={() => undeployComfy(inst.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                      title="Stop deployment"
                    >
                      <Stop size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Tool plugin deployments */}
            {allPluginDeploys.map((d) => (
              <div
                key={`${d.pluginId}-${d.id}`}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-900/50 border border-white/5"
              >
                <div className="flex items-center gap-2.5">
                  <Lightning size={13} className="text-purple-400/70" />
                  <span className="text-xs font-medium text-zinc-300">
                    {d.name}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600">
                    {d.gpu}
                  </span>
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 bg-zinc-800 rounded-full">
                    {d.pluginId}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] ${d.status === "deployed" ? "text-emerald-400" : d.status === "deploying" ? "text-amber-400" : "text-red-400"}`}
                  >
                    {d.status}
                  </span>
                  {d.status === "failed" && d.error && (
                    <span
                      className="text-[10px] text-red-400 max-w-[150px] truncate"
                      title={d.error}
                    >
                      {d.error}
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-zinc-600">--/job</span>
                  {(d.status === "deployed" || d.status === "failed") && (
                    <button
                      onClick={() => undeployPlugin(d.pluginId, d.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                      title={
                        d.status === "failed" ? "Remove" : "Stop deployment"
                      }
                    >
                      {d.status === "failed" ? (
                        <Trash size={12} />
                      ) : (
                        <Stop size={12} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
