"use client";

import { Suspense, useState, useEffect, useCallback, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HardDrive,
  Globe,
  ArrowSquareOut,
  Copy,
  Check,
  X,
  UserCircle,
  CheckCircle,
  XCircle,
  Trash,
  UserPlus,
  PencilSimple,
  Key,
  ArrowsClockwise,
  DownloadSimple,
  ArrowCircleUp,
  Eye,
  EyeSlash,
  ArrowCounterClockwise,
  CircleNotch,
  ArrowRight,
  FolderOpen,
  Play,
  Stop,
  Cpu,
  Lightning,
  MagnifyingGlass,
  Warning,
  CloudArrowUp,
  GearSix,
  UsersThree,
  Database,
  Plugs,
  Monitor,
  Cloud,
} from "phosphor-react";
import { PageTransition, Modal } from "@/components/ui";
import { useUpdateStore } from "@/store/updateStore";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserMe {
  id: string;
  username: string;
  role: string;
}

interface NetworkData {
  port: number;
  addresses: string[];
}

type UserRow = {
  id: string;
  username: string;
  role: string;
  status: string;
  createdAt: number;
  approvedAt: number | null;
  approvedBy: string | null;
};

interface ProviderStatus {
  name: string;
  label: string;
  configured: boolean;
  maskedKey?: string;
  docsUrl: string;
}

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

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLES = ["admin", "dev", "artist"];
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  dev: "Dev",
  artist: "Artist",
};
const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  disabled: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

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

type Tab = "compute" | "providers" | "comfyui" | "storage" | "users" | "general";

const TAB_CONFIG: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: "compute", label: "Compute", icon: Lightning },
  { id: "providers", label: "Providers", icon: Plugs },
  { id: "comfyui", label: "ComfyUI", icon: GearSix },
  { id: "storage", label: "Storage", icon: Database },
  { id: "users", label: "Users", icon: UsersThree },
  { id: "general", label: "General", icon: Globe },
];

