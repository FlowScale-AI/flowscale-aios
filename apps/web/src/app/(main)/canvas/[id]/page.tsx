import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { canvases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import CanvasClientPage from "./CanvasClientPage";

export default async function CanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shared?: string }>;
}) {
  const { id } = await params;
  const { shared } = await searchParams;
  const isSharedRequest = shared === "true";

  if (isSharedRequest) {
    // Validate that the canvas owner has enabled sharing
    const db = getDb();
    const [canvas] = await db
      .select({ isShared: canvases.isShared })
      .from(canvases)
      .where(eq(canvases.id, id));
    if (!canvas?.isShared) notFound();
  }

  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-zinc-400">Loading...</div>}>
      <CanvasClientPage isSharedRequest={isSharedRequest} />
    </Suspense>
  );
}
