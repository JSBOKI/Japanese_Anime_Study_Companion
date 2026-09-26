import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { installAuth, sessionValid } from "../src/server/auth.ts";

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

test("open when APP_PASSWORD is unset", async () => {
  delete process.env.APP_PASSWORD;
  const app = express();
  app.use(express.json());
  installAuth(app);
  app.get("/api/stats", (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  try {
    const session = (await fetch(`${server.url}/api/session`).then((res) => res.json())) as {
      required: boolean;
      authenticated: boolean;
    };
    assert.equal(session.required, false);
    assert.equal(session.authenticated, true);
    const stats = await fetch(`${server.url}/api/stats`);
    assert.equal(stats.status, 200);
  } finally {
    await server.close();
  }
});

test("password sets a long-lived cookie and blocks the API until then", async () => {
  process.env.APP_PASSWORD = "train-secret";
  const app = express();
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  installAuth(app);
  app.get("/api/stats", (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  try {
    const health = await fetch(`${server.url}/api/health`);
    assert.equal(health.status, 200);
    const locked = await fetch(`${server.url}/api/stats`);
    assert.equal(locked.status, 401);

    const bad = await fetch(`${server.url}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.equal(bad.status, 401);

    const login = await fetch(`${server.url}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "train-secret" }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") || "";
    assert.match(setCookie, /yomu_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=15552000/);
    assert.doesNotMatch(setCookie, /Secure/i);

    const cookie = setCookie.split(";")[0];
    const token = cookie.split("=")[1];
    assert.equal(sessionValid(token, "train-secret"), true);
    assert.equal(sessionValid(`${token}x`, "train-secret"), false);
    assert.equal(sessionValid(token, "other"), false);

    const stats = await fetch(`${server.url}/api/stats`, { headers: { cookie } });
    assert.equal(stats.status, 200);

    const logout = await fetch(`${server.url}/api/logout`, { method: "POST" });
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
  } finally {
    delete process.env.APP_PASSWORD;
    await server.close();
  }
});
