"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Lightning,
  Play,
  Plus,
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
  GearSix,
  Warning,
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
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [pathSaved, setPathSaved] = useState(false);
  const { data: modalStatus } = useModalStatus();
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const addDropdownRef = useRef<HTMLDivElement>(null);

  const { data: gpuData } = useQuery<{ gpus: Array<{ index: number; name: string; vramMB: number; backend: string }>; cpu: unknown }>({
    queryKey: ["gpu-detect"],
    queryFn: async () => {
      const res = await fetch("/api/gpu");
      if (!res.ok) return { gpus: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

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

  const assignedGpuIndices = new Set(
    managedInstances
      .map((i) => {
        const m = i.id.match(/^gpu-(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter((n): n is number => n !== null),
  );
  const unassignedGpus = (gpuData?.gpus ?? []).filter(
    (g) => !assignedGpuIndices.has(g.index),
  );
  const allGpusAssigned = (gpuData?.gpus ?? []).length > 0 && unassignedGpus.length === 0;

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

  const addInstanceMutation = useMutation({
    mutationFn: async (gpuIndex: number) => {
      const res = await fetch("/api/comfy/instances/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpuIndex }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to add instance");
      }
      return res.json();
    },
    onSuccess: () => {
      setShowAddDropdown(false);
      refetchManage();
      queryClient.invalidateQueries({ queryKey: ["comfy-instances"] });
    },
    onError: (err: Error) => { showError(err.message); },
  });

  useEffect(() => {
    if (!showAddDropdown) return;
    const handler = (e: MouseEvent) => {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
        setShowAddDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddDropdown]);

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

  // ── Blank setup state ──────────────────────────────────────────────────────
  type SetupPhase =
    | "choose"
    | "configuring-desktop"
    | "configuring-custom"
    | "installing"
    | "detecting";

  const [setupPhase, setSetupPhase] = useState<SetupPhase>("choose");
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState("");
  const [setupJustCompleted, setSetupJustCompleted] = useState(false);

  // Desktop App option
  const DESKTOP_DEFAULT_PATH = "/Applications/ComfyUI.app/Contents/Resources/ComfyUI";
  const [desktopComfyPath, setDesktopComfyPath] = useState(DESKTOP_DEFAULT_PATH);
  const [desktopUserDataPath, setDesktopUserDataPath] = useState("");
  const [desktopPathValid, setDesktopPathValid] = useState<boolean | null>(null);
  const [desktopPathValidating, setDesktopPathValidating] = useState(false);

  // Custom path option
  const [customPath, setCustomPath] = useState("");
  const [customPathValid, setCustomPathValid] = useState<boolean | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [resolvedCustomPath, setResolvedCustomPath] = useState("");

  // ── Setup helpers ──────────────────────────────────────────────────────────

  const validatePath = async (
    pathStr: string,
    setValid: (v: boolean | null) => void,
    setValidating: (v: boolean) => void,
    onResolved?: (p: string) => void,
  ) => {
    if (!pathStr.trim()) { setValid(null); return; }
    setValidating(true);
    try {
      const res = await fetch(
        `/api/comfy/setup/validate-path?path=${encodeURIComponent(pathStr.trim())}`,
      );
      const data = await res.json() as { valid: boolean; resolvedPath?: string };
      setValid(data.valid);
      if (data.valid && data.resolvedPath && onResolved) onResolved(data.resolvedPath);
    } catch {
      setValid(false);
    } finally {
      setValidating(false);
    }
  };

  const saveComfySetup = async (installType: string, managedPath: string, desktopDataPath?: string) => {
    await fetch("/api/settings/comfyui-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installType,
        managedPath,
        ...(desktopDataPath ? { desktopUserDataPath: desktopDataPath } : {}),
      }),
    });
  };

  const streamInstall = async (targetPath?: string): Promise<boolean> => {
    setInstallLog([]);
    setInstallError("");
    const res = await fetch("/api/comfy/setup/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetPath ? { targetPath } : {}),
    });
    if (!res.body) { setInstallError("No response body"); return false; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = JSON.parse(line.slice(6)) as { msg?: string; done?: boolean; error?: string };
        if (payload.msg) setInstallLog((prev) => [...prev, payload.msg!]);
        if (payload.error) { setInstallError(payload.error); return false; }
        if (payload.done) return true;
      }
    }
    return true;
  };

  const finishSetup = async () => {
    setSetupPhase("detecting");
    await fetch("/api/comfy/instances/detect", { method: "POST" });
    setSetupJustCompleted(true);
    setTimeout(() => setSetupJustCompleted(false), 5000);
    queryClient.invalidateQueries({ queryKey: ["comfy-manage"] });
    refetchManage();
  };

  const handleDesktopSetup = async () => {
    if (!desktopUserDataPath.trim()) { showError("Desktop user data path is required"); return; }
    setSetupPhase("installing");
    try {
      await saveComfySetup("desktop-app", desktopPathValid ? desktopComfyPath : "", desktopUserDataPath.trim());
      const ok = await streamInstall(desktopPathValid ? desktopComfyPath : undefined);
      if (!ok) return;
      await fetch("/api/comfy/setup/copy-assets", { method: "POST" });
      await finishSetup();
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : "Setup failed");
    }
  };

  const handleInstallSetup = async () => {
    setSetupPhase("installing");
    try {
      await saveComfySetup("github", "");
      const ok = await streamInstall();
      if (!ok) return;
      await finishSetup();
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : "Install failed");
    }
  };

  const handleCustomSetup = async () => {
    const pathToUse = resolvedCustomPath || customPath.trim();
    if (!pathToUse || !customPathValid) { showError("Enter a valid ComfyUI installation path"); return; }
    setSetupPhase("detecting");
    await saveComfySetup("custom", pathToUse);
    await finishSetup();
  };

  useEffect(() => {
    validatePath(
      DESKTOP_DEFAULT_PATH,
      setDesktopPathValid,
      setDesktopPathValidating,
      setDesktopComfyPath,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {!comfyManage?.isSetup ? (
        <div className="max-w-2xl">
          {/* ── Detecting phase ─────────────────────────────────────────────── */}
          {setupPhase === "detecting" && (
            <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)] flex items-center gap-3">
              <CircleNotch size={18} className="animate-spin text-emerald-400 shrink-0" />
              <span className="text-sm text-zinc-300">Detecting GPUs and configuring instances…</span>
            </div>
          )}

          {/* ── Installing phase ─────────────────────────────────────────────── */}
          {setupPhase === "installing" && (
            <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)]">
              <div className="mb-3">
                <h3 className="font-tech text-sm font-semibold text-zinc-200">Installing ComfyUI</h3>
                <p className="text-xs text-zinc-500 mt-0.5">This may take a few minutes…</p>
              </div>
              <div className="rounded-lg bg-black/60 border border-white/5 p-3 max-h-64 overflow-auto">
                <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap">
                  {installLog.join("\n") || "Starting…"}
                </pre>
              </div>
              {installError && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-500/20">
                  <Warning size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{installError}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Choose / Configuring phases ──────────────────────────────────── */}
          {(setupPhase === "choose" || setupPhase === "configuring-desktop" || setupPhase === "configuring-custom") && (
            <>
              <div className="mb-6">
                <h2 className="font-tech text-xl font-semibold text-zinc-100">Connect your ComfyUI Workspace</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  Link your local ComfyUI installation to FlowScale AIOS to manage instances and orchestrate generative workflows.
                </p>
              </div>

              <div className="space-y-3">
                {/* Option A — ComfyUI Desktop App */}
                <div className={`p-4 rounded-xl border transition-colors ${setupPhase === "configuring-desktop" ? "border-emerald-500/30 bg-[var(--color-background-panel)]" : "border-white/8 bg-[var(--color-background-panel)]/50"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-zinc-200">ComfyUI Desktop App</span>
                        {desktopPathValid === true && (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle size={10} weight="fill" /> Detected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">Use your existing ComfyUI Desktop App installation.</p>
                    </div>
                    {setupPhase !== "configuring-desktop" && (
                      <button
                        onClick={() => setSetupPhase("configuring-desktop")}
                        className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors shrink-0"
                      >
                        Select
                      </button>
                    )}
                  </div>

                  {setupPhase === "configuring-desktop" && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">ComfyUI App path</label>
                        <div className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <FolderOpen size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                            <input
                              type="text"
                              value={desktopComfyPath}
                              onChange={(e) => {
                                setDesktopComfyPath(e.target.value);
                                setDesktopPathValid(null);
                              }}
                              onBlur={() => validatePath(desktopComfyPath, setDesktopPathValid, setDesktopPathValidating, setDesktopComfyPath)}
                              className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                            />
                          </div>
                          {desktopPathValidating && <CircleNotch size={14} className="animate-spin text-zinc-500 shrink-0" />}
                          {desktopPathValid === true && <CheckCircle size={14} className="text-emerald-400 shrink-0" weight="fill" />}
                          {desktopPathValid === false && <span className="text-[10px] text-red-400 shrink-0">Not found</span>}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">
                          User data folder <span className="text-zinc-600">(models, custom_nodes, etc.)</span>
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <FolderOpen size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                            <input
                              type="text"
                              value={desktopUserDataPath}
                              onChange={(e) => setDesktopUserDataPath(e.target.value)}
                              placeholder="e.g. ~/Library/Application Support/ComfyUI"
                              className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                            />
                          </div>
                          {window.desktop?.dialog?.openDirectory && (
                            <button
                              onClick={async () => {
                                const dir = await window.desktop!.dialog.openDirectory!();
                                if (dir) setDesktopUserDataPath(dir);
                              }}
                              className="px-2.5 py-1.5 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-600 transition-colors shrink-0"
                            >
                              Browse
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setSetupPhase("choose")} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Back</button>
                        <button
                          onClick={handleDesktopSetup}
                          disabled={!desktopUserDataPath.trim()}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg transition-colors"
                        >
                          Use Desktop App
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Option B — Install via AIOS */}
                <div className="p-4 rounded-xl border border-white/8 bg-[var(--color-background-panel)]/50">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200 mb-1">Install via FlowScale AIOS</p>
                      <p className="text-xs text-zinc-500">Clone ComfyUI from GitHub into <span className="font-mono text-zinc-400">~/.flowscale/comfyui</span> and set it up automatically.</p>
                    </div>
                    <button
                      onClick={handleInstallSetup}
                      className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors shrink-0"
                    >
                      Install
                    </button>
                  </div>
                </div>

                {/* Option C — Custom path */}
                <div className={`p-4 rounded-xl border transition-colors ${setupPhase === "configuring-custom" ? "border-emerald-500/30 bg-[var(--color-background-panel)]" : "border-white/8 bg-[var(--color-background-panel)]/50"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-zinc-200 mb-1">Existing Custom Installation</p>
                      <p className="text-xs text-zinc-500">Point AIOS to a ComfyUI folder you already have on disk.</p>
                    </div>
                    {setupPhase !== "configuring-custom" && (
                      <button
                        onClick={() => setSetupPhase("configuring-custom")}
                        className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors shrink-0"
                      >
                        Select
                      </button>
                    )}
                  </div>

                  {setupPhase === "configuring-custom" && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="block text-[11px] text-zinc-500 mb-1">ComfyUI installation folder</label>
                        <div className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <FolderOpen size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                            <input
                              type="text"
                              value={customPath}
                              onChange={(e) => {
                                setCustomPath(e.target.value);
                                setCustomPathValid(null);
                                setResolvedCustomPath("");
                              }}
                              onBlur={() => validatePath(
                                customPath,
                                setCustomPathValid,
                                setCustomPathValidating,
                                setResolvedCustomPath,
                              )}
                              placeholder="/path/to/ComfyUI"
                              className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                            />
                          </div>
                          {window.desktop?.dialog?.openDirectory && (
                            <button
                              onClick={async () => {
                                const dir = await window.desktop!.dialog.openDirectory!();
                                if (dir) {
                                  setCustomPath(dir);
                                  validatePath(dir, setCustomPathValid, setCustomPathValidating, setResolvedCustomPath);
                                }
                              }}
                              className="px-2.5 py-1.5 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-600 transition-colors shrink-0"
                            >
                              Browse
                            </button>
                          )}
                          {customPathValidating && <CircleNotch size={14} className="animate-spin text-zinc-500 shrink-0" />}
                          {customPathValid === true && <CheckCircle size={14} className="text-emerald-400 shrink-0" weight="fill" />}
                          {customPathValid === false && <span className="text-[10px] text-red-400 shrink-0 whitespace-nowrap">Not a valid ComfyUI folder</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setSetupPhase("choose")} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Back</button>
                        <button
                          onClick={handleCustomSetup}
                          disabled={!customPathValid}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg transition-colors"
                        >
                          Connect
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {setupJustCompleted && (
            <div className="max-w-3xl mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
              <CheckCircle size={14} weight="fill" className="text-emerald-400 shrink-0" />
              ComfyUI connected — instances are ready. Start them below.
            </div>
          )}
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
              <button
                onClick={() => setConfigModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-transparent hover:border-zinc-700 rounded-lg transition-colors"
              >
                <GearSix size={13} />
                Edit Configuration
              </button>
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
              {comfyManage?.isSetup && (gpuData?.gpus ?? []).length > 0 && (
                <div className="relative" ref={addDropdownRef}>
                  <button
                    onClick={() => setShowAddDropdown((v) => !v)}
                    disabled={allGpusAssigned || addInstanceMutation.isPending}
                    title={allGpusAssigned ? "All GPUs are in use" : "Add instance for another GPU"}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 text-[11px] font-medium rounded-lg transition-colors border border-zinc-700"
                  >
                    <Plus size={10} weight="bold" />
                    Add Instance
                  </button>
                  {showAddDropdown && unassignedGpus.length > 0 && (
                    <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden min-w-[180px]">
                      {unassignedGpus.map((gpu) => (
                        <button
                          key={gpu.index}
                          onClick={() => addInstanceMutation.mutate(gpu.index)}
                          disabled={addInstanceMutation.isPending}
                          className="w-full text-left flex items-start gap-2 px-3 py-2.5 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        >
                          <Lightning size={13} className="text-zinc-500 mt-0.5 shrink-0" />
                          <div>
                            <div className="text-xs font-medium text-zinc-200">{gpu.name}</div>
                            <div className="text-[10px] text-zinc-500">
                              {(gpu.vramMB / 1024).toFixed(0)} GB · GPU {gpu.index}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

        </div>

          {/* Cloud Instances section — shown when Modal is authenticated */}
          {modalStatus?.authenticated && <ModalComfySection />}
        </div>

        {/* Configuration Modal */}
      <Modal
        isOpen={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        title="ComfyUI Configuration"
        maxWidth="max-w-xl"
      >
        <div className="space-y-6">
          {/* Installation path */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
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
                <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder={savedPath ?? "/path/to/ComfyUI"}
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
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
              Root directory of your ComfyUI install. Models downloaded into <span className="font-mono">models/</span> subdirectories.
            </p>
          </div>

          {/* Python executable */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Python executable <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            {savedPythonPath && (
              <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
                <CheckCircle size={11} weight="fill" />
                {savedPythonPath}
              </p>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                <input
                  type="text"
                  value={pythonInput}
                  onChange={(e) => setPythonInput(e.target.value)}
                  placeholder={savedPythonPath ?? "e.g. /path/to/.venv/bin/python"}
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                disabled={!pythonInput.trim() || savePythonPathMutation.isPending}
                onClick={() => savePythonPathMutation.mutate(pythonInput.trim())}
                className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pythonSaved ? "Saved ✓" : "Save"}
              </button>
              {savedPythonPath && (
                <button
                  disabled={savePythonPathMutation.isPending}
                  onClick={() => savePythonPathMutation.mutate("")}
                  className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-40"
                  title="Clear override"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Point to the <span className="font-mono">python</span> inside your venv when it lives outside the ComfyUI source tree. Leave blank to auto-detect.
            </p>
          </div>

          {/* Data directory */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Data directory <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            {savedBaseDir && (
              <p className="text-xs text-emerald-400 font-mono mb-2 flex items-center gap-1.5">
                <CheckCircle size={11} weight="fill" />
                {savedBaseDir}
              </p>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                <input
                  type="text"
                  value={baseDirInput}
                  onChange={(e) => setBaseDirInput(e.target.value)}
                  placeholder={savedBaseDir ?? "e.g. ~/Documents/ComfyUI"}
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
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
                  className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-40"
                  title="Clear override"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Passed as <span className="font-mono">--base-directory</span> to main.py. Leave blank to use the installation path.
            </p>
          </div>

          {/* Additional scan ports */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Additional ports to scan <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            {extraPorts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {extraPorts.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded">
                    :{p}
                    <button
                      onClick={() => saveExtraPortsMutation.mutate(extraPorts.filter((x) => x !== p))}
                      disabled={saveExtraPortsMutation.isPending}
                      className="text-emerald-400/60 hover:text-emerald-200 transition-colors"
                    >×</button>
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
                className="flex-1 px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              />
              <button
                disabled={!portInput.trim() || saveExtraPortsMutation.isPending}
                onClick={addPort}
                className="px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
            {allScannedPorts.length > 0 && (
              <div className="mt-2 text-[11px] text-zinc-500">
                Scanning: <span className="font-mono text-zinc-400">{allScannedPorts.join(", ")}</span>
              </div>
            )}
          </div>

          {/* Custom launch scripts */}
          <div className="border-t border-white/5 pt-4">
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Custom launch scripts <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            <p className="text-[11px] text-zinc-600 mb-3">
              Register <span className="font-mono">.bat</span>, <span className="font-mono">.sh</span>, or <span className="font-mono">.ps1</span> scripts to use instead of AIOS&apos;s built-in launch. Assign one per instance via the dropdown on each instance row.
            </p>
            {customScripts.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {customScripts.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/50 border border-white/5">
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
                <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
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
        </div>
      </Modal>

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
        </>
      )}
    </div>
  );
}

export { ComfyUITab };
