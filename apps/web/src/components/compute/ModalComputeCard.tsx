"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cloud,
  CloudArrowUp,
  CircleNotch,
  X,
  Warning,
  ArrowCounterClockwise,
} from "phosphor-react";

export function ModalComputeCard() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<
    "idle" | "installing" | "authenticating" | "connected" | "error"
  >("idle");
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
      // Step 2: Authenticate — the API spawns `modal token new` and returns the auth URL
      setPhase("authenticating");
      const authResult = await setupMutation.mutateAsync("authenticate");
      // Open the auth URL in the browser so the user can complete the flow
      let authUrl = authResult.url;
      let debugInfo = authResult.debug;
      // If the URL wasn't ready yet, poll for it a few times
      if (!authUrl) {
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const poll = await fetch("/api/modal/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "auth-url" }),
          });
          const data = await poll.json();
          debugInfo = data.debug;
          if (data.url) {
            authUrl = data.url;
            break;
          }
        }
      }
      if (authUrl) {
        window.open(authUrl, "_blank");
      } else {
        // Failed to get URL — show debug info
        setPhase("error");
        const errParts = ["Failed to get auth URL from Modal CLI."];
        if (debugInfo?.error) errParts.push(`Error: ${debugInfo.error}`);
        if (debugInfo?.output)
          errParts.push(`Output: ${debugInfo.output.slice(0, 200)}`);
        if (debugInfo?.modalBin) errParts.push(`Binary: ${debugInfo.modalBin}`);
        setErrorMsg(errParts.join(" "));
        return;
      }
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
      <div
        className={`p-5 rounded-xl border transition-colors ${phase === "connected" ? "border-purple-500/20 bg-[var(--color-background-panel)]" : "border-white/5 bg-[var(--color-background-panel)]/50"}`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg border border-purple-500/20 bg-purple-500/10 flex items-center justify-center overflow-hidden shrink-0">
              <Cloud size={18} className="text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-200">
                  Modal.com
                </span>
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
        {phase === "idle" && (
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
            <span className="text-sm text-zinc-300">
              Installing Modal CLI...
            </span>
          </div>
        )}

        {/* Authenticating */}
        {phase === "authenticating" && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-white/5">
            <CircleNotch size={14} className="animate-spin text-purple-400" />
            <span className="text-sm text-zinc-300">
              Waiting for browser authentication...
            </span>
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
              onClick={() => {
                setPhase("idle");
                setErrorMsg(null);
              }}
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
