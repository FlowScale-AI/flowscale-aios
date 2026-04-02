"use client";

import { useState, useEffect } from "react";
import { Cloud, Spinner, X, Warning, ArrowsClockwise, DownloadSimple, GitBranch } from "phosphor-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useModalComfyInstances } from "@/hooks/useModalComfyInstances";
import type { ModalComfyInstanceData } from "@/hooks/useModalComfyInstances";
import { Modal } from "@flowscale/ui";

const TAG = "[ModalComfySection]";

const GPU_OPTIONS = [
  { value: "T4", label: "T4 (16 GB)" },
  { value: "L4", label: "L4 (24 GB)" },
  { value: "A10", label: "A10 (24 GB)" },
  { value: "L40S", label: "L40S (48 GB)" },
  { value: "A100-40GB", label: "A100 40 GB" },
  { value: "A100-80GB", label: "A100 80 GB" },
  { value: "RTX-PRO-6000", label: "RTX PRO 6000 (48 GB)" },
  { value: "H100", label: "H100 (80 GB)" },
  { value: "H200", label: "H200 (141 GB)" },
  { value: "B200", label: "B200 (192 GB)" },
] as const;

function generateInstanceName(
  gpu: string,
  existing: ModalComfyInstanceData[],
): string {
  const prefix = `comfyui-${gpu.toLowerCase()}`;
  let n = 1;
  while (
    existing.some(
      (i) => i.id === `${prefix}-${n}` || i.name === `${prefix}-${n}`,
    )
  )
    n++;
  return `${prefix}-${n}`;
}

function detectUrlSource(url: string): "huggingface" | "civitai" | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("huggingface.co") || hostname.includes("hf.co")) return "huggingface";
    if (hostname.includes("civitai.com")) return "civitai";
  } catch { /* ignore */ }
  return null;
}

