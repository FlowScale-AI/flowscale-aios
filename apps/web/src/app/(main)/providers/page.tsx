"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeSlash,
  Trash,
  ArrowSquareOut,
  ArrowCounterClockwise,
  CheckCircle,
  XCircle,
  CircleNotch,
  ArrowRight,
  FolderOpen,
  Play,
  Stop,
  Cpu,
  Lightning,
  MagnifyingGlass,
} from "phosphor-react";
import { PageTransition } from "@/components/ui";

interface ProviderStatus {
  name: string;
  label: string;
  configured: boolean;
  maskedKey?: string;
  docsUrl: string;
}

interface ComfyInstance {
  port: number;
  systemStats: Record<string, unknown> | null;
  instanceId?: string;
  device?: string;
  label?: string;
}

interface ComfyManagedInstance {
  id: string;
  status: "running" | "starting" | "stopped";
  pid?: number;
  port: number;
  device: string;
  label: string;
}

interface ComfyManageResponse {
  instances: ComfyManagedInstance[];
  managedPath: string | null;
  installType: string | null;
  isSetup: boolean;
}

const PROVIDER_ICONS: Record<string, string> = {
  fal: "https://fal.ai/favicon.ico",
  replicate: "https://cdn.simpleicons.org/replicate/white",
  openrouter: "https://openrouter.ai/favicon.ico",
  huggingface:
    "https://huggingface.co/front/assets/huggingface_logo-noborder.svg",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  fal: "Run generative AI models on fal.ai serverless infrastructure with fast cold starts.",
  replicate:
    "Run open-source models in the cloud via Replicate with a single API call.",
  openrouter:
    "Access hundreds of LLMs through a single API — route to the best model for your needs.",
  huggingface:
    "Access the HuggingFace Inference API to run models from the Hub.",
};

