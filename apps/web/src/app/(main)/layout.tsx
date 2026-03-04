import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/auth";
import type { Role } from "@/lib/auth";
import { CanvasStateProvider } from "@/features/canvases/components/CanvasStateContext";
import Sidebar from "./_Sidebar";

export default async function MainLayout({
  children,
}: {
  children: ReactNode;
}) {
  const headersList = await headers();
  const isSharedCanvas = headersList.get("x-shared-canvas") === "true";

  const cookieStore = await cookies();
  const token = cookieStore.get("fs_session")?.value;

  // For shared canvas pages, allow unauthenticated access with minimal layout
  if (isSharedCanvas && !token) {
    return (
      <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
        <main className="flex-1 overflow-hidden">
          <CanvasStateProvider>{children}</CanvasStateProvider>
        </main>
      </div>
    );
  }

  if (!token) redirect("/login");

  const user = getSessionUser(token);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      <Sidebar role={user.role as Role} username={user.username} />
      <main className="flex-1 overflow-hidden">
        <CanvasStateProvider>{children}</CanvasStateProvider>
      </main>
    </div>
  );
}
