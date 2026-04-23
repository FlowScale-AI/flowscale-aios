"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Lightning,
  Play,
  Stop,
  ArrowCounterClockwise,
  CircleNotch,
  X,
  FolderOpen,
  FileText,
  ArrowRight,
  CheckCircle,
  PencilSimple,
  Trash,
} from "phosphor-react";
import { Modal } from "@flowscale/ui";
import { useModalStatus } from "@/hooks/useModalStatus";
import { ModalComfySection } from "@/components/ModalComfySection";
import { getInstanceDisplayLabel } from "@/lib/instanceLabel";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ComfyDeviceInfo {
  name: string;
  type: string;
  index: number;
}

interface ComfyManagedInstance {
  id: string;
  status: "running" | "starting" | "stopped";
  pid?: number;
  /** Effective (runtime) port — may differ from `configuredPort` for custom-script launches. */
  port: number;
  /** Only present when a custom script bound to a different port than configured. */
  configuredPort?: number;
  device: string;
  label: string;
  gpuName?: string;
  customLabel?: string;
  launchScriptId?: string;
  /** Devices reported by ComfyUI's /system_stats — the *real* GPU in use. */
  devices?: ComfyDeviceInfo[];
}

interface ComfyManageResponse {
  instances: ComfyManagedInstance[];
  managedPath: string | null;
  installType: string | null;
  isSetup: boolean;
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
  const { data: modalStatus } = useModalStatus();

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
        const anyActive = data.instances?.some(
          (i: ComfyManagedInstance) => i.status === "starting" || i.status === "running",
        );
        return anyActive ? 5000 : false;
      },
    });

  const { data: comfyScan } = useQuery<Array<{ port: number; instanceId?: string; device?: string; label?: string; devices?: ComfyDeviceInfo[] }>>({
    queryKey: ["comfy-scan"],
    queryFn: async () => {
      const res = await fetch("/api/comfy/scan");
      return res.ok ? res.json() : [];
    },
    refetchInterval: 10_000,
  });

  const managedInstances = comfyManage?.instances ?? [];
  // A managed instance "owns" both its runtime port AND its configured port
  // (which may differ for custom-script launches). Excluding both from the
  // external list prevents the same ComfyUI from showing up twice.
  const managedPorts = new Set<number>();
  for (const i of managedInstances) {
    managedPorts.add(i.port);
    if (i.configuredPort != null) managedPorts.add(i.configuredPort);
  }
  const externalInstances: Array<ComfyManagedInstance & { external: true }> = (comfyScan ?? [])
    .filter((inst) => !managedPorts.has(inst.port))
    .map((inst) => ({
      id: inst.instanceId ?? `external-${inst.port}`,
      status: "running" as const,
      port: inst.port,
      device: inst.device ?? "external",
      label: inst.label ?? `ComfyUI :${inst.port}`,
      devices: inst.devices,
      external: true,
    }));
  const allInstances: Array<ComfyManagedInstance & { external?: boolean }> = [
    ...managedInstances,
    ...externalInstances,
  ];
  // Bulk actions only apply to managed instances — external ComfyUIs
  // (e.g. ComfyUI Desktop) aren't under our lifecycle control.
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

  // ── Editable instance label ─────────────────────────────────────────────────
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");

  const saveLabelMutation = useMutation({
    mutationFn: async ({ instanceId, customLabel }: { instanceId: string; customLabel: string }) => {
      const res = await fetch("/api/settings/comfy-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instances: [{ id: instanceId, customLabel: customLabel || null }] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to save label");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
      setEditingLabelId(null);
    },
    onError: (err: Error) => { showError(err.message); },
  });

  const startEditLabel = (inst: ComfyManagedInstance) => {
    setEditingLabelId(inst.id);
    setLabelInput(inst.customLabel ?? "");
  };

  const commitLabel = (instanceId: string) => {
    saveLabelMutation.mutate({ instanceId, customLabel: labelInput });
  };

  // ── Delete managed instance ─────────────────────────────────────────────────
  const deleteInstanceMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      const res = await fetch(`/api/comfy/instances/${encodeURIComponent(instanceId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Delete failed");
      }
    },
    onSuccess: () => {
      refetchManage();
      queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
    },
    onError: (err: Error) => { showError(err.message); },
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

  // ── Python executable path (for venvs outside the ComfyUI tree) ────────────
  const [pythonInput, setPythonInput] = useState("");
  const [pythonSaved, setPythonSaved] = useState(false);
  const { data: pythonPathData } = useQuery<{ pythonPath: string | null }>({
    queryKey: ["comfyui-python-path"],
    queryFn: async () => {
      const res = await fetch("/api/settings/comfyui-python-path");
      if (!res.ok) return { pythonPath: null };
      return res.json();
    },
  });
  const savePythonPathMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await fetch("/api/settings/comfyui-python-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pythonPath: p }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save Python path");
      }
    },
    onSuccess: () => {
      setPythonInput("");
      setPythonSaved(true);
      queryClient.invalidateQueries({ queryKey: ["comfyui-python-path"] });
      setTimeout(() => setPythonSaved(false), 2500);
    },
    onError: (err: Error) => { showError(err.message); },
  });
  const savedPythonPath = pythonPathData?.pythonPath;

  // ── Data directory (--base-directory) ──────────────────────────────────────
  const [baseDirInput, setBaseDirInput] = useState("");
  const [baseDirSaved, setBaseDirSaved] = useState(false);
  const { data: baseDirData } = useQuery<{ baseDirectory: string | null }>({
    queryKey: ["comfyui-base-directory"],
    queryFn: async () => {
      const res = await fetch("/api/settings/comfyui-base-directory");
      if (!res.ok) return { baseDirectory: null };
      return res.json();
    },
  });
  const saveBaseDirMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await fetch("/api/settings/comfyui-base-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseDirectory: p }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save data directory");
      }
    },
    onSuccess: () => {
      setBaseDirInput("");
      setBaseDirSaved(true);
      queryClient.invalidateQueries({ queryKey: ["comfyui-base-directory"] });
      setTimeout(() => setBaseDirSaved(false), 2500);
    },
    onError: (err: Error) => { showError(err.message); },
  });
  const savedBaseDir = baseDirData?.baseDirectory;

  // ── Extra ports to scan for external ComfyUI instances ─────────────────────
  const [portInput, setPortInput] = useState("");
  const { data: extraPortsData } = useQuery<{ ports: number[]; wellKnown: number[] }>({
    queryKey: ["extra-comfy-ports"],
    queryFn: async () => {
      const res = await fetch("/api/settings/extra-comfy-ports");
      if (!res.ok) return { ports: [], wellKnown: [] };
      return res.json();
    },
  });
  const extraPorts = extraPortsData?.ports ?? [];
  const wellKnownPorts = extraPortsData?.wellKnown ?? [];
  const allScannedPorts = [...new Set([...wellKnownPorts, ...extraPorts])].sort((a, b) => a - b);
  const saveExtraPortsMutation = useMutation({
    mutationFn: async (ports: number[]) => {
      const res = await fetch("/api/settings/extra-comfy-ports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ports }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save ports");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extra-comfy-ports"] });
      queryClient.invalidateQueries({ queryKey: ["comfy-scan"] });
    },
    onError: (err: Error) => { showError(err.message); },
  });
  const addPort = (): void => {
    const p = Number(portInput.trim());
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      showError("Port must be an integer between 1024 and 65535");
      return;
    }
    if (extraPorts.includes(p)) { setPortInput(""); return; }
    saveExtraPortsMutation.mutate([...extraPorts, p]);
    setPortInput("");
  };

  // ── Custom launch scripts ───────────────────────────────────────────────────
  const [scriptLabelInput, setScriptLabelInput] = useState("");
  const [scriptPathInput, setScriptPathInput] = useState("");

  const { data: customScriptsData } = useQuery<{ scripts: Array<{ id: string; label: string; path: string }> }>({
    queryKey: ["custom-scripts"],
    queryFn: async () => {
      const res = await fetch("/api/settings/custom-scripts");
      if (!res.ok) return { scripts: [] };
      return res.json();
    },
  });
  const customScripts = customScriptsData?.scripts ?? [];

  const saveCustomScriptsMutation = useMutation({
    mutationFn: async (scripts: Array<{ id: string; label: string; path: string }>) => {
      const res = await fetch("/api/settings/custom-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripts }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to save scripts");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-scripts"] });
    },
    onError: (err: Error) => { showError(err.message); },
  });

  const addScript = (): void => {
    const label = scriptLabelInput.trim();
    const scriptPath = scriptPathInput.trim();
    if (!label || !scriptPath) {
      showError("Label and path are required");
      return;
    }
    const newScript = { id: crypto.randomUUID(), label, path: scriptPath };
    saveCustomScriptsMutation.mutate([...customScripts, newScript], {
      onSuccess: () => {
        setScriptLabelInput("");
        setScriptPathInput("");
      },
    });
  };

  const removeScript = (id: string): void => {
    saveCustomScriptsMutation.mutate(customScripts.filter((s) => s.id !== id), {
      onSuccess: () => {
        // Clear launchScriptId from any instances that referenced the deleted script.
        const affected = managedInstances.filter((i) => i.launchScriptId === id);
        if (affected.length > 0) {
          fetch("/api/settings/comfy-instances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instances: affected.map((i) => ({ id: i.id, launchScriptId: null })),
            }),
          }).then(() => {
            queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
          }).catch(() => {/* ignore — next manage poll will reconcile */});
        }
      },
    });
  };

  const saveLaunchScriptMutation = useMutation({
    mutationFn: async ({ instanceId, scriptId }: { instanceId: string; scriptId: string | null }) => {
      const res = await fetch("/api/settings/comfy-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ id: instanceId, launchScriptId: scriptId ?? "" }],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to save launch mode");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
    },
    onError: (err: Error) => { showError(err.message); },
  });

  // ── External ComfyUI stop (with confirmation) ──────────────────────────────
  const [stopExternalPort, setStopExternalPort] = useState<number | null>(null);
  const stopExternalMutation = useMutation({
    mutationFn: async (port: number) => {
      const res = await fetch("/api/comfy/external/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Stop failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setStopExternalPort(null);
      queryClient.invalidateQueries({ queryKey: ["comfy-scan"] });
      queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
    },
    onError: (err: Error) => {
      setStopExternalPort(null);
      showError(err.message);
    },
  });

  // ── Spawn-log viewer ────────────────────────────────────────────────────────
  const [logInstanceId, setLogInstanceId] = useState<string | null>(null);
  const { data: logData } = useQuery<{ log: string | null }>({
    queryKey: ["comfy-logs", logInstanceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/comfy/manage/logs?instanceId=${encodeURIComponent(logInstanceId!)}`,
      );
      if (!res.ok) return { log: null };
      return res.json();
    },
    enabled: logInstanceId != null,
    refetchInterval: logInstanceId ? 2000 : false,
  });

  return (
    <div className="px-10 pb-8">
      <div className="max-w-3xl">
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
                  {allInstances.length > 0 && (
                    <span className="text-[10px] font-mono text-zinc-600">
                      {allInstances.length} instance
                      {allInstances.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {!comfyManage?.isSetup && (
                  <p className="text-xs text-zinc-600 mt-0.5">Setup required</p>
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
          {allInstances.length > 0 && (
            <div className="space-y-2 mb-4">
              {allInstances.map((inst) => (
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
                    {!inst.external && editingLabelId === inst.id ? (
                      <input
                        autoFocus
                        value={labelInput}
                        onChange={(e) => setLabelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitLabel(inst.id);
                          if (e.key === "Escape") setEditingLabelId(null);
                        }}
                        onBlur={() => commitLabel(inst.id)}
                        className="text-xs font-medium bg-zinc-800 border border-emerald-500/50 rounded px-1.5 py-0.5 text-zinc-200 w-32 focus:outline-none"
                        placeholder="Custom label"
                      />
                    ) : (
                      <span className="text-xs font-medium text-zinc-300">
                        {inst.external ? inst.label : getInstanceDisplayLabel(inst)}
                      </span>
                    )}
                    {!inst.external && editingLabelId !== inst.id && (
                      <button
                        onClick={() => startEditLabel(inst)}
                        className="p-0.5 text-zinc-700 hover:text-zinc-400 transition-colors"
                        title="Edit label"
                      >
                        <PencilSimple size={11} />
                      </button>
                    )}
                    <span
                      className="text-[10px] font-mono text-zinc-600"
                      title={
                        inst.configuredPort != null
                          ? `Custom script bound to ${inst.port}; configured port was ${inst.configuredPort}`
                          : undefined
                      }
                    >
                      :{inst.port}
                    </span>
                    {inst.external && inst.devices && inst.devices.length > 0 && (
                      <span
                        className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/70 border border-white/5 truncate max-w-[180px]"
                        title={inst.devices.map((d) => d.name).join(", ")}
                      >
                        {inst.devices[0].name}
                      </span>
                    )}
                    <InstanceStatusBadge status={inst.status} />
                    {!inst.external && customScripts.length > 0 && (
                      <select
                        value={inst.launchScriptId ?? ""}
                        onChange={(e) =>
                          saveLaunchScriptMutation.mutate({
                            instanceId: inst.id,
                            scriptId: e.target.value || null,
                          })
                        }
                        disabled={saveLaunchScriptMutation.isPending}
                        className="text-[10px] font-mono bg-zinc-800 border border-white/5 rounded px-1.5 py-0.5 text-zinc-400 focus:outline-none focus:border-zinc-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          inst.status === "running" || inst.status === "starting"
                            ? "Launch mode — takes effect on next restart"
                            : "Launch mode"
                        }
                      >
                        <option value="">AIOS managed</option>
                        {customScripts.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {inst.external && (
                      <span className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/70 border border-white/5">
                        External
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!inst.external && inst.status === "stopped" && (
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
                    {!inst.external && (inst.status === "running" ||
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
                    {!inst.external && (
                      <button
                        onClick={() => setLogInstanceId(inst.id)}
                        className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title={`View log for ${inst.label}`}
                      >
                        <FileText size={12} />
                      </button>
                    )}
                    {!inst.external && (
                      <button
                        onClick={() => deleteInstanceMutation.mutate(inst.id)}
                        disabled={
                          deleteInstanceMutation.isPending ||
                          inst.status === "running" ||
                          inst.status === "starting"
                        }
                        className="p-1 text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={
                          inst.status === "running" || inst.status === "starting"
                            ? "Stop the instance before deleting"
                            : `Delete ${inst.label}`
                        }
                      >
                        <Trash size={12} />
                      </button>
                    )}
                    {inst.external && (
                      <button
                        onClick={() => setStopExternalPort(inst.port)}
                        disabled={stopExternalMutation.isPending}
                        className="p-1 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"
                        title={`Stop external ComfyUI on :${inst.port}`}
                      >
                        <Stop size={12} weight="fill" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Custom launch scripts — top of the section so users see launch
              options before installation paths. */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Custom launch scripts{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            <p className="text-[11px] text-zinc-600 mb-3">
              Register <span className="font-mono text-zinc-500">.bat</span>,{" "}
              <span className="font-mono text-zinc-500">.sh</span>, or{" "}
              <span className="font-mono text-zinc-500">.ps1</span> scripts to use instead of AIOS&apos;s built-in launch. Assign one per instance above.
            </p>

            {customScripts.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {customScripts.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/50 border border-white/5"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs font-medium text-zinc-300 truncate">{s.label}</span>
                      <span className="text-[10px] font-mono text-zinc-600 truncate">{s.path}</span>
                    </div>
                    <button
                      onClick={() => removeScript(s.id)}
                      className="ml-3 p-1 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                      title="Remove script"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={scriptLabelInput}
                onChange={(e) => setScriptLabelInput(e.target.value)}
                placeholder="Label (e.g. RTX 4060 Ti)"
                className="w-32 px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors shrink-0"
              />
              <div className="relative flex-1">
                <FolderOpen
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
                />
                <input
                  type="text"
                  value={scriptPathInput}
                  onChange={(e) => setScriptPathInput(e.target.value)}
                  placeholder="Path to .bat / .sh / .ps1"
                  onKeyDown={(e) => { if (e.key === "Enter") addScript(); }}
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                disabled={!scriptLabelInput.trim() || !scriptPathInput.trim() || saveCustomScriptsMutation.isPending}
                onClick={addScript}
                className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Add
              </button>
            </div>
          </div>

          {/* Collapsed by default — most users only need to set these once
              during onboarding. Keeping them out of the way reduces page noise. */}
          <details className="group border-t border-white/5 pt-4 mt-4">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors list-none [&::-webkit-details-marker]:hidden">
              <ArrowRight
                size={12}
                className="transition-transform group-open:rotate-90 text-zinc-500"
              />
              Advanced paths
              <span className="text-zinc-600 font-normal">(installation, python, data, scan ports)</span>
            </summary>

            <div className="mt-4 space-y-4">
          {/* ComfyUI installation path */}
          <div>
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
              downloaded into <span className="font-mono-custom">models/</span>{" "}
              subdirectories.
            </p>
          </div>

          {/* Python executable override */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Python executable{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            {savedPythonPath && (
              <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
                <CheckCircle size={11} weight="fill" />
                {savedPythonPath}
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
                  value={pythonInput}
                  onChange={(e) => setPythonInput(e.target.value)}
                  placeholder={
                    savedPythonPath ??
                    "e.g. C:\\Users\\you\\Documents\\ComfyUI\\.venv\\Scripts\\python.exe"
                  }
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono-custom bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                disabled={!pythonInput.trim() || savePythonPathMutation.isPending}
                onClick={() =>
                  savePythonPathMutation.mutate(pythonInput.trim())
                }
                className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pythonSaved ? "Saved ✓" : "Save"}
              </button>
              {savedPythonPath && (
                <button
                  disabled={savePythonPathMutation.isPending}
                  onClick={() => savePythonPathMutation.mutate("")}
                  className="px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-40"
                  title="Clear override"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Point to the <span className="font-mono-custom">python</span> /{" "}
              <span className="font-mono-custom">python.exe</span> inside your
              venv when it lives outside the ComfyUI source tree (e.g. ComfyUI
              Desktop at{" "}
              <span className="font-mono-custom">~/Documents/ComfyUI/.venv</span>
              ). Leave blank to auto-detect.
            </p>
          </div>

          {/* Data directory override (--base-directory) */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Data directory{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            {savedBaseDir && (
              <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
                <CheckCircle size={11} weight="fill" />
                {savedBaseDir}
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
                  value={baseDirInput}
                  onChange={(e) => setBaseDirInput(e.target.value)}
                  placeholder={
                    savedBaseDir ??
                    "e.g. C:\\Users\\you\\Documents\\ComfyUI"
                  }
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono-custom bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                disabled={!baseDirInput.trim() || saveBaseDirMutation.isPending}
                onClick={() => saveBaseDirMutation.mutate(baseDirInput.trim())}
                className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {baseDirSaved ? "Saved ✓" : "Save"}
              </button>
              {savedBaseDir && (
                <button
                  disabled={saveBaseDirMutation.isPending}
                  onClick={() => saveBaseDirMutation.mutate("")}
                  className="px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-40"
                  title="Clear override"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Passed to main.py as{" "}
              <span className="font-mono-custom">--base-directory</span>. Point
              this at your existing ComfyUI workspace (containing{" "}
              <span className="font-mono-custom">models/</span>,{" "}
              <span className="font-mono-custom">input/</span>,{" "}
              <span className="font-mono-custom">output/</span>,{" "}
              <span className="font-mono-custom">user/</span>) so the managed
              instance shares data with your other ComfyUI. Leave blank to use
              the installation path above.
            </p>
          </div>

          {/* Extra ports to scan for external ComfyUI instances */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Additional ports to scan{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            {extraPorts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {extraPorts.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono-custom bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded"
                  >
                    :{p}
                    <button
                      onClick={() =>
                        saveExtraPortsMutation.mutate(extraPorts.filter((x) => x !== p))
                      }
                      disabled={saveExtraPortsMutation.isPending}
                      className="text-emerald-400/60 hover:text-emerald-200 transition-colors"
                      title={`Remove port ${p}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="number"
                min={1024}
                max={65535}
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addPort(); }}
                placeholder="e.g. 9000"
                className="flex-1 px-3 py-2 text-xs font-mono-custom bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              />
              <button
                disabled={!portInput.trim() || saveExtraPortsMutation.isPending}
                onClick={addPort}
                className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Add ports where you run ComfyUI outside the default range.
              Scanned on top of well-known ports for auto-discovery.
            </p>
            {allScannedPorts.length > 0 && (
              <div className="mt-2 text-[11px] text-zinc-500">
                Currently scanning:{" "}
                <span className="font-mono-custom text-zinc-400">
                  {allScannedPorts.join(", ")}
                </span>
              </div>
            )}
          </div>
            </div>
          </details>
        </div>

        {/* Cloud Instances section — shown when Modal is authenticated */}
        {modalStatus?.authenticated && <ModalComfySection />}
      </div>

      {/* Spawn-log viewer */}
      <Modal
        isOpen={logInstanceId != null}
        onClose={() => setLogInstanceId(null)}
        title={`Log — ${logInstanceId ?? ""}`}
        maxWidth="max-w-3xl"
      >
        <div className="max-h-[60vh] overflow-auto rounded-lg bg-black/60 border border-white/5 p-3">
          <pre className="text-[11px] font-mono-custom text-zinc-300 whitespace-pre-wrap break-words">
            {logData?.log ?? "No log yet — start the instance to generate output."}
          </pre>
        </div>
      </Modal>

      {/* External ComfyUI stop confirmation — killing a user-launched process
          is more invasive than stopping an AIOS-managed one, so explicit
          confirmation is required. */}
      <Modal
        isOpen={stopExternalPort != null}
        onClose={() => setStopExternalPort(null)}
        title="Stop external ComfyUI?"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            This will terminate the ComfyUI process listening on{" "}
            <span className="font-mono text-zinc-200">:{stopExternalPort}</span>{" "}
            along with its entire process tree. This instance wasn&apos;t
            launched by AIOS — it may be ComfyUI Desktop, a portable launcher,
            or another app you started manually.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setStopExternalPort(null)}
              disabled={stopExternalMutation.isPending}
              className="px-3 py-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                stopExternalPort != null &&
                stopExternalMutation.mutate(stopExternalPort)
              }
              disabled={stopExternalMutation.isPending}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              {stopExternalMutation.isPending && (
                <CircleNotch size={11} className="animate-spin" />
              )}
              Stop ComfyUI
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export { ComfyUITab };
