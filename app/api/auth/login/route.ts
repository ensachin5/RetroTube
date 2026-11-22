import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  isAuthEnabled,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  verifyAppPassword,
} from "@/lib/auth";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { parseJsonBody, withApiHandler } from "@/lib/http";

const loginSchema = z.object({
  password: z.string().min(1, "Password is required."),
});

export const POST = withApiHandler(
  { route: "/api/auth/login", publicRoute: true },
  async (request, ctx) => {
    if (!isAuthEnabled()) {
      return NextResponse.json(
        { authenticated: true, authRequired: false },
        { status: 200, headers: { "X-Request-Id": ctx.requestId } },
      );
    }

    const body = await parseJsonBody(request, loginSchema);
    const valid = await verifyAppPassword(body.password);
    if (!valid) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        status: 401,
        message: "Incorrect password.",
      });
    }

    const token = await createSessionToken();
    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      request.nextUrl.protocol === "https:";

    const response = NextResponse.json(
      { authenticated: true, authRequired: true },
      { status: 200, headers: { "X-Request-Id": ctx.requestId } },
    );

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttps,
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    });

    return response;
  },
);