function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const queryClient = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<
    "idle" | "testing" | "ok" | "error"
  >("idle");

  const saveMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch(`/api/providers/${provider.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error("Failed to save key");
    },
    onSuccess: () => {
      setKeyInput("");
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/providers/${provider.name}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove key");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  async function testConnection() {
    setTestState("testing");
    try {
      const res = await fetch(`/api/providers/${provider.name}/proxy/models`, {
        signal: AbortSignal.timeout(5000),
      });
      setTestState(res.ok ? "ok" : "error");
    } catch {
      setTestState("error");
    }
    setTimeout(() => setTestState("idle"), 3000);
  }

  return (
    <div
      className={[
        "p-5 rounded-xl border transition-colors",
        provider.configured
          ? "border-white/10 bg-[var(--color-background-panel)]"
          : "border-white/5 bg-[var(--color-background-panel)]/50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg border border-white/10 bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
            {PROVIDER_ICONS[provider.name] ? (
              <img
                src={PROVIDER_ICONS[provider.name]}
                alt={provider.label}
                className="size-5 object-contain"
              />
            ) : (
              <span className="text-xs font-bold text-zinc-400">
                {provider.label[0]}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-200">
                {provider.label}
              </span>
              {provider.configured ? (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                  Configured
                </span>
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 bg-zinc-800 rounded-full">
                  Not configured
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {PROVIDER_DESCRIPTIONS[provider.name]}
            </p>
          </div>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0 mt-0.5"
          title="Docs"
        >
          <ArrowSquareOut size={14} />
        </a>
      </div>

      {/* Key input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? "text" : "password"}
            placeholder={
              provider.configured ? "••••••••••••••••" : "Paste API key…"
            }
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="w-full px-3 py-2 pr-9 text-xs font-mono-custom bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {showKey ? <EyeSlash size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button
          disabled={!keyInput.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate(keyInput.trim())}
          className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>

      {/* Actions when configured */}
      {provider.configured && (
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={testConnection}
            disabled={testState === "testing"}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            {testState === "testing" && (
              <CircleNotch size={12} className="animate-spin" />
            )}
            {testState === "ok" && (
              <CheckCircle size={12} className="text-emerald-400" />
            )}
            {testState === "error" && (
              <XCircle size={12} className="text-red-400" />
            )}
            {testState === "idle" && null}
            {testState === "idle"
              ? "Test Connection"
              : testState === "testing"
                ? "Testing…"
                : testState === "ok"
                  ? "Connected"
                  : "Failed"}
          </button>
          <span className="text-zinc-800">·</span>
          <button
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            className="flex items-center gap-1 text-xs text-zinc-600 hover:text-red-400 transition-colors"
          >
            <Trash size={11} />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function InstanceStatusBadge({ status }: { status: string }) {
  if (status === "starting") {
    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 bg-amber-400/10 rounded-full border border-amber-400/20">
        <CircleNotch size={9} className="animate-spin" />
        Starting
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Running
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 bg-zinc-800 rounded-full">
      Stopped
    </span>
  );
}

export default function ProvidersPage() {
  const queryClient = useQueryClient();
  const [pathInput, setPathInput] = useState("");
  const [pathSaved, setPathSaved] = useState(false);

  const { data: providers = [], isLoading } = useQuery<ProviderStatus[]>({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: comfyManage, refetch: refetchManage } =
    useQuery<ComfyManageResponse>({
      queryKey: ["comfy-manage"],
      queryFn: async () => {
        const res = await fetch("/api/comfy/manage");
        if (!res.ok)
          return { instances: [], managedPath: null, installType: null, isSetup: false };
        return res.json();
      },
      refetchInterval: (q) => {
        const data = q.state.data;
        if (!data) return false;
        // Poll while any instance is starting
        const anyStarting = data.instances?.some(
          (i: ComfyManagedInstance) => i.status === "starting"
        );
        return anyStarting ? 2000 : false;
      },
    });

  const managedInstances = comfyManage?.instances ?? [];
  const anyRunning = managedInstances.some((i) => i.status === "running");
  const anyStopped = managedInstances.some((i) => i.status === "stopped");
  const anyStarting = managedInstances.some((i) => i.status === "starting");

  const comfyActionMutation = useMutation({
    mutationFn: async ({
      action,
      instanceId,
    }: {
      action: "start" | "stop" | "restart";
      instanceId?: string;
    }) => {
      const res = await fetch("/api/comfy/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, instanceId }),
      });
      if (!res.ok) throw new Error("Action failed");
      return res.json();
    },
    onSuccess: () => {
      refetchManage();
      queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
    },
  });

  const detectGpusMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/comfy/instances/detect", { method: "POST" });
      if (!res.ok) throw new Error("Detection failed");
      return res.json();
    },
    onSuccess: () => {
      refetchManage();
      queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
    },
  });

  const { data: comfyPathData } = useQuery<{ comfyuiPath: string | null }>({
    queryKey: ["comfyui-path"],
    queryFn: async () => {
      const res = await fetch("/api/settings/comfyui-path");
      if (!res.ok) return { comfyuiPath: null };
      return res.json();
    },
  });

  const savePathMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await fetch("/api/settings/comfyui-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comfyuiPath: p }),
      });
      if (!res.ok) throw new Error("Failed to save path");
    },
    onSuccess: () => {
      setPathInput("");
      setPathSaved(true);
      queryClient.invalidateQueries({ queryKey: ["comfyui-path"] });
      setTimeout(() => setPathSaved(false), 2500);
    },
  });

  const savedPath = comfyPathData?.comfyuiPath;

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-white/5 shrink-0">
        <h1 className="font-tech text-xl font-semibold text-zinc-100">
          Providers
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Configure your AI inference sources
        </p>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Local Inference */}
          <section>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
              Local Inference
            </h2>
            <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)]">
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg border border-white/10 bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                    <img
                      src="/comfyui-logo.png"
                      alt="ComfyUI"
                      className="size-5 object-contain"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-200">
                        ComfyUI
                      </span>
                      {managedInstances.length > 0 && (
                        <span className="text-[10px] font-mono text-zinc-600">
                          {managedInstances.length} instance{managedInstances.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {!comfyManage?.isSetup && (
                      <p className="text-xs text-zinc-600 mt-0.5">
                        Setup required
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Detect GPUs */}
                  {comfyManage?.isSetup && (
                    <button
                      onClick={() => detectGpusMutation.mutate()}
                      disabled={detectGpusMutation.isPending}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px] font-medium rounded-lg transition-colors"
                      title="Detect available GPUs and create instances"
                    >
                      {detectGpusMutation.isPending ? (
                        <CircleNotch size={10} className="animate-spin" />
                      ) : (
                        <MagnifyingGlass size={10} />
                      )}
                      Detect GPUs
                    </button>
                  )}
                  {/* Bulk controls */}
                  {comfyManage?.isSetup && managedInstances.length > 0 && (
                    <>
                      {anyStopped && (
                        <button
                          onClick={() =>
                            comfyActionMutation.mutate({ action: "start" })
                          }
                          disabled={comfyActionMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-medium rounded-lg transition-colors"
                          title="Start all instances"
                        >
                          <Play size={10} weight="fill" />
                          Start All
                        </button>
                      )}
                      {(anyRunning || anyStarting) && (
                        <button
                          onClick={() =>
                            comfyActionMutation.mutate({ action: "stop" })
                          }
                          disabled={comfyActionMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/50 hover:bg-red-800/60 disabled:opacity-40 text-red-300 text-[11px] font-medium rounded-lg transition-colors"
                          title="Stop all instances"
                        >
                          <Stop size={10} weight="fill" />
                          Stop All
                        </button>
                      )}
                    </>
                  )}
                  <Link
                    href="/integrations/comfyui"
                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    View details
                    <ArrowRight size={12} />
                  </Link>
                </div>
              </div>

              {/* Instance list */}
              {managedInstances.length > 0 && (
                <div className="space-y-2 mb-4">
                  {managedInstances.map((inst) => (
                    <div
                      key={inst.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-900/50 border border-white/5"
                    >
                      <div className="flex items-center gap-2.5">
                        {inst.device === "cpu" ? (
                          <Cpu size={14} className="text-zinc-500" />
                        ) : (
                          <Lightning size={14} className="text-zinc-500" />
                        )}
                        <span className="text-xs font-medium text-zinc-300">
                          {inst.label}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-600">
                          :{inst.port}
                        </span>
                        <InstanceStatusBadge status={inst.status} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {inst.status === "stopped" && (
                          <button
                            onClick={() =>
                              comfyActionMutation.mutate({
                                action: "start",
                                instanceId: inst.id,
                              })
                            }
                            disabled={comfyActionMutation.isPending}
                            className="p-1 text-zinc-600 hover:text-emerald-400 transition-colors disabled:opacity-40"
                            title={`Start ${inst.label}`}
                          >
                            <Play size={12} weight="fill" />
                          </button>
                        )}
                        {(inst.status === "running" ||
                          inst.status === "starting") && (
                          <>
                            <button
                              onClick={() =>
                                comfyActionMutation.mutate({
                                  action: "restart",
                                  instanceId: inst.id,
                                })
                              }
                              disabled={
                                comfyActionMutation.isPending ||
                                inst.status === "starting"
                              }
                              className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-40"
                              title={`Restart ${inst.label}`}
                            >
                              <ArrowCounterClockwise size={12} />
                            </button>
                            <button
                              onClick={() =>
                                comfyActionMutation.mutate({
                                  action: "stop",
                                  instanceId: inst.id,
                                })
                              }
                              disabled={comfyActionMutation.isPending}
                              className="p-1 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"
                              title={`Stop ${inst.label}`}
                            >
                              <Stop size={12} weight="fill" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ComfyUI installation path */}
              <div className="border-t border-white/5 pt-4">
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                  Installation path
                </label>
                {savedPath && (
                  <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
                    <CheckCircle size={11} weight="fill" />
                    {savedPath}
                  </p>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderOpen
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
                    />
                    <input
                      type="text"
                      value={pathInput}
                      onChange={(e) => setPathInput(e.target.value)}
                      placeholder={savedPath ?? "/path/to/ComfyUI"}
                      className="w-full pl-8 pr-3 py-2 text-xs font-mono-custom bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                  </div>
                  <button
                    disabled={!pathInput.trim() || savePathMutation.isPending}
                    onClick={() => savePathMutation.mutate(pathInput.trim())}
                    className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pathSaved ? "Saved ✓" : "Save"}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-600 mt-1.5">
                  The root directory of your ComfyUI install. Models will be
                  downloaded into{" "}
                  <span className="font-mono-custom">models/</span>{" "}
                  subdirectories.
                </p>
              </div>
            </div>
          </section>

          {/* Cloud Providers */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                Cloud Providers
              </h2>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 bg-amber-400/10 rounded-full border border-amber-400/20">
                Comming Soon
              </span>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-zinc-600 justify-center">
                <CircleNotch size={16} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div
                className="flex flex-col gap-3 opacity-50 pointer-events-none select-none"
                aria-disabled="true"
              >
                {providers.map((provider) => (
                  <ProviderCard key={provider.name} provider={provider} />
                ))}
              </div>
            )}

            <p className="text-xs text-zinc-600 mt-2">
              API keys are stored locally in{" "}
              <span className="font-mono-custom">
                ~/.flowscale/aios/provider-keys.json
              </span>{" "}
              and never sent to FlowScale servers.
            </p>
          </section>
        </div>
      </div>
    </PageTransition>
  );
}
