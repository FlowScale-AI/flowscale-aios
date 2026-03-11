"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeSlash,
  Trash,
  ArrowSquareOut,
  CheckCircle,
  XCircle,
  CircleNotch,
  ArrowRight,
  FolderOpen,
  Plus,
  CloudArrowUp,
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

// ── Modal endpoints ───────────────────────────────────────────────────────────

interface ModalEndpoint {
  modelId: string;
  url: string;
  key?: string;
}

function ModalEndpointsSection() {
  const queryClient = useQueryClient();
  const [modelId, setModelId] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [appName, setAppName] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testStates, setTestStates] = useState<
    Record<string, "idle" | "testing" | "ok" | "error">
  >({});

  const { data: endpoints = [], isLoading } = useQuery<ModalEndpoint[]>({
    queryKey: ["modal-endpoints"],
    queryFn: async () => {
      const res = await fetch("/api/settings/modal-endpoints");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/modal-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: modelId.trim(), url: url.trim(), key: key.trim() || undefined, appName: appName.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      setModelId("");
      setUrl("");
      setKey("");
      setAppName("");
      queryClient.invalidateQueries({ queryKey: ["modal-endpoints"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/settings/modal-endpoints?modelId=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["modal-endpoints"] }),
  });

  async function testEndpoint(endpoint: ModalEndpoint) {
    setTestStates((s) => ({ ...s, [endpoint.modelId]: "testing" }));
    try {
      const headers: Record<string, string> = {};
      if (endpoint.key) headers["Authorization"] = `Bearer ${endpoint.key}`;
      // Hit the /health path — Modal endpoints expose GET /health
      const healthUrl = endpoint.url.replace(/\/generate\/?$/, "/health");
      const res = await fetch(healthUrl, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      setTestStates((s) => ({
        ...s,
        [endpoint.modelId]: res.ok ? "ok" : "error",
      }));
    } catch {
      setTestStates((s) => ({ ...s, [endpoint.modelId]: "error" }));
    }
    setTimeout(
      () =>
        setTestStates((s) => ({ ...s, [endpoint.modelId]: "idle" })),
      4000
    );
  }

  const canAdd = modelId.trim() && url.trim();

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <CloudArrowUp size={14} className="text-zinc-500" />
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
          Modal.com
        </h2>
      </div>

      <div className="p-5 rounded-xl border border-white/10 bg-[var(--color-background-panel)] space-y-4">
        <p className="text-xs text-zinc-500">
          Deploy any API-engine tool to{" "}
          <a
            href="https://modal.com"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
          >
            Modal.com
          </a>{" "}
          and register its endpoint here. When a Modal endpoint is configured for
          a model, it takes priority over the local inference server.
        </p>

        {/* Registered endpoints */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-zinc-600 text-xs py-2">
            <CircleNotch size={13} className="animate-spin" />
            Loading…
          </div>
        ) : endpoints.length > 0 ? (
          <div className="space-y-2">
            {endpoints.map((ep) => {
              const ts = testStates[ep.modelId] ?? "idle";
              return (
                <div
                  key={ep.modelId}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900/60 border border-white/5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate">
                      {ep.modelId}
                    </p>
                    <p className="text-[11px] text-zinc-600 font-mono truncate">
                      {ep.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => testEndpoint(ep)}
                      disabled={ts === "testing"}
                      className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                    >
                      {ts === "testing" && (
                        <CircleNotch size={11} className="animate-spin" />
                      )}
                      {ts === "ok" && (
                        <CheckCircle size={11} className="text-emerald-400" />
                      )}
                      {ts === "error" && (
                        <XCircle size={11} className="text-red-400" />
                      )}
                      {ts === "idle"
                        ? "Test"
                        : ts === "testing"
                        ? "Testing…"
                        : ts === "ok"
                        ? "OK"
                        : "Failed"}
                    </button>
                    <button
                      onClick={() => removeMutation.mutate(ep.modelId)}
                      disabled={removeMutation.isPending}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-zinc-600 italic">No endpoints configured yet.</p>
        )}

        {/* Add endpoint form */}
        <div className="border-t border-white/5 pt-4 space-y-2">
          <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
            Add endpoint
          </p>
          <input
            type="text"
            placeholder="Model ID — e.g. Tongyi-MAI/Z-Image-Turbo"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <input
            type="url"
            placeholder="Endpoint URL — e.g. https://your-org--z-image-turbo-zimagetur…"
            value={url}
            onChange={(e) => {
              const v = e.target.value
              setUrl(v)
              // Auto-extract Modal app name from the URL: workspace--appname-classname-method.modal.run
              if (!appName) {
                const match = v.match(/--([a-z0-9-]+?)-[a-z0-9]+-[a-z]+\.modal\.run/)
                if (match) setAppName(match[1])
              }
            }}
            className="w-full px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <input
            type="text"
            placeholder="Modal app name (for logs) — e.g. z-image-turbo"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                placeholder="API key (optional)"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full px-3 py-2 pr-9 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {showKey ? <EyeSlash size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <button
              disabled={!canAdd || addMutation.isPending}
              onClick={() => addMutation.mutate()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          {addMutation.isError && (
            <p className="text-xs text-red-400">
              {(addMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-600 mt-2">
        Endpoint configs are stored locally in{" "}
        <span className="font-mono">~/.flowscale/aios/settings.json</span>.
      </p>
    </section>
  );
}

// ── Cloud provider card ───────────────────────────────────────────────────────

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
      // Lightweight provider-specific test call via proxy
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

  const { data: comfyInstances = [] } = useQuery<ComfyInstance[]>({
    queryKey: ["comfy-instances"],
    queryFn: async () => {
      const res = await fetch("/api/comfy/scan");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
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
                      {comfyInstances.length > 0 ? (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/20">
                          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Connected
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 bg-zinc-800 rounded-full">
                          Not running
                        </span>
                      )}
                    </div>
                    {comfyInstances.length > 0 ? (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {comfyInstances.map((i) => `port ${i.port}`).join(", ")}
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-600 mt-0.5">
                        Start ComfyUI to connect
                      </p>
                    )}
                  </div>
                </div>
                <Link
                  href="/integrations/comfyui"
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  View details
                  <ArrowRight size={12} />
                </Link>
              </div>

              {/* ComfyUI installation path */}
              <div className="border-t border-white/5 pt-4">
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                  Installation path
                  <span className="ml-1 text-zinc-600 font-normal">
                    (required for model downloads)
                  </span>
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

          {/* Modal.com */}
          <ModalEndpointsSection />

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
