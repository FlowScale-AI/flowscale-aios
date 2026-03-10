"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowUpRight,
  Warning,
  MagnifyingGlass,
  Palette,
  Cube,
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
// Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  const [searchQuery, setSearchQuery] = useState("");
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
                  <div className="relative group/install">
                    <button
                      disabled
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-400 bg-white/5 border border-white/10 rounded-lg cursor-not-allowed opacity-60"
                    >
                      <Cube size={14} />
                      Install App
                    </button>
                    <div className="absolute right-0 top-full mt-1.5 px-2.5 py-1 bg-zinc-800 border border-white/10 rounded-md text-xs text-zinc-300 whitespace-nowrap opacity-0 group-hover/install:opacity-100 transition-opacity pointer-events-none z-10">
                      Coming soon
                    </div>
                  </div>
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
    </PageTransition>
  );
}
