import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import {
  installModal,
  startModalAuth,
  getModalAuthUrl,
  disconnectModal,
  getAuthDebugInfo,
} from "@/lib/modal-manager";

export async function POST(req: NextRequest) {
  const user = getRequestUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  if (action === "install") {
    const result = await installModal();
    return NextResponse.json(result);
  }

  if (action === "authenticate") {
    const result = startModalAuth();
    // The URL may not be available immediately — the CLI takes a moment to output it.
    // Wait briefly for it, then return whatever we have.
    let url = getModalAuthUrl();
    if (!url) {
      await new Promise((r) => setTimeout(r, 2000));
      url = getModalAuthUrl();
    }
    // Include debug info if URL still not available
    const debug = !url ? getAuthDebugInfo() : undefined;
    return NextResponse.json({ ...result, url, debug });
  }

  if (action === "auth-url") {
    const url = getModalAuthUrl();
    const debug = getAuthDebugInfo();
    return NextResponse.json({ url, debug });
  }

  if (action === "disconnect") {
    const result = disconnectModal();
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
