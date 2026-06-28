"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowUpRight,
  Warning,
  MagnifyingGlass,
  Palette,
  Cube,
  Plus,
  GithubLogo,
  FolderOpen,
  X,
  CircleNotch,
} from "phosphor-react";
import {
  PageTransition,
  FadeIn,
  StaggerGrid,
  StaggerItem,
  SkeletonCard,
} from "@/components/ui";
import type { AppManifest } from "@/lib/appManifest";

interface InstalledApp {
  id: string;
  displayName: string;
  source: string;
  manifest: AppManifest | null;
}

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------

function CanvasCard() {
  return (
    <div className="group relative h-full">
      <Link href="/canvas" className="block h-full">
        <div className="relative h-full overflow-hidden rounded-lg border border-white/5 bg-[var(--color-background-panel)] p-5 transition-all duration-200 group-hover:border-zinc-700 group-hover:bg-zinc-800/50">
          <div className="relative z-10 flex flex-col gap-3">
            <div className="flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/5 transition-colors duration-200 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 group-hover:text-emerald-400 text-zinc-400">
              <Palette size={20} weight="duotone" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-tech text-base font-medium text-zinc-100 group-hover:text-white transition-colors">
                Canvas
              </h3>
              <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed">
                Visual boards for building and arranging your AI workflows.
              </p>
            </div>
          </div>
          <div className="absolute top-5 right-5 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            <ArrowUpRight size={16} className="text-zinc-400" />
          </div>
        </div>
      </Link>
    </div>
  );
}

