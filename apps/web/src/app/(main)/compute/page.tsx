// apps/web/src/app/(main)/compute/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Monitor,
  Cloud,
  MagnifyingGlass,
  CircleNotch,
} from "phosphor-react";
import { PageTransition } from "@/components/ui";
import { ModalComputeCard } from "@/components/compute/ModalComputeCard";
import { ModalDeploymentsSection } from "@/components/compute/ModalDeploymentsSection";
import { ModalComfySection } from "@/components/ModalComfySection";
import { useModalStatus } from "@/hooks/useModalStatus";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GpuInfo {
  index: number;
  name: string;
  vramMB: number;
  backend: "cuda" | "rocm";
}

interface CpuInfo {
  model: string;
  cores: number;
  threads: number;
  ramGB: number;
}

interface GpuUtilization {
  index: number;
  vramUsedMB: number;
  vramTotalMB: number;
  gpuUtil: number;
}

interface ComfyManageResponse {
  instances: Array<{
    id: string;
    status: "running" | "starting" | "stopped";
    pid?: number;
    port: number;
    device: string;
    label: string;
  }>;
  managedPath: string | null;
  installType: string | null;
  isSetup: boolean;
}

interface ComputeStats {
  localJobs: number;
  cloudJobs: number;
  totalJobs: number;
  cloudCost: number | null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ComputePage() {
  const queryClient = useQueryClient();
  const cloudRef = useRef<HTMLDivElement>(null);

  // ── GPU availability toggle (localStorage) ──
  const [gpuAvailability, setGpuAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem("flowscale-gpu-availability");
      if (stored) setGpuAvailability(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const toggleGpuAvailability = (key: string) => {
    setGpuAvailability((prev) => {
      const next = { ...prev, [key]: prev[key] === false ? true : false };
      localStorage.setItem("flowscale-gpu-availability", JSON.stringify(next));
      return next;
    });
  };

  const isGpuAvailable = (key: string) => gpuAvailability[key] !== false;

  // ── Queries ──
  const { data: gpuData } = useQuery<{ gpus: GpuInfo[]; cpu: CpuInfo }>({
    queryKey: ["gpu-detect"],
    queryFn: async () => {
      const res = await fetch("/api/gpu");
      if (!res.ok) return { gpus: [] };
      return res.json();
    },
  });

  const { data: gpuUtilization = [] } = useQuery<GpuUtilization[]>({
    queryKey: ["gpu-utilization"],
    queryFn: async () => {
      const res = await fetch("/api/gpu/utilization");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: comfyManage } = useQuery<ComfyManageResponse>({
    queryKey: ["comfy-manage"],
    queryFn: async () => {
      const res = await fetch("/api/comfy/manage");
      if (!res.ok) return { instances: [], managedPath: null, installType: null, isSetup: false };
      return res.json();
    },
  });

  const { data: computeStats } = useQuery<ComputeStats>({
    queryKey: ["compute-stats"],
    queryFn: async () => {
      const res = await fetch("/api/compute/stats");
      if (!res.ok) return { localJobs: 0, cloudJobs: 0, totalJobs: 0, cloudCost: null };
      return res.json();
    },
  });

  const { data: modalStatus } = useModalStatus();

  const detectedGpus = gpuData?.gpus ?? [];
  const cpuInfo = gpuData?.cpu;

  const detectGpusMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/gpu", { method: "POST" });
      if (!res.ok) throw new Error("Detection failed");
      const data = await res.json();
      if (comfyManage?.isSetup) {
        await fetch("/api/comfy/instances/detect", { method: "POST" });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gpu-detect"] });
      queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
      queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
    },
  });

  const handleAddCompute = () => {
    cloudRef.current?.scrollIntoView({ behavior: "smooth" });
    // If Modal is not connected, the ModalComputeCard will be visible
    // showing the "Login with Modal" button — scrolling is sufficient
    // since the user needs to click the login button themselves
  };

  return (
    <PageTransition className="h-full overflow-y-auto bg-[var(--color-background)]">
      {/* ── Header ── */}
      <div className="px-8 pt-8 pb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-tech text-2xl font-semibold text-zinc-100">
            Compute
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage GPUs, devices, and cloud compute
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => detectGpusMutation.mutate()}
            disabled={detectGpusMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40"
          >
            {detectGpusMutation.isPending ? (
              <CircleNotch size={13} className="animate-spin" />
            ) : (
              <MagnifyingGlass size={13} />
            )}
            Detect GPUs
          </button>
          <button
            onClick={handleAddCompute}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-900 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors"
          >
            + Add compute
          </button>
        </div>
      </div>

      {/* ── Cost Summary Strip ── */}
      <div className="px-8 py-3 bg-zinc-900/50 border-y border-white/5 flex items-center gap-6 flex-wrap text-xs">
        <span className="text-zinc-500">This month:</span>
        {computeStats && computeStats.totalJobs > 0 ? (
          <>
            <span>
              <span className="font-medium text-emerald-400">
                {computeStats.localJobs.toLocaleString()} jobs
              </span>
              <span className="text-zinc-600"> on local · </span>
              <span className="text-emerald-400">Free</span>
            </span>
            {(modalStatus?.authenticated || computeStats.cloudJobs > 0) && (
              <span>
                <span className="font-medium text-blue-400">
                  {computeStats.cloudJobs.toLocaleString()} jobs
                </span>
                <span className="text-zinc-600"> on cloud · </span>
                <span className="text-amber-400">
                  {computeStats.cloudCost != null
                    ? `₹${computeStats.cloudCost.toLocaleString()}`
                    : "--"}
                </span>
              </span>
            )}
            <span className="ml-auto text-zinc-600">
              Total: {computeStats.totalJobs.toLocaleString()} jobs
            </span>
          </>
        ) : (
          <span className="text-zinc-600">No jobs yet</span>
        )}
      </div>

      {/* ── Fleet ── */}
      <div className="px-8 py-6 max-w-4xl space-y-8">

        {/* DEVICES */}
        <section>
          <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Devices
          </h3>
          <div className="space-y-3">
            {detectedGpus.map((gpu) => {
              const key = `${gpu.backend}:${gpu.index}`;
              const available = isGpuAvailable(key);
              const util = gpuUtilization.find((u) => u.index === gpu.index);
              const vramPct =
                util && util.vramTotalMB > 0
                  ? Math.round((util.vramUsedMB / util.vramTotalMB) * 100)
                  : 0;

              return (
                <div
                  key={gpu.index}
                  className={[
                    "relative rounded-xl border bg-[var(--color-background-panel)] p-4 pl-6 transition-opacity",
                    "border-white/10 hover:border-white/20",
                    available ? "" : "opacity-40",
                  ].join(" ")}
                >
                  {/* Left accent */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-emerald-500" />

                  <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-zinc-200">
                        {gpu.name}
                      </span>
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        {available ? "Available" : "Disabled"}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-600">{key}</span>
                  </div>

                  <div className="flex items-center gap-6 flex-wrap">
                    {/* VRAM */}
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1">
                        VRAM
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              vramPct > 90
                                ? "bg-red-500/70"
                                : vramPct > 70
                                  ? "bg-amber-500/60"
                                  : "bg-emerald-500/60"
                            }`}
                            style={{ width: `${util ? vramPct : 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono text-zinc-500">
                          {util
                            ? `${(util.vramUsedMB / 1024).toFixed(1)} / ${(util.vramTotalMB / 1024).toFixed(0)} GB`
                            : `${gpu.vramMB >= 1024 ? `${(gpu.vramMB / 1024).toFixed(1)} GB` : `${gpu.vramMB} MB`}`}
                        </span>
                      </div>
                    </div>

                    {/* Utilization */}
                    {util && (
                      <div>
                        <label className="text-[10px] text-zinc-500 block mb-1">
                          GPU
                        </label>
                        <span className="text-[11px] font-mono text-zinc-500">
                          {util.gpuUtil}%
                        </span>
                      </div>
                    )}

                    {/* Toggle */}
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-1">
                        Available
                      </label>
                      <button
                        onClick={() => toggleGpuAvailability(key)}
                        className={[
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                          available ? "bg-emerald-500" : "bg-zinc-700",
                        ].join(" ")}
                        title={
                          available
                            ? "Available for jobs — click to disable"
                            : "Disabled for jobs — click to enable"
                        }
                      >
                        <span
                          className={[
                            "inline-block size-3.5 rounded-full bg-white transition-transform",
                            available ? "translate-x-4.5" : "translate-x-0.5",
                          ].join(" ")}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* CPU card */}
            {cpuInfo && (
              <div
                className={[
                  "relative rounded-xl border bg-[var(--color-background-panel)] p-4 pl-6 transition-opacity",
                  "border-white/10 hover:border-white/20",
                  isGpuAvailable("cpu") ? "" : "opacity-40",
                ].join(" ")}
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-zinc-600" />
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <Cpu size={14} className="text-zinc-500" />
                    <span className="text-sm font-semibold text-zinc-300">
                      {cpuInfo.model}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-600">
                      {cpuInfo.cores}C/{cpuInfo.threads}T · {cpuInfo.ramGB} GB RAM
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-600">
                      {isGpuAvailable("cpu") ? "Available" : "Disabled"}
                    </span>
                    <button
                      onClick={() => toggleGpuAvailability("cpu")}
                      className={[
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                        isGpuAvailable("cpu") ? "bg-emerald-500" : "bg-zinc-700",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "inline-block size-3.5 rounded-full bg-white transition-transform",
                          isGpuAvailable("cpu") ? "translate-x-4.5" : "translate-x-0.5",
                        ].join(" ")}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {detectedGpus.length === 0 && !cpuInfo && (
              <p className="text-sm text-zinc-600 py-4">
                No devices detected.{" "}
                <button
                  onClick={() => detectGpusMutation.mutate()}
                  className="text-emerald-400 hover:underline"
                >
                  Run detection
                </button>
              </p>
            )}
          </div>
        </section>

        {/* CLOUD */}
        <section ref={cloudRef}>
          <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Cloud
          </h3>
          <div className="space-y-3">
            <div className="relative rounded-xl border border-white/10 bg-[var(--color-background-panel)] overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />
              <div className="pl-6 pr-4 py-4">
                <ModalComputeCard />
              </div>
            </div>

            <ModalDeploymentsSection />

            {modalStatus?.authenticated && (
              <ModalComfySection />
            )}
          </div>
        </section>

        {/* PLACEHOLDERS */}
        <section>
          <div className="space-y-3">
            <div className="p-5 rounded-xl border border-dashed border-white/10 bg-[var(--color-background-panel)]/30 opacity-50">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg border border-white/10 bg-zinc-800/50 flex items-center justify-center shrink-0">
                  <Monitor size={18} className="text-zinc-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-400">
                      Connect another machine
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 bg-zinc-800 rounded-full border border-zinc-700">
                      V2
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Add remote machines to your compute pool
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl border border-dashed border-white/10 bg-[var(--color-background-panel)]/30 opacity-50">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg border border-white/10 bg-zinc-800/50 flex items-center justify-center shrink-0">
                  <Cloud size={18} className="text-zinc-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-400">
                      Multi-cloud
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 bg-zinc-800 rounded-full border border-zinc-700">
                      V2
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Deploy to AWS, RunPod, and more
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PageTransition>
  );
}
