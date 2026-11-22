import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthEnabled, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { ERROR_CODES } from "@/lib/errors";

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/unlock",
  "/offline",
  "/manifest.webmanifest",
  "/manifest.json",
  "/sw.js",
  "/apple-touch-icon.png",
  "/favicon.ico",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/_next/")
  ) {
    return true;
  }
  return false;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestId =
    request.headers.get("x-request-id")?.trim() || globalThis.crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const { pathname } = request.nextUrl;

  if (isAuthEnabled() && !isPublicPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const valid = await verifySessionToken(token);

    if (!valid) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            error: {
              code: ERROR_CODES.UNAUTHORIZED,
              message: "Authentication required. Please unlock with APP_PASSWORD.",
              requestId,
            },
          },
          {
            status: 401,
            headers: {
              "X-Request-Id": requestId,
            },
          },
        );
      }

      const unlockUrl = new URL("/unlock", request.url);
      if (pathname !== "/") {
        unlockUrl.searchParams.set("next", pathname);
      }
      const redirectRes = NextResponse.redirect(unlockUrl);
      redirectRes.headers.set("X-Request-Id", requestId);
      return redirectRes;
    }
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|sw.js|manifest.webmanifest).*)",
  ],
};