function AppCard({ app }: { app: InstalledApp }) {
  return (
    <div className="group relative h-full">
      <Link href={`/installed-apps/${app.id}`} className="block h-full">
        <div className="relative h-full overflow-hidden rounded-lg border border-white/5 bg-[var(--color-background-panel)] p-5 transition-all duration-200 group-hover:border-zinc-700 group-hover:bg-zinc-800/50">
          <div className="relative z-10 flex flex-col gap-3">
            <div className="flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/5 transition-colors duration-200 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 group-hover:text-emerald-400 text-zinc-400">
              <Cube size={20} weight="duotone" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-tech text-base font-medium text-zinc-100 group-hover:text-white transition-colors">
                {app.displayName}
              </h3>
              <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed">
                {app.manifest?.description || "No description"}
              </p>
            </div>
          </div>
          {app.source === "sideloaded" && (
            <span className="absolute top-3 right-3 text-[9px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
              dev
            </span>
          )}
          <div className="absolute top-5 right-5 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            <ArrowUpRight size={16} className="text-zinc-400" />
          </div>
        </div>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Install modal
// ---------------------------------------------------------------------------

function InstallAppModal({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [githubUrl, setGithubUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleGitHubInstall() {
    if (!githubUrl.trim()) return;
    setInstalling(true);
    setError(null);
    setStatus("Downloading from GitHub...");

    try {
      const res = await fetch("/api/apps/install-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: githubUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Install failed");
        return;
      }
      onInstalled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
      setStatus(null);
    }
  }

  async function handleLocalPathInstall() {
    if (!localPath.trim()) return;
    setInstalling(true);
    setError(null);
    setStatus("Installing from local folder...");

    try {
      const res = await fetch("/api/apps/install-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Install failed");
        return;
      }
      onInstalled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
      setStatus(null);
    }
  }

  async function handleBrowseFolder() {
    const desktop = (window as unknown as { desktop?: { dialog: { openDirectory: () => Promise<string> } } }).desktop;
    if (!desktop) return;

    setError(null);
    const result = await desktop.dialog.openDirectory();
    if (!result) return;

    let folderPath: string;
    try {
      const parsed = JSON.parse(result);
      if (parsed.canceled) return;
      folderPath = Array.isArray(parsed.filePaths) ? parsed.filePaths[0] : parsed;
    } catch {
      // result is a plain path string
      folderPath = result;
    }
    if (!folderPath) return;

    setInstalling(true);
    setStatus("Installing from local folder...");

    try {
      const res = await fetch("/api/apps/install-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Install failed");
        return;
      }
      onInstalled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
      setStatus(null);
    }
  }

  const hasDesktop = typeof window !== "undefined" && !!(window as unknown as { desktop?: unknown }).desktop;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-xl w-[440px] shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/5">
          <h3 className="font-tech text-base font-semibold text-zinc-100">
            Install App
          </h3>
          <button
            onClick={onClose}
            disabled={installing}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* GitHub URL */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <GithubLogo size={16} />
              GitHub Repository
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://github.com/user/my-app"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGitHubInstall()}
                disabled={installing}
                className="flex-1 px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50"
              />
              <button
                onClick={handleGitHubInstall}
                disabled={installing || !githubUrl.trim()}
                className="px-4 py-2 text-sm font-medium bg-zinc-100 text-black rounded-lg hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                Install
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/5" />
            <span className="text-xs text-zinc-600">or</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          {/* Local folder */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <FolderOpen size={16} />
              Local Folder
            </label>
            {hasDesktop ? (
              <button
                onClick={handleBrowseFolder}
                disabled={installing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-50"
              >
                <FolderOpen size={16} />
                Browse local folder
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="C:/path/to/your/app"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLocalPathInstall()}
                  disabled={installing}
                  className="flex-1 px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50"
                />
                <button
                  onClick={handleLocalPathInstall}
                  disabled={installing || !localPath.trim()}
                  className="px-4 py-2 text-sm font-medium bg-zinc-100 text-black rounded-lg hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  Install
                </button>
              </div>
            )}
          </div>

          {/* Status / Error */}
          {installing && status && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <CircleNotch size={14} className="animate-spin" />
              {status}
            </div>
          )}
          {error && (
            <div className="p-3 text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const {
    data: apps,
    isLoading,
    error,
  } = useQuery<InstalledApp[]>({
    queryKey: ["installed-apps"],
    queryFn: async () => {
      const res = await fetch("/api/apps");
      if (!res.ok) throw new Error("Failed to fetch apps");
      return res.json();
    },
    staleTime: 30_000,
  });

  const [installModalOpen, setInstallModalOpen] = useState(false);

  const filteredApps = (apps ?? []).filter((app) => {
    if (!normalizedQuery) return true;

    const fields = [
      app.displayName,
      app.id,
      app.manifest?.description ?? "",
      app.source,
    ];

    return fields.some((field) =>
      field.toLowerCase().includes(normalizedQuery),
    );
  });

  const showCanvasCard =
    !normalizedQuery ||
    "canvas".includes(normalizedQuery) ||
    "visual boards for building and arranging your ai workflows.".includes(
      normalizedQuery,
    );

  const hasAnyVisibleResults = showCanvasCard || filteredApps.length > 0;

  return (
    <PageTransition className="h-full flex flex-col bg-[var(--color-background)] overflow-y-auto">
      <div className="flex-1 px-8">
        <div className="space-y-12">
          {/* Hero Section */}
          <FadeIn from="bottom" duration={0.5}>
            <section className="relative flex flex-col items-center justify-center space-y-6 text-center py-16 md:py-24">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

              <div className="relative z-10 space-y-4 max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-400 backdrop-blur-md">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  System Operational
                </div>

                <h1 className="font-tech text-4xl md:text-6xl font-bold tracking-tight text-white">
                  Access Your{" "}
                  <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
                    Creative Intelligence
                  </span>
                </h1>

                <p className="text-zinc-400 text-lg md:text-xl max-w-xl mx-auto">
                  A unified operating system for all your AI tools. Create,
                  analyze, and build faster than ever.
                </p>
              </div>

              <div className="relative max-w-md mx-auto w-full mt-8 group">
                <div className="absolute inset-0 bg-emerald-500/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative flex items-center bg-[var(--color-background-panel)] border border-white/10 rounded-xl px-4 py-3 shadow-lg focus-within:border-emerald-500/50 transition-colors">
                  <MagnifyingGlass
                    size={20}
                    className="text-zinc-500 shrink-0"
                  />
                  <input
                    type="text"
                    placeholder="Search apps..."
                    className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-100 placeholder-zinc-600 px-3"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </section>
          </FadeIn>

          {/* Apps Grid */}
          <section className="mb-5">
            <FadeIn delay={0.15}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-tech text-2xl font-semibold text-white">
                  Installed Apps
                </h2>
                <div className="flex items-center gap-4">
                  {!isLoading && !error && (
                    <div className="text-sm text-zinc-500">
                      {(showCanvasCard ? 1 : 0) + filteredApps.length}{" "}
                      {(showCanvasCard ? 1 : 0) + filteredApps.length === 1
                        ? "app"
                        : "apps"}{" "}
                      available
                    </div>
                  )}
                  <button
                    onClick={() => setInstallModalOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-zinc-100 transition-colors"
                  >
                    <Plus size={14} weight="bold" />
                    Install App
                  </button>
                </div>
              </div>
            </FadeIn>

            {isLoading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-lg text-red-400 text-sm">
                <Warning size={16} weight="fill" />
                Failed to load apps. Make sure the server is running.
              </div>
            )}

            {!isLoading && !error && !hasAnyVisibleResults && (
              <FadeIn>
                <div className="text-center py-12 text-zinc-500">
                  No apps found matching &lsquo;{searchQuery}&rsquo;
                </div>
              </FadeIn>
            )}

            {!isLoading && !error && hasAnyVisibleResults && (
              <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {showCanvasCard && (
                  <StaggerItem key="canvas">
                    <CanvasCard />
                  </StaggerItem>
                )}
                {filteredApps.map((app) => (
                  <StaggerItem key={app.id}>
                    <AppCard app={app} />
                  </StaggerItem>
                ))}
              </StaggerGrid>
            )}
          </section>
        </div>
      </div>
      {installModalOpen && (
        <InstallAppModal
          onClose={() => setInstallModalOpen(false)}
          onInstalled={() => queryClient.invalidateQueries({ queryKey: ["installed-apps"] })}
        />
      )}
    </PageTransition>
  );
}