export function ModalComfySection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useModalComfyInstances();

  const instances = data?.instances ?? [];
  const isAnyDeploying = instances.some((i) => i.status === "deploying");

  // Deploy popup state
  const [showDeployPopup, setShowDeployPopup] = useState(false);
  const [popupGpu, setPopupGpu] = useState("A10");
  const [popupName, setPopupName] = useState(() =>
    generateInstanceName("A10", []),
  );

  // Optimistic pending instances
  const [pendingInstances, setPendingInstances] = useState<
    ModalComfyInstanceData[]
  >([]);
  const allInstances = [
    ...instances,
    ...pendingInstances.filter((p) => !instances.some((i) => i.id === p.id)),
  ];

  // Undeploy confirmation state
  const [confirmUndeployId, setConfirmUndeployId] = useState<string | null>(null);
  // Redeploy confirmation state
  const [confirmRedeployId, setConfirmRedeployId] = useState<string | null>(null);
  // Track which instance IDs are being undeployed
  const [undeployingIds, setUndeployingIds] = useState<Set<string>>(new Set());

  // Add Model modal state
  const [showAddModel, setShowAddModel] = useState(false);
  const [modelUrl, setModelUrl] = useState("");
  const [modelType, setModelType] = useState("checkpoint");
  const [modelFilename, setModelFilename] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [modelDownloadStatus, setModelDownloadStatus] = useState<{ active: boolean; filename: string; error?: string }>({ active: false, filename: "" });

  // Add Custom Node modal state
  const [showAddNode, setShowAddNode] = useState(false);
  const [nodeRepoUrl, setNodeRepoUrl] = useState("");
  const [nodeTargetInstance, setNodeTargetInstance] = useState<string>("");
  const [nodeAddStatus, setNodeAddStatus] = useState<{ active: boolean; name: string; error?: string }>({ active: false, name: "" });

  // Detect URL source for conditional API key field
  const modelUrlSource = detectUrlSource(modelUrl);

  // Log when query data changes
  useEffect(() => {
    console.log(TAG, "query data updated — server instances:", instances.map((i) => `${i.id}(${i.status})`));
    console.log(TAG, "pendingInstances:", pendingInstances.map((i) => `${i.id}(${i.status})`));
    console.log(TAG, "allInstances (merged):", allInstances.map((i) => `${i.id}(${i.status})`));
    console.log(TAG, "undeployingIds:", [...undeployingIds]);
    console.log(TAG, "confirmUndeployId:", confirmUndeployId);
  }, [data, pendingInstances.length, undeployingIds.size, confirmUndeployId]);

  const deployMutation = useMutation({
    mutationFn: async ({ gpu, name }: { gpu: string; name: string }) => {
      console.log(TAG, `DEPLOY — calling API: name="${name}" gpu="${gpu}"`);
      const res = await fetch("/api/modal/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", gpu, name }),
      });
      console.log(TAG, `DEPLOY — API responded: status=${res.status}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Deploy failed" }));
        console.error(TAG, `DEPLOY — API error:`, err);
        throw new Error(err.error);
      }
      const json = await res.json();
      console.log(TAG, `DEPLOY — API success:`, json);
      return json;
    },
    onSuccess: (_data, variables) => {
      console.log(TAG, `DEPLOY onSuccess — adding to pendingInstances: name="${variables.name}"`);
      setPendingInstances((prev) => [
        ...prev,
        { id: variables.name, name: variables.name, status: "deploying" as const, gpu: variables.gpu, virtualPort: 0, url: "" },
      ]);
      setShowDeployPopup(false);
      queryClient.invalidateQueries({ queryKey: ["modal-comfyui-instances"] });
    },
    onError: (err) => { console.error(TAG, `DEPLOY onError:`, err); },
  });

  const undeployMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      console.log(TAG, `UNDEPLOY — starting for instanceId="${instanceId}"`);
      setUndeployingIds((prev) => new Set(prev).add(instanceId));
      const res = await fetch("/api/modal/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undeploy", instanceId }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Undeploy failed (${res.status}): ${body}`);
      }
      return res.json();
    },
    onSuccess: (_data, instanceId) => {
      setUndeployingIds((prev) => { const s = new Set(prev); s.delete(instanceId); return s; });
      setPendingInstances((prev) => prev.filter((p) => p.id !== instanceId));
      setConfirmUndeployId(null);
      queryClient.invalidateQueries({ queryKey: ["modal-comfyui-instances"] });
    },
    onError: (err, instanceId) => {
      console.error(TAG, `UNDEPLOY onError — instanceId="${instanceId}":`, err);
      setUndeployingIds((prev) => { const s = new Set(prev); s.delete(instanceId); return s; });
    },
  });

  const resyncMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      const res = await fetch("/api/modal/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resync", instanceId }),
      });
      if (!res.ok) throw new Error("Resync failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["modal-comfyui-instances"] }); },
    onError: (err) => { console.error(TAG, `RESYNC onError:`, err); },
  });

  const redeployMutation = useMutation({
    mutationFn: async ({ instanceId, gpu, name }: { instanceId: string; gpu: string; name: string }) => {
      setUndeployingIds((prev) => new Set(prev).add(instanceId));
      const undeployRes = await fetch("/api/modal/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undeploy", instanceId }),
      });
      if (!undeployRes.ok) throw new Error(`Undeploy failed (${undeployRes.status})`);
      const deployRes = await fetch("/api/modal/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", gpu, name }),
      });
      if (!deployRes.ok) {
        const err = await deployRes.json().catch(() => ({ error: "Deploy failed" }));
        throw new Error(err.error);
      }
      return deployRes.json();
    },
    onSuccess: (_data, variables) => {
      setUndeployingIds((prev) => { const s = new Set(prev); s.delete(variables.instanceId); return s; });
      setPendingInstances((prev) => [
        ...prev.filter((p) => p.id !== variables.instanceId),
        { id: variables.name, name: variables.name, status: "deploying" as const, gpu: variables.gpu, virtualPort: 0, url: "" },
      ]);
      setConfirmRedeployId(null);
      queryClient.invalidateQueries({ queryKey: ["modal-comfyui-instances"] });
    },
    onError: (err, variables) => {
      console.error(TAG, `REDEPLOY onError:`, err);
      setUndeployingIds((prev) => { const s = new Set(prev); s.delete(variables.instanceId); return s; });
      setConfirmRedeployId(null);
    },
  });

  function handleDownloadModel(url: string, type: string, filename: string, apiKey?: string) {
    let downloadUrl = url;
    if (apiKey) {
      const source = detectUrlSource(url);
      if (source === "civitai") {
        const sep = url.includes("?") ? "&" : "?";
        downloadUrl = `${url}${sep}token=${apiKey}`;
      }
    }
    // Close modal immediately — download runs in background
    setShowAddModel(false);
    setModelUrl("");
    setModelFilename("");
    setModelApiKey("");
    setModelDownloadStatus({ active: true, filename });

    fetch("/api/modal/comfyui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "download-model", url: downloadUrl, modelType: type, filename, apiKey: apiKey || undefined }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Download failed" }));
          throw new Error(err.error);
        }
        setModelDownloadStatus({ active: false, filename });
      })
      .catch((err) => {
        console.error(TAG, `DOWNLOAD-MODEL error:`, err);
        setModelDownloadStatus({ active: false, filename, error: err instanceof Error ? err.message : "Download failed" });
        // Auto-clear error after 8 seconds
        setTimeout(() => setModelDownloadStatus((s) => s.error ? { active: false, filename: "", error: undefined } : s), 8000);
      });
  }

  function handleAddNode(repoUrl: string, instanceId?: string) {
    const nodeName = repoUrl.replace(/\.git\/?$/, "").replace(/\/$/, "").split("/").pop() ?? "node";
    // Close modal immediately — clone runs in background
    setShowAddNode(false);
    setNodeRepoUrl("");
    setNodeAddStatus({ active: true, name: nodeName });

    fetch("/api/modal/comfyui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add-custom-node", repoUrl, instanceId: instanceId || undefined }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to add custom node" }));
          throw new Error(err.error);
        }
        const data = await res.json();
        setNodeAddStatus({ active: false, name: nodeName });
        if (data.resyncTriggered) queryClient.invalidateQueries({ queryKey: ["modal-comfyui-instances"] });
      })
      .catch((err) => {
        console.error(TAG, `ADD-NODE error:`, err);
        setNodeAddStatus({ active: false, name: nodeName, error: err instanceof Error ? err.message : "Failed" });
        setTimeout(() => setNodeAddStatus((s) => s.error ? { active: false, name: "", error: undefined } : s), 8000);
      });
  }

  function guessFilenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last && /\.(safetensors|ckpt|pt|pth|bin)$/i.test(last)) return decodeURIComponent(last);
    } catch { /* ignore */ }
    return "";
  }

  function handleModelUrlChange(url: string) {
    setModelUrl(url);
    if (!modelFilename || modelFilename === guessFilenameFromUrl(modelUrl)) {
      setModelFilename(guessFilenameFromUrl(url));
    }
  }

  function handleOpenDeployPopup() {
    const name = generateInstanceName(popupGpu, instances);
    setPopupName(name);
    setShowDeployPopup(true);
  }

  function handlePopupGpuChange(gpu: string) {
    setPopupGpu(gpu);
    setPopupName(generateInstanceName(gpu, instances));
  }

  const inputClass = "w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 focus:border-emerald-500/50 rounded-lg text-zinc-200 outline-none transition-colors placeholder:text-zinc-600";
  const labelClass = "text-zinc-400 text-xs";

  return (
    <div className="mt-4 p-5 rounded-xl border border-purple-900/30 bg-purple-950/10 relative">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} weight="duotone" className="text-purple-400" />
        <span className="text-sm font-semibold text-purple-200 font-tech">
          Cloud Instances (Modal)
        </span>
        {!isLoading && (
          <span className="text-xs text-purple-400/60 font-mono">
            {allInstances.length} instance{allInstances.length !== 1 ? "s" : ""}
          </span>
        )}
        {isAnyDeploying && (
          <span className="flex items-center gap-1 text-purple-400 text-xs">
            <Spinner size={12} className="animate-spin" />
            Deploying...
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              setNodeTargetInstance(instances.find((i) => i.status === "deployed")?.id ?? "");
              setShowAddNode(true);
            }}
            disabled={nodeAddStatus.active}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 rounded-lg transition-colors border border-zinc-700"
          >
            <GitBranch size={12} />
            Add Node
          </button>
          <button
            onClick={() => setShowAddModel(true)}
            disabled={modelDownloadStatus.active}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 rounded-lg transition-colors border border-zinc-700"
          >
            <DownloadSimple size={12} />
            Add Model
          </button>
          <button
            onClick={handleOpenDeployPopup}
            disabled={isAnyDeploying || deployMutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            + Deploy Instance
          </button>
        </div>
      </div>

      {/* Background operation status banners */}
      {modelDownloadStatus.active && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
          <Spinner size={12} className="animate-spin shrink-0" />
          <span>Downloading <span className="font-mono">{modelDownloadStatus.filename}</span> to Modal volume...</span>
        </div>
      )}
      {!modelDownloadStatus.active && modelDownloadStatus.error && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
          <Warning size={12} weight="fill" className="shrink-0" />
          <span>Failed to download <span className="font-mono">{modelDownloadStatus.filename}</span>: {modelDownloadStatus.error}</span>
          <button onClick={() => setModelDownloadStatus({ active: false, filename: "" })} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={10} /></button>
        </div>
      )}
      {!modelDownloadStatus.active && !modelDownloadStatus.error && modelDownloadStatus.filename && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
          <span>Downloaded <span className="font-mono">{modelDownloadStatus.filename}</span> successfully</span>
          <button onClick={() => setModelDownloadStatus({ active: false, filename: "" })} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={10} /></button>
        </div>
      )}
      {nodeAddStatus.active && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
          <Spinner size={12} className="animate-spin shrink-0" />
          <span>Adding custom node <span className="font-mono">{nodeAddStatus.name}</span>...</span>
        </div>
      )}
      {!nodeAddStatus.active && nodeAddStatus.error && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
          <Warning size={12} weight="fill" className="shrink-0" />
          <span>Failed to add <span className="font-mono">{nodeAddStatus.name}</span>: {nodeAddStatus.error}</span>
          <button onClick={() => setNodeAddStatus({ active: false, name: "" })} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={10} /></button>
        </div>
      )}
      {!nodeAddStatus.active && !nodeAddStatus.error && nodeAddStatus.name && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
          <span>Added <span className="font-mono">{nodeAddStatus.name}</span> successfully</span>
          <button onClick={() => setNodeAddStatus({ active: false, name: "" })} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={10} /></button>
        </div>
      )}

      {/* Instance list */}
      {allInstances.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {allInstances.map((inst) => {
            const isStopping = undeployingIds.has(inst.id);
            return (
              <div
                key={inst.id}
                className={`flex items-center gap-2 py-2 px-3 bg-purple-950/30 rounded-lg border border-purple-900/20 ${isStopping ? "opacity-50" : ""}`}
              >
                {inst.status === "deploying" || isStopping ? (
                  <Spinner size={12} className="animate-spin text-purple-400 shrink-0" />
                ) : inst.status === "error" ? (
                  <Warning size={12} weight="fill" className="text-red-400 shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                )}

                <span className="text-purple-100 text-xs truncate flex-1 font-medium">
                  {inst.name}
                  {isStopping && <span className="text-red-400 ml-1.5">Stopping...</span>}
                  {inst.status === "error" && inst.errorMessage && (
                    <span className="text-red-400 ml-1.5 font-normal">{inst.errorMessage}</span>
                  )}
                </span>

                {inst.virtualPort > 0 && (
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">:{inst.virtualPort}</span>
                )}

                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded shrink-0">
                  {inst.gpu}
                </span>

                {!isStopping && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${
                    inst.status === "deployed"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : inst.status === "deploying"
                        ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}>
                    {inst.status}
                  </span>
                )}

                {inst.status === "deployed" && (
                  <button
                    onClick={() => resyncMutation.mutate(inst.id)}
                    disabled={resyncMutation.isPending || isStopping || redeployMutation.isPending}
                    className="text-[10px] px-1.5 py-0.5 rounded text-purple-400 hover:text-purple-300 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 disabled:opacity-40 transition-colors shrink-0"
                    title="Re-scan local custom nodes & models, rebuild and redeploy"
                  >
                    {resyncMutation.isPending ? "Syncing..." : "Sync"}
                  </button>
                )}

                {(inst.status === "deployed" || inst.status === "error") && (
                  <button
                    onClick={() => setConfirmRedeployId(inst.id)}
                    disabled={isStopping || redeployMutation.isPending || resyncMutation.isPending}
                    className="text-[10px] px-1.5 py-0.5 rounded text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-40 transition-colors shrink-0 flex items-center gap-0.5"
                    title="Tear down and redeploy from scratch"
                  >
                    <ArrowsClockwise size={10} />
                    Redeploy
                  </button>
                )}

                <button
                  onClick={() => setConfirmUndeployId(inst.id)}
                  disabled={isStopping}
                  className="ml-1 text-zinc-600 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  title="Undeploy"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && allInstances.length === 0 && (
        <p className="text-xs text-zinc-600 mt-1">
          No cloud instances deployed. Deploy one to run ComfyUI on Modal.
        </p>
      )}

      {/* Deploy popup (kept as absolute — it's small and contextual) */}
      {showDeployPopup && (
        <div className="absolute right-5 top-12 z-50 w-72 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium font-tech">New Cloud Instance</p>
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Name</label>
            <input type="text" value={popupName} onChange={(e) => setPopupName(e.target.value)} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelClass}>GPU</label>
            <select value={popupGpu} onChange={(e) => handlePopupGpuChange(e.target.value)} className={inputClass}>
              {GPU_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {deployMutation.error && (
            <p className="text-red-400 text-xs">{(deployMutation.error as Error).message}</p>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowDeployPopup(false)} disabled={deployMutation.isPending} className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => deployMutation.mutate({ gpu: popupGpu, name: popupName })}
              disabled={deployMutation.isPending || !popupName.trim()}
              className="px-3 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {deployMutation.isPending ? "Deploying..." : "Deploy"}
            </button>
          </div>
        </div>
      )}

      {/* Undeploy confirmation popup */}
      {confirmUndeployId && (
        <div className="absolute right-5 top-12 z-50 w-72 bg-zinc-900 border border-red-500/20 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
          <p className="text-zinc-200 text-sm font-medium">Undeploy {confirmUndeployId}?</p>
          <p className="text-zinc-500 text-xs">This will stop and delete the Modal app. You can redeploy later.</p>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setConfirmUndeployId(null)} disabled={undeployMutation.isPending} className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => undeployMutation.mutate(confirmUndeployId)}
              disabled={undeployMutation.isPending}
              className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {undeployMutation.isPending ? "Stopping..." : "Undeploy"}
            </button>
          </div>
        </div>
      )}

      {/* Redeploy confirmation popup */}
      {confirmRedeployId && (() => {
        const inst = allInstances.find((i) => i.id === confirmRedeployId);
        if (!inst) return null;
        return (
          <div className="absolute right-5 top-12 z-50 w-72 bg-zinc-900 border border-amber-500/20 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
            <p className="text-zinc-200 text-sm font-medium">Redeploy {inst.name}?</p>
            <p className="text-zinc-500 text-xs">
              This will tear down the existing instance and deploy a fresh one with the same GPU ({inst.gpu}) and name.
            </p>
            {redeployMutation.error && (
              <p className="text-red-400 text-xs">{(redeployMutation.error as Error).message}</p>
            )}
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setConfirmRedeployId(null)} disabled={redeployMutation.isPending} className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => redeployMutation.mutate({ instanceId: inst.id, gpu: inst.gpu, name: inst.name })}
                disabled={redeployMutation.isPending}
                className="px-3 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {redeployMutation.isPending ? "Redeploying..." : "Redeploy"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Add Model Modal ─────────────────────────────────────────────── */}
      <Modal isOpen={showAddModel} onClose={() => setShowAddModel(false)} title="Add Model to Cloud">
        <div className="flex flex-col gap-4">
          <p className="text-zinc-500 text-xs -mt-2">
            Download a model from HuggingFace or CivitAI directly to the Modal volume.
          </p>

          <div className="flex flex-col gap-1">
            <label className={labelClass}>Model URL</label>
            <input
              type="text"
              value={modelUrl}
              onChange={(e) => handleModelUrlChange(e.target.value)}
              placeholder="https://huggingface.co/... or https://civitai.com/..."
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelClass}>Model Type</label>
            <select value={modelType} onChange={(e) => setModelType(e.target.value)} className={inputClass}>
              <option value="checkpoint">Checkpoint</option>
              <option value="lora">LoRA</option>
              <option value="vae">VAE</option>
              <option value="controlnet">ControlNet</option>
              <option value="upscaler">Upscaler</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelClass}>Filename</label>
            <input
              type="text"
              value={modelFilename}
              onChange={(e) => setModelFilename(e.target.value)}
              placeholder="model.safetensors"
              className={inputClass}
            />
          </div>

          {/* Conditional API key field based on detected URL source */}
          {modelUrlSource === "huggingface" && (
            <div className="flex flex-col gap-1">
              <label className={labelClass}>
                HuggingFace Token <span className="text-zinc-600">(optional — for gated models)</span>
              </label>
              <input
                type="password"
                value={modelApiKey}
                onChange={(e) => setModelApiKey(e.target.value)}
                placeholder="hf_..."
                className={inputClass}
              />
            </div>
          )}

          {modelUrlSource === "civitai" && (
            <div className="flex flex-col gap-1">
              <label className={labelClass}>
                CivitAI API Key <span className="text-zinc-600">(optional — for restricted models)</span>
              </label>
              <input
                type="password"
                value={modelApiKey}
                onChange={(e) => setModelApiKey(e.target.value)}
                placeholder="Your CivitAI API key"
                className={inputClass}
              />
            </div>
          )}

          <div className="flex items-center gap-2 justify-end pt-1">
            <button
              onClick={() => setShowAddModel(false)}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleDownloadModel(modelUrl, modelType, modelFilename, modelApiKey || undefined)}
              disabled={!modelUrl.trim() || !modelFilename.trim()}
              className="px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Download
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add Custom Node Modal ───────────────────────────────────────── */}
      <Modal isOpen={showAddNode} onClose={() => setShowAddNode(false)} title="Add Custom Node">
        <div className="flex flex-col gap-4">
          <p className="text-zinc-500 text-xs -mt-2">
            Clone a custom node to your local ComfyUI and optionally sync it to a Modal instance.
          </p>

          <div className="flex flex-col gap-1">
            <label className={labelClass}>Git Repository URL</label>
            <input
              type="text"
              value={nodeRepoUrl}
              onChange={(e) => setNodeRepoUrl(e.target.value)}
              placeholder="https://github.com/user/ComfyUI-NodePack"
              className={inputClass}
            />
          </div>

          {instances.filter((i) => i.status === "deployed").length > 0 && (
            <div className="flex flex-col gap-1">
              <label className={labelClass}>Sync to Modal Instance</label>
              <select value={nodeTargetInstance} onChange={(e) => setNodeTargetInstance(e.target.value)} className={inputClass}>
                <option value="">Local only (no Modal sync)</option>
                {instances.filter((i) => i.status === "deployed").map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.gpu})</option>
                ))}
              </select>
              {nodeTargetInstance && (
                <p className="text-amber-400/80 text-[10px] mt-0.5">
                  This will trigger a redeploy of the selected instance.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 justify-end pt-1">
            <button
              onClick={() => setShowAddNode(false)}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleAddNode(nodeRepoUrl, nodeTargetInstance || undefined)}
              disabled={!nodeRepoUrl.trim()}
              className="px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {nodeTargetInstance ? "Add & Sync" : "Add Locally"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
