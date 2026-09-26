import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";

const COOKIE = "yomu_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

type FailState = { count: number; reset: number };
const failures = new Map<string, FailState>();

export function appPassword(): string | null {
  const value = (process.env.APP_PASSWORD || "").trim();
  return value || null;
}

function sign(exp: number, password: string): string {
  const body = `v1.${exp}`;
  const mac = crypto.createHmac("sha256", password).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function sessionValid(token: string | null | undefined, password: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(exp, password);
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function passwordsMatch(input: string, expected: string): boolean {
  const left = crypto.createHash("sha256").update(input).digest();
  const right = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function cookieHeader(token: string, req: Request, maxAge: number): string {
  const parts = [`${COOKIE}=${token}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAge}`];
  const force = (process.env.COOKIE_SECURE || "").trim().toLowerCase();
  const secure = force === "1" || force === "true" || (force !== "0" && force !== "false" && req.secure);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "local";
}

function limited(ip: string): boolean {
  const row = failures.get(ip);
  if (!row || row.reset < Date.now()) return false;
  return row.count >= 8;
}

function noteFailure(ip: string): void {
  const now = Date.now();
  const row = failures.get(ip);
  if (!row || row.reset < now) {
    failures.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
    return;
  }
  row.count += 1;
}

export function installAuth(app: Express): void {
  app.get("/api/session", (req, res) => {
    const password = appPassword();
    const token = readCookie(req.header("cookie"), COOKIE);
    res.json({
      required: Boolean(password),
      authenticated: password ? sessionValid(token, password) : true,
    });
  });

  app.post("/api/login", (req, res) => {
    const password = appPassword();
    if (!password) {
      res.status(400).json({ error: "This server is open. No password is set." });
      return;
    }
    const ip = clientIp(req);
    if (limited(ip)) {
      res.status(429).json({ error: "Too many tries. Wait a few minutes and try again." });
      return;
    }
    const given = String(req.body?.password || "");
    if (!passwordsMatch(given, password)) {
      noteFailure(ip);
      res.status(401).json({ error: "That password is not right." });
      return;
    }
    failures.delete(ip);
    const exp = Date.now() + MAX_AGE_SECONDS * 1000;
    res.setHeader("Set-Cookie", cookieHeader(sign(exp, password), req, MAX_AGE_SECONDS));
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", cookieHeader("", req, 0));
    res.json({ ok: true });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const password = appPassword();
    if (!password) return next();
    if (!req.path.startsWith("/api/")) return next();
    if (req.path === "/api/health" || req.path === "/api/session" || req.path === "/api/login" || req.path === "/api/logout") {
      return next();
    }
    const token = readCookie(req.header("cookie"), COOKIE);
    if (sessionValid(token, password)) return next();
    res.status(401).json({ error: "Sign in required." });
  });
}
