import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/setup", "/api/auth/", "/api/local-inference/", "/api/setup/"];

// Regex to match /canvas/<uuid> pages and their API data routes
const SHARED_CANVAS_PAGE = /^\/canvas\/[\w-]+$/;
const SHARED_CANVAS_API =
  /^\/api\/(canvases\/[\w-]+(\/items(\/[\w-]+)?)?|outputs\/.+)$/;

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow unauthenticated access to shared canvas pages & their data endpoints
  const isShared = searchParams.get("shared") === "true";
  if (isShared && SHARED_CANVAS_PAGE.test(pathname)) {
    // Forward as a request header so the server-component layout can detect it
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-shared-canvas", "true");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (isShared && SHARED_CANVAS_API.test(pathname)) {
    return NextResponse.next();
  }

  // Also allow canvas API routes when the Referer indicates a shared canvas page,
  // but only for safe read-only methods (Referer is spoofable, so never trust it for writes)
  const method = request.method.toUpperCase();
  if ((method === "GET" || method === "HEAD") && SHARED_CANVAS_API.test(pathname)) {
    const referer = request.headers.get("referer") || "";
    try {
      const refUrl = new URL(referer);
      if (
        refUrl.searchParams.get("shared") === "true" &&
        SHARED_CANVAS_PAGE.test(refUrl.pathname)
      ) {
        return NextResponse.next();
      }
    } catch {
      /* invalid referer — ignore */
    }
  }

  const session = request.cookies.get("fs_session");
  if (!session?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
    "/api/(.*)",
  ],
};
