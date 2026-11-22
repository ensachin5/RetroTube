import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { withApiHandler } from "@/lib/http";

export const POST = withApiHandler(
  { route: "/api/auth/logout", publicRoute: true },
  async (request, ctx) => {
    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      request.nextUrl.protocol === "https:";

    const response = NextResponse.json(
      { authenticated: false },
      { status: 200, headers: { "X-Request-Id": ctx.requestId } },
    );

    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttps,
      path: "/",
      maxAge: 0,
    });

    return response;
  },
);
