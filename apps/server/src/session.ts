import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "./errors.js";

const COOKIE_NAME = "collabjam_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;
const loginSchema = z.object({ password: z.string() });

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((entry) => {
      const [name, ...value] = entry.trim().split("=");
      return [name, decodeURIComponent(value.join("="))];
    })
  );
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createSessionHandlers(
  adminPassword: string,
  sessionSecret: string
) {
  const sessionValue = `admin.${sign("admin", sessionSecret)}`;

  const isAuthenticated = (cookieHeader: string | undefined): boolean => {
    const candidate = parseCookies(cookieHeader)[COOKIE_NAME];
    return Boolean(candidate && secureEqual(candidate, sessionValue));
  };

  const getSession: RequestHandler = (request, response) => {
    response.json({ authenticated: isAuthenticated(request.headers.cookie) });
  };

  const login: RequestHandler = (request, response) => {
    const { password } = loginSchema.parse(request.body);
    if (!secureEqual(password, adminPassword)) {
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "The admin password is incorrect."
      );
    }

    response.cookie(COOKIE_NAME, sessionValue, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.secure,
      maxAge: MAX_AGE_SECONDS * 1000,
      path: "/"
    });
    response.json({ authenticated: true });
  };

  const logout: RequestHandler = (request, response) => {
    response.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.secure,
      path: "/"
    });
    response.json({ authenticated: false });
  };

  const requireAdmin: RequestHandler = (request, _response, next) => {
    if (!isAuthenticated(request.headers.cookie)) {
      next(
        new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Admin authentication is required."
        )
      );
      return;
    }
    next();
  };

  return { getSession, login, logout, requireAdmin };
}