function formatDate(ms: number | null) {
  if (!ms) return "\u2014";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// ─── Main page (with Suspense boundary for useSearchParams) ──────────────────

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get("tab");
  const tab: Tab = TAB_CONFIG.some((t) => t.id === rawTab)
    ? (rawTab as Tab)
    : "compute";

  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(!!window.desktop?.updates);
  }, []);

  // ── Error toast (used by ComfyUI tab) ────────────────────────────────────
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const showError = useCallback((msg: string) => {
    setErrorToast(msg);
  }, []);
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 8000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const { data: me } = useQuery<UserMe>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
  });

  function setTab(t: Tab) {
    router.push(`/settings?tab=${t}`, { scroll: false });
  }

  return (
    <>
      <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
          <div>
            <h1 className="font-tech text-xl font-semibold text-zinc-100">
              Settings
            </h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Configure compute, providers, and app settings
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-8 pt-4 shrink-0">
          {TAB_CONFIG.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  tab === t.id
                    ? "bg-white/10 text-white"
                    : "text-zinc-500 hover:text-zinc-300",
                ].join(" ")}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "compute" && <ComputeTab />}
          {tab === "providers" && <ProvidersTab />}
          {tab === "comfyui" && <ComfyUITab showError={showError} />}
          {tab === "storage" && <StorageTab />}
          {tab === "users" && (
            <UsersPanel
              currentUserId={me?.id ?? null}
              currentUserRole={me?.role ?? null}
            />
          )}
          {tab === "general" && <GeneralTab isDesktop={isDesktop} />}
        </div>
      </PageTransition>

      {/* Error toast */}
      {errorToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md animate-in slide-in-from-bottom-2 duration-200">
          <div className="bg-red-950/90 border border-red-500/30 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-sm flex items-start gap-3">
            <Warning
              size={18}
              weight="fill"
              className="text-red-400 shrink-0 mt-0.5"
            />
            <div className="flex-1 text-sm text-red-200">{errorToast}</div>
            <button
              onClick={() => setErrorToast(null)}
              className="text-red-400 hover:text-red-200 shrink-0 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Compute Tab ─────────────────────────────────────────────────────────────

interface GpuUtilization {
  index: number;
  vramUsedMB: number;
  vramTotalMB: number;
  gpuUtil: number;
}

function ModalComputeCard() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "installing" | "authenticating" | "connected" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: modalStatus } = useQuery<{
    installed: boolean;
    authenticated: boolean;
    workspace?: string;
    authInProgress?: boolean;
  }>({
    queryKey: ["modal-status"],
    queryFn: async () => {
      const res = await fetch("/api/modal/status");
      if (!res.ok) return { installed: false, authenticated: false };
      return res.json();
    },
    refetchInterval: phase === "authenticating" ? 3000 : false,
    staleTime: 10_000,
  });

  // Auto-detect connection on mount
  useEffect(() => {
    if (modalStatus?.authenticated && phase === "idle") {
      setPhase("connected");
    }
  }, [modalStatus?.authenticated, phase]);

  // Detect auth completion while polling
  useEffect(() => {
    if (modalStatus?.authenticated && phase === "authenticating") {
      setPhase("connected");
    }
  }, [modalStatus?.authenticated, phase]);

  const setupMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await fetch("/api/modal/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modal-status"] });
    },
  });

  async function handleLogin() {
    setErrorMsg(null);
    try {
      // Step 1: Install if needed
      if (!modalStatus?.installed) {
        setPhase("installing");
        const result = await setupMutation.mutateAsync("install");
        if (!result.success) {
          setPhase("error");
          setErrorMsg(result.error || "Failed to install Modal CLI");
          return;
        }
      }
      // Step 2: Authenticate
      setPhase("authenticating");
      await setupMutation.mutateAsync("authenticate");
      // Polling will detect when auth completes
    } catch (err: any) {
      setPhase("error");
      setErrorMsg(err.message || "Setup failed");
    }
  }

  async function handleDisconnect() {
    try {
      await setupMutation.mutateAsync("disconnect");
      setPhase("idle");
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }

  return (
    <section>
      <div className={`p-5 rounded-xl border transition-colors ${phase === "connected" ? "border-purple-500/20 bg-[var(--color-background-panel)]" : "border-white/5 bg-[var(--color-background-panel)]/50"}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg border border-purple-500/20 bg-purple-500/10 flex items-center justify-center overflow-hidden shrink-0">
              <Cloud size={18} className="text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-200">Modal.com</span>
                {phase === "connected" && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-600 mt-0.5">
                {phase === "connected"
                  ? `Workspace: ${modalStatus?.workspace ?? "default"}`
                  : "Cloud GPU compute on demand — A100, H100, and more."}
              </p>
            </div>
          </div>
        </div>

        {/* Disconnected / idle */}
        {(phase === "idle") && (
          <button
            onClick={handleLogin}
            disabled={setupMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-50"
          >
            <CloudArrowUp size={16} />
            Login with Modal
          </button>
        )}

        {/* Installing */}
        {phase === "installing" && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-white/5">
            <CircleNotch size={14} className="animate-spin text-purple-400" />
            <span className="text-sm text-zinc-300">Installing Modal CLI...</span>
          </div>
        )}

        {/* Authenticating */}
        {phase === "authenticating" && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-white/5">
            <CircleNotch size={14} className="animate-spin text-purple-400" />
            <span className="text-sm text-zinc-300">Waiting for browser authentication...</span>
          </div>
        )}

        {/* Connected */}
        {phase === "connected" && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDisconnect}
              disabled={setupMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <X size={12} />
              Disconnect
            </button>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/30 border border-red-500/20">
              <Warning size={14} className="text-red-400 shrink-0" />
              <span className="text-xs text-red-300">{errorMsg}</span>
            </div>
            <button
              onClick={() => { setPhase("idle"); setErrorMsg(null); }}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ArrowCounterClockwise size={12} />
              Retry
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ComputeTab() {
  const queryClient = useQueryClient();

  // Per-GPU "Available for jobs" toggle — UI-only, stored in localStorage
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

  const isGpuAvailable = (key: string) => gpuAvailability[key] !== false; // default true

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
      if (!res.ok)
        return {
          instances: [],
          managedPath: null,
          installType: null,
          isSetup: false,
        };
      return res.json();
    },
  });

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

  return (
    <div className="px-8 py-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* GPU Detection */}
        <section>
          <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg border border-white/10 bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                  <Lightning size={18} className="text-zinc-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-200">
                      Devices
                    </span>
                    {(detectedGpus.length > 0 || cpuInfo) && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                        {detectedGpus.length + (cpuInfo ? 1 : 0)} devices
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Available hardware for local inference tools
                  </p>
                </div>
              </div>
              <button
                onClick={() => detectGpusMutation.mutate()}
                disabled={detectGpusMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px] font-medium rounded-lg transition-colors"
                title="Detect available GPUs"
              >
                {detectGpusMutation.isPending ? (
                  <CircleNotch size={11} className="animate-spin" />
                ) : (
                  <MagnifyingGlass size={11} />
                )}
                Detect GPUs
              </button>
            </div>
            {(detectedGpus.length > 0 || cpuInfo) && (
              <div className="mt-3 space-y-1.5">
                {detectedGpus.map((gpu) => {
                  const key = `${gpu.backend}:${gpu.index}`;
                  const available = isGpuAvailable(key);
                  const util = gpuUtilization.find((u) => u.index === gpu.index);
                  const vramPct = util && util.vramTotalMB > 0
                    ? Math.round((util.vramUsedMB / util.vramTotalMB) * 100)
                    : 0;
                  return (
                    <div
                      key={gpu.index}
                      className={[
                        "py-2 px-3 rounded-lg bg-zinc-900/50 border border-white/5 transition-opacity",
                        available ? "" : "opacity-40",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <Lightning size={13} className="text-emerald-400/70" />
                          <span className="text-xs font-medium text-zinc-300">
                            {gpu.name}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-600">
                            {key}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {gpu.vramMB >= 1024
                              ? `${(gpu.vramMB / 1024).toFixed(1)} GB`
                              : `${gpu.vramMB} MB`}
                          </span>
                          <span className="text-[10px] text-zinc-600">{available ? "Available" : "Disabled"}</span>
                          <button
                            onClick={() => toggleGpuAvailability(key)}
                            className={[
                              "relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0",
                              available ? "bg-emerald-500" : "bg-zinc-700",
                            ].join(" ")}
                            title={available ? "Available for jobs — click to disable" : "Disabled for jobs — click to enable"}
                          >
                            <span
                              className={[
                                "inline-block size-3 rounded-full bg-white transition-transform",
                                available ? "translate-x-3.5" : "translate-x-0.5",
                              ].join(" ")}
                            />
                          </button>
                        </div>
                      </div>
                      {util && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${vramPct > 90 ? "bg-red-500/70" : vramPct > 70 ? "bg-amber-500/60" : "bg-emerald-500/60"}`}
                              style={{ width: `${vramPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-zinc-600">
                            {(util.vramUsedMB / 1024).toFixed(1)}/{(util.vramTotalMB / 1024).toFixed(0)} GB
                          </span>
                          <span className="text-[10px] font-mono text-zinc-600">
                            GPU {util.gpuUtil}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {cpuInfo && (
                  <div
                    className={[
                      "flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-900/50 border border-white/5 transition-opacity",
                      isGpuAvailable("cpu") ? "" : "opacity-40",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2.5">
                      <Cpu size={13} className="text-zinc-500" />
                      <span className="text-xs font-medium text-zinc-300">
                        {cpuInfo.model}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-600">
                        {cpuInfo.cores}C/{cpuInfo.threads}T
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-zinc-500">
                        {cpuInfo.ramGB} GB RAM
                      </span>
                      <span className="text-[10px] text-zinc-600">{isGpuAvailable("cpu") ? "Available" : "Disabled"}</span>
                      <button
                        onClick={() => toggleGpuAvailability("cpu")}
                        className={[
                          "relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0",
                          isGpuAvailable("cpu") ? "bg-emerald-500" : "bg-zinc-700",
                        ].join(" ")}
                        title={isGpuAvailable("cpu") ? "Available for jobs — click to disable" : "Disabled for jobs — click to enable"}
                      >
                        <span
                          className={[
                            "inline-block size-3 rounded-full bg-white transition-transform",
                            isGpuAvailable("cpu") ? "translate-x-3.5" : "translate-x-0.5",
                          ].join(" ")}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Modal.com */}
        <ModalComputeCard />

        {/* V2 placeholder: Connect another machine */}
        <section>
          <div className="p-5 rounded-xl border border-dashed border-white/10 bg-[var(--color-background-panel)]/30 opacity-50">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg border border-white/10 bg-zinc-800/50 flex items-center justify-center overflow-hidden shrink-0">
                <Monitor size={18} className="text-zinc-600" />
              </div>
              <div className="flex-1">
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
        </section>

        {/* V2 placeholder: Multi-cloud */}
        <section>
          <div className="p-5 rounded-xl border border-dashed border-white/10 bg-[var(--color-background-panel)]/30 opacity-50">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg border border-white/10 bg-zinc-800/50 flex items-center justify-center overflow-hidden shrink-0">
                <Cloud size={18} className="text-zinc-600" />
              </div>
              <div className="flex-1">
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
        </section>
      </div>
    </div>
  );
}

// ─── Providers Tab ───────────────────────────────────────────────────────────

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
              provider.configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "Paste API key\u2026"
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
                ? "Testing\u2026"
                : testState === "ok"
                  ? "Connected"
                  : "Failed"}
          </button>
          <span className="text-zinc-800">\u00B7</span>
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

function ProvidersTab() {
  const { data: providers = [], isLoading } = useQuery<ProviderStatus[]>({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="px-8 py-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
            Cloud Providers
          </h2>

          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-zinc-600 justify-center">
              <CircleNotch size={16} className="animate-spin" />
              <span className="text-sm">Loading\u2026</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
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
  );
}

// ─── ComfyUI Tab ─────────────────────────────────────────────────────────────

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

function ComfyUITab({ showError }: { showError: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const [pathInput, setPathInput] = useState("");
  const [pathSaved, setPathSaved] = useState(false);

  const { data: comfyManage, refetch: refetchManage } =
    useQuery<ComfyManageResponse>({
      queryKey: ["comfy-manage"],
      queryFn: async () => {
        const res = await fetch("/api/comfy/manage");
        if (!res.ok)
          return {
            instances: [],
            managedPath: null,
            installType: null,
            isSetup: false,
          };
        return res.json();
      },
      refetchInterval: (q) => {
        const data = q.state.data;
        if (!data) return false;
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchManage();
      queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
    },
    onError: (err: Error) => {
      showError(err.message);
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
    <div className="px-8 py-6">
      <div className="max-w-2xl mx-auto">
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
                      {managedInstances.length} instance
                      {managedInstances.length !== 1 ? "s" : ""}
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
                {pathSaved ? "Saved \u2713" : "Save"}
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
      </div>
    </div>
  );
}

// ─── Storage Tab ─────────────────────────────────────────────────────────────

function StorageTab() {
  return (
    <div className="px-8 py-6">
      <div className="max-w-2xl mx-auto">
        <section>
          <div className="flex items-center gap-2 mb-4">
            <HardDrive size={16} className="text-zinc-400" />
            <h2 className="font-tech text-sm font-semibold text-zinc-200">
              Storage
            </h2>
          </div>
          <div className="flex flex-col gap-3 p-4 bg-zinc-900/50 border border-white/5 rounded-lg text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Database</span>
              <span className="text-zinc-300 font-mono-custom text-xs">
                ~/.flowscale/aios.db
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">App data</span>
              <span className="text-zinc-300 font-mono-custom text-xs">
                ~/.flowscale/app-data/
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">App bundles</span>
              <span className="text-zinc-300 font-mono-custom text-xs">
                ~/.flowscale/apps/
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Outputs</span>
              <span className="text-zinc-300 font-mono-custom text-xs">
                ~/.flowscale/aios-outputs/
              </span>
            </div>
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            All data stays on this machine. Nothing is sent to the cloud.
          </p>
        </section>
      </div>
    </div>
  );
}

// ─── General Tab ─────────────────────────────────────────────────────────────

const UPDATE_COMMAND =
  "curl -fsSL https://flowscale.ai/update_mac.sh | sudo bash";

function UpdatesSection() {
  const { status, version, progress, error, setChecking } = useUpdateStore();
  const [isMac, setIsMac] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  useEffect(() => {
    setIsMac(window.desktop?.platform === "darwin");
  }, []);

  function handleCopyCommand() {
    navigator.clipboard.writeText(UPDATE_COMMAND);
    setCmdCopied(true);
    setTimeout(() => setCmdCopied(false), 2000);
  }

  async function handleCheck() {
    setChecking();
    await window.desktop?.updates?.check();
  }

  async function handleDownload() {
    await window.desktop?.updates?.download();
  }

  async function handleInstall() {
    await window.desktop?.updates?.install();
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <ArrowsClockwise size={16} className="text-zinc-400" />
        <h2 className="font-tech text-sm font-semibold text-zinc-200">
          Updates
        </h2>
      </div>
      <div className="p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
        {status === "idle" && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">
              Check for the latest version.
            </span>
            <button
              onClick={handleCheck}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors"
            >
              <ArrowsClockwise size={13} /> Check for updates
            </button>
          </div>
        )}

        {status === "checking" && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <ArrowsClockwise size={14} className="animate-spin" /> Checking for
            updates\u2026
          </div>
        )}

        {status === "up-to-date" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle size={14} weight="fill" /> You&apos;re up to date.
            </div>
            <button
              onClick={handleCheck}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ArrowsClockwise size={13} /> Check again
            </button>
          </div>
        )}

        {status === "available" && isMac && (
          <div className="space-y-3">
            <div>
              <div className="text-sm text-zinc-200 font-medium">
                Update available \u2014 v{version}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Run this command in Terminal to update.
              </div>
            </div>
            <div className="flex items-center gap-2 bg-zinc-950 border border-white/10 rounded-md px-3 py-2">
              <code className="flex-1 text-xs font-mono text-emerald-400 select-all break-all">
                {UPDATE_COMMAND}
              </code>
              <button
                onClick={handleCopyCommand}
                className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                {cmdCopied ? (
                  <Check size={13} className="text-emerald-400" />
                ) : (
                  <Copy size={13} />
                )}
                {cmdCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {status === "available" && !isMac && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-200 font-medium">
                Update available \u2014 v{version}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Download and install when ready.
              </div>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-colors"
            >
              <DownloadSimple size={13} /> Download
            </button>
          </div>
        )}

        {status === "downloading" && !isMac && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Downloading v{version}\u2026</span>
              <span className="text-zinc-500 font-mono-custom text-xs">
                {progress}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {status === "downloaded" && !isMac && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-200 font-medium">
                v{version} ready to install
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                The app will restart to apply the update.
              </div>
            </div>
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors"
            >
              <ArrowCircleUp size={13} /> Restart &amp; install
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-red-400">Update check failed</div>
              <div className="text-xs text-zinc-600 mt-0.5 font-mono-custom">
                {error}
              </div>
            </div>
            <button
              onClick={handleCheck}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md transition-colors"
            >
              <ArrowsClockwise size={13} /> Retry
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function GeneralTab({ isDesktop }: { isDesktop: boolean }) {
  const queryClient = useQueryClient();

  const { data: network } = useQuery<NetworkData>({
    queryKey: ["network"],
    queryFn: async () => {
      const res = await fetch("/api/settings/network");
      if (!res.ok) throw new Error("Failed to fetch network info");
      return res.json();
    },
  });

  const { data: comfySetup } = useQuery<{ autoStartComfyUI: boolean }>({
    queryKey: ["comfyui-setup"],
    queryFn: async () => {
      const res = await fetch("/api/settings/comfyui-setup");
      if (!res.ok) return { autoStartComfyUI: false };
      return res.json();
    },
  });

  const autoStartMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/settings/comfyui-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoStartComfyUI: enabled }),
      });
      if (!res.ok) throw new Error("Failed to save setting");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comfyui-setup"] });
    },
  });

  const autoStartEnabled = comfySetup?.autoStartComfyUI ?? false;

  const [copied, setCopied] = useState<string | null>(null);

  const openInBrowser = (url: string) => {
    if (window.desktop?.shell?.openExternal) {
      window.desktop.shell.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="px-8 py-6">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Updates */}
        {isDesktop && <UpdatesSection />}

        {/* Auto-start ComfyUI */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <GearSix size={16} className="text-zinc-400" />
            <h2 className="font-tech text-sm font-semibold text-zinc-200">
              Startup
            </h2>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
            <div>
              <div className="text-sm text-zinc-300">Auto-start ComfyUI on launch</div>
              <p className="text-xs text-zinc-600 mt-0.5">
                Automatically start all ComfyUI instances when the app launches
              </p>
            </div>
            <button
              onClick={() => autoStartMutation.mutate(!autoStartEnabled)}
              disabled={autoStartMutation.isPending}
              className={[
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 disabled:opacity-50",
                autoStartEnabled ? "bg-emerald-500" : "bg-zinc-700",
              ].join(" ")}
              title={autoStartEnabled ? "Disable auto-start" : "Enable auto-start"}
            >
              <span
                className={[
                  "inline-block size-3.5 rounded-full bg-white transition-transform",
                  autoStartEnabled ? "translate-x-[18px]" : "translate-x-1",
                ].join(" ")}
              />
            </button>
          </div>
        </section>

        {/* Network Access */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Globe size={16} className="text-zinc-400" />
            <h2 className="font-tech text-sm font-semibold text-zinc-200">
              Network Access
            </h2>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-500 mb-1">Local</div>
                <span className="text-sm font-mono-custom text-zinc-300">
                  http://localhost:{network?.port ?? 14173}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button
                  onClick={() =>
                    copyUrl(`http://localhost:${network?.port ?? 14173}`)
                  }
                  className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                  title="Copy URL"
                >
                  {copied ===
                  `http://localhost:${network?.port ?? 14173}` ? (
                    <Check size={14} className="text-emerald-400" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
                <button
                  onClick={() =>
                    openInBrowser(
                      `http://localhost:${network?.port ?? 14173}`
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors"
                >
                  <ArrowSquareOut size={12} /> Open
                </button>
              </div>
            </div>
            {network?.addresses.map((ip) => {
              const url = `http://${ip}:${network.port}`;
              return (
                <div
                  key={ip}
                  className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-500 mb-1">Network</div>
                    <span className="text-sm font-mono-custom text-zinc-300">
                      {url}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button
                      onClick={() => copyUrl(url)}
                      className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                      title="Copy URL"
                    >
                      {copied === url ? (
                        <Check size={14} className="text-emerald-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => openInBrowser(url)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-md transition-colors"
                    >
                      <ArrowSquareOut size={12} /> Open
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            Use the network URL to open FlowScale AI OS from any device on the
            same network.
          </p>

          {/* App Port */}
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-lg mt-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-zinc-500 mb-1">App Port</div>
              <span className="text-sm font-mono-custom text-zinc-300">
                {network?.port ?? 14173}
              </span>
            </div>
            <span className="text-[10px] text-zinc-600 bg-zinc-800 px-2 py-1 rounded">
              Not configurable
            </span>
          </div>
        </section>

        {/* App info */}
        <section className="pt-4 border-t border-white/5">
          <div className="flex justify-between text-xs text-zinc-600">
            <span className="font-tech">FlowScale AI OS</span>
            <span className="font-mono-custom">
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.2.0"}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Users Panel ─────────────────────────────────────────────────────────────

function UsersPanel({
  currentUserId,
  currentUserRole,
}: {
  currentUserId: string | null;
  currentUserRole: string | null;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersTab, setUsersTab] = useState<"active" | "pending">("active");
  const [showAdd, setShowAdd] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveRole, setApproveRole] = useState("artist");
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserRow | null>(
    null
  );
  const isAdmin = currentUserRole === "admin";

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const pending = users.filter((u) => u.status === "pending");
  const active = users.filter((u) => u.status !== "pending");
  const userTabs: Array<"active" | "pending"> = isAdmin
    ? ["active", "pending"]
    : ["active"];

  async function approve(id: string, role: string) {
    if (!isAdmin) return;
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active", role }),
    });
    setApproveId(null);
    load();
  }

  async function reject(id: string) {
    if (!isAdmin) return;
    if (!confirm("Reject and delete this account request?")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    load();
  }

  async function changeRole(id: string, role: string) {
    if (!isAdmin) return;
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    load();
  }

  async function toggleDisable(user: UserRow) {
    if (!isAdmin) return;
    const newStatus = user.status === "active" ? "disabled" : "active";
    await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    load();
  }

  async function deleteUser(id: string) {
    if (!isAdmin) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    load();
  }

  async function confirmDeleteUser() {
    if (!isAdmin || !pendingDeleteUser) return;
    await deleteUser(pendingDeleteUser.id);
    setPendingDeleteUser(null);
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-8 py-3 shrink-0">
        <div className="flex gap-1">
          {userTabs.map((t) => (
            <button
              key={t}
              onClick={() => setUsersTab(t)}
              className={[
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                usersTab === t
                  ? "bg-white/10 text-white"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {t === "pending" ? "Pending Approval" : "All Users"}
              <span
                className={[
                  "text-xs px-1.5 py-0.5 rounded-full",
                  t === "pending"
                    ? pending.length > 0
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/5 text-zinc-600"
                    : "bg-white/5 text-zinc-400",
                ].join(" ")}
              >
                {t === "pending" ? pending.length : active.length}
              </span>
            </button>
          ))}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            <UserPlus size={16} /> Add User
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-8 py-2">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
            Loading\u2026
          </div>
        ) : usersTab === "pending" ? (
          pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CheckCircle
                size={32}
                weight="fill"
                className="text-emerald-500/30"
              />
              <p className="text-zinc-500 text-sm">No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-4 bg-[var(--color-background-panel)] border border-white/5 rounded-xl px-4 py-3"
                >
                  <UserCircle size={32} className="text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <span>{u.username}</span>
                      {u.id === currentUserId && (
                        <span className="text-[11px] font-semibold text-zinc-500">
                          (You)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">
                      Requested {ROLE_LABELS[u.role] ?? u.role} \u00B7{" "}
                      {formatDate(u.createdAt)}
                    </div>
                  </div>
                  {approveId === u.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={approveRole}
                        onChange={(e) => setApproveRole(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500/50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} className="bg-zinc-900">
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => approve(u.id, approveRole)}
                        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => setApproveId(null)}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setApproveId(u.id);
                          setApproveRole(u.role);
                        }}
                        className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-colors"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => reject(u.id)}
                        className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/20 transition-colors"
                      >
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-3">
            {active.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-4 bg-[var(--color-background-panel)] border border-white/5 rounded-xl px-4 py-3"
              >
                <UserCircle size={32} className="text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {u.username}
                    </span>
                    {u.id === currentUserId && (
                      <span className="text-[11px] font-semibold text-zinc-500">
                        (You)
                      </span>
                    )}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_BADGE[u.status] ?? ""}`}
                    >
                      {u.status}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Joined {formatDate(u.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {u.role === "admin" ? (
                    <span className="px-2 py-1.5 text-xs text-zinc-400 bg-white/5 border border-white/10 rounded-lg">
                      Admin
                    </span>
                  ) : !isAdmin ? (
                    <span className="px-2 py-1.5 text-xs text-zinc-400 bg-white/5 border border-white/10 rounded-lg">
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500/50 transition-colors"
                      title="Change role"
                    >
                      {ROLES.filter((r) => r !== "admin").map((r) => (
                        <option key={r} value={r} className="bg-zinc-900">
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  )}
                  {u.id === currentUserId && (
                    <button
                      onClick={() => setShowChangePassword(true)}
                      className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                      title="Change password"
                    >
                      <Key size={15} />
                    </button>
                  )}
                  {isAdmin && u.role !== "admin" && (
                    <>
                      <button
                        onClick={() => toggleDisable(u)}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                        title={
                          u.status === "active" ? "Disable user" : "Enable user"
                        }
                      >
                        <PencilSimple size={15} />
                      </button>
                      <button
                        onClick={() => setPendingDeleteUser(u)}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                        title="Delete user"
                      >
                        <Trash size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddUserModal onClose={() => setShowAdd(false)} onCreated={load} />
      )}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      <Modal
        isOpen={!!pendingDeleteUser}
        onClose={() => setPendingDeleteUser(null)}
        maxWidth="max-w-sm"
      >
        <div className="text-center">
          <div className="size-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <Trash size={20} className="text-red-400" />
          </div>
          <h3 className="text-base font-semibold text-zinc-100 mb-1">
            Delete user?
          </h3>
          <p className="text-sm text-zinc-500 mb-6">
            <span className="text-zinc-300 font-medium">
              {pendingDeleteUser?.username}
            </span>{" "}
            will be permanently removed. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setPendingDeleteUser(null)}
              className="flex-1 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteUser}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[var(--color-background-panel)] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">
            Change Password
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {success ? (
          <div className="flex items-center gap-2 text-emerald-400 text-sm py-4 justify-center">
            <CheckCircle size={18} weight="fill" /> Password updated
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                Current password
              </label>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                New password
              </label>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {loading ? "Saving\u2026" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AddUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("artist");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create user");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[var(--color-background-panel)] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Add User</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
            >
              {ROLES.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 py-2.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {loading ? "Creating\u2026" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
