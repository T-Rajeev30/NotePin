"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const pairing = require("./pairing");
const {
  loadDevices,
  updateDevices,
  newKey,
  DEVICE_ID_RE,
} = require("./devices");
const {
  COOKIE,
  createTokens,
  parseCookies,
  sessionCookie,
  createLimiter,
  loadSecret,
} = require("./auth");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const MAX_DEVICES_PER_USER = 20;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

// ctx: { users, recordings, pipeline, presence, bus, notes, disconnect(deviceId) }
function createHttpServer(cfg, ctx, log = () => {}) {
  const { users, recordings, pipeline, presence, bus } = ctx;
  const tokens = createTokens(loadSecret(cfg), cfg.sessionDays * 86400);
  const authLimiter = createLimiter(10, 15 * 60 * 1000); // failed logins per ip+email
  const ipLimiter = createLimiter(60, 15 * 60 * 1000); // all /api/auth/* per ip
  const signupLimiter = createLimiter(10, 60 * 60 * 1000);

  const ipOf = (req) =>
    (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const json = (res, status, body, headers = {}) => {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SEC_HEADERS,
      ...headers,
    });
    res.end(data);
  };

  async function body(req) {
    const type = String(req.headers["content-type"] || "");
    if (!type.startsWith("application/json"))
      fail(415, "Content-Type must be application/json");
    let size = 0;
    const parts = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) fail(413, "Request too large");
      parts.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString() || "{}");
    } catch {
      return fail(400, "Invalid JSON");
    }
  }

  function userOf(req) {
    const t = tokens.verify(parseCookies(req.headers.cookie)[COOKIE]);
    const u = t && users.byId(t.u);
    return u && u.tokenVersion === t.v ? u : null;
  }
  const need = (req) => userOf(req) || fail(401, "Please sign in");
  const needAdmin = (req) => {
    const u = need(req);
    if (u.role !== "admin") fail(403, "Admin only");
    return u;
  };
  const canSee = (u, ownerId) =>
    u.role === "admin" || (!!ownerId && ownerId === u.id);
  const scope = (u) => (u.role === "admin" ? undefined : u.id);

  const setSession = (res, u, extra = {}) =>
    json(
      res,
      extra.status || 200,
      { user: users.pub(u) },
      {
        "Set-Cookie": sessionCookie(tokens.sign(u), {
          maxAge: tokens.ttlSec,
          secure: cfg.cookieSecure,
        }),
      },
    );

  const deviceView = (id, d, viewer) => ({
    deviceId: id,
    name: d.name || id,
    createdAt: d.createdAt || null,
    pairing: d.pairing === "code" ? "code" : "key",
    revoked: !!d.revoked,
    lastSeenAt: d.lastSeenAt || null,
    online: presence.has(id),
    onlineSince: presence.get(id)?.since
      ? new Date(presence.get(id).since).toISOString()
      : null,
    ownerId: d.ownerId || null,
    ownerEmail:
      viewer.role === "admin" && d.ownerId
        ? users.byId(d.ownerId)?.email || null
        : undefined,
  });

  const mmss = (t) =>
    `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  function exportRecording(r, format) {
    const base = `${r.startedAt.slice(0, 10)}_${r.id}`;
    if (format === "json")
      return {
        type: "application/json",
        name: `${base}.json`,
        data: JSON.stringify(r, null, 2),
      };
    const lines = r.segments.map((s) => `[${mmss(s.start)}] ${s.text}`);
    if (format === "md") {
      const n = r.notes && r.notes.status === "ready" ? r.notes : null;
      const md = [
        `# ${n?.title || "Recording"}`,
        `*${r.startedAt} · ${Math.round(r.durationSec)} s · ${r.deviceId}*`,
        "",
      ];
      if (n) {
        md.push("## Summary", n.summary, "");
        if (n.keyPoints?.length)
          md.push("## Key points", ...n.keyPoints.map((x) => `- ${x}`), "");
        if (n.actionItems?.length)
          md.push(
            "## Action items",
            ...n.actionItems.map((x) => `- [ ] ${x}`),
            "",
          );
      }
      md.push("## Transcript", ...lines.map((l) => `${l}  `));
      return {
        type: "text/markdown; charset=utf-8",
        name: `${base}.md`,
        data: md.join("\n"),
      };
    }
    return {
      type: "text/plain; charset=utf-8",
      name: `${base}.txt`,
      data: lines.join("\n"),
    };
  }

  // ---- routes: [method, pattern, handler(req, res, params, url)] ----
  const routes = [];
  const on = (method, pattern, fn) =>
    routes.push([
      method,
      new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
      fn,
    ]);

  on("GET", "/api/health", (req, res) => json(res, 200, { ok: true }));

  on("GET", "/api/auth/config", (req, res) =>
    json(res, 200, { signup: cfg.signup, needsBootstrap: users.count() === 0 }),
  );

  on("GET", "/api/auth/me", (req, res) =>
    json(res, 200, { user: users.pub(need(req)) }),
  );

  on("POST", "/api/auth/login", async (req, res) => {
    const { email = "", password = "" } = await body(req);
    const key = `${ipOf(req)}|${String(email).toLowerCase()}`;
    const wait = authLimiter.hit(key);
    if (wait)
      return json(
        res,
        429,
        {
          error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`,
        },
        { "Retry-After": String(wait) },
      );
    const u = users.byEmail(email);
    // Always run one scrypt so unknown emails cost the same as wrong passwords.
    const ok = await users.verifyPassword(
      String(password),
      u
        ? u.passHash
        : "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    );
    if (!u || !ok) fail(401, "Wrong email or password");
    authLimiter.clear(key);
    return setSession(res, u);
  });

  on("POST", "/api/auth/signup", async (req, res) => {
    if (signupLimiter.hit(ipOf(req)))
      fail(429, "Too many sign-ups from this address");
    const b = await body(req);
    if (users.count() === 0)
      fail(
        403,
        "No admin account yet. On the server run: node scripts/admin.js create-admin <email>",
      );
    if (cfg.signup === "closed") fail(403, "Sign-ups are closed");
    const code = String(b.invite || "").trim();
    if (cfg.signup === "invite" && !users.hasInvite(code))
      fail(403, "A valid invite code is required");
    const u = await users.create({
      email: b.email,
      name: b.name,
      password: b.password,
    });
    if (cfg.signup === "invite") users.consumeInvite(code, u.id);
    log(`User registered: ${u.email}`);
    return setSession(res, u, { status: 201 });
  });

  on("POST", "/api/auth/logout", (req, res) =>
    json(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": sessionCookie("", {
          maxAge: 0,
          secure: cfg.cookieSecure,
        }),
      },
    ),
  );

  on("POST", "/api/auth/password", async (req, res) => {
    const u = need(req);
    const b = await body(req);
    if (!(await users.verifyPassword(String(b.current || ""), u.passHash)))
      fail(403, "Current password is wrong");
    return setSession(res, await users.setPassword(u.id, b.next));
  });

  // invites + users (admin)
  on("GET", "/api/invites", (req, res) => {
    needAdmin(req);
    json(res, 200, { invites: users.listInvites() });
  });
  on("POST", "/api/invites", (req, res) => {
    const u = needAdmin(req);
    json(res, 201, { invite: users.createInvite(u.id) });
  });
  on("DELETE", "/api/invites/:code", (req, res, p) => {
    needAdmin(req);
    json(res, 200, { ok: users.revokeInvite(p.code) });
  });
  on("GET", "/api/users", (req, res) => {
    needAdmin(req);
    json(res, 200, { users: users.list() });
  });

  // devices
  on("GET", "/api/devices", (req, res) => {
    const u = need(req);
    const list = Object.entries(loadDevices(cfg.devicesFile))
      .filter(([, d]) => canSee(u, d.ownerId))
      .map(([id, d]) => deviceView(id, d, u))
      .sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1));
    json(res, 200, { devices: list });
  });

  on("POST", "/api/devices", async (req, res) => {
    const u = need(req);
    const b = await body(req);
    const id = String(b.deviceId || "").trim();
    if (!DEVICE_ID_RE.test(id))
      fail(400, "Device ID: 1-16 characters (letters, digits, . _ -)");
    // With a pairing code the key is derived from it (nothing to copy to the device); without one, a key is generated.
    const hasCode = b.code !== undefined && String(b.code).trim() !== "";
    const code = hasCode ? pairing.normalize(b.code) : "";
    if (hasCode && !code)
      fail(
        400,
        "That pairing code does not look right. Check it against the one shown during setup.",
      );
    const key = code ? pairing.deriveKey(code, id) : newKey();
    const view = updateDevices(cfg.devicesFile, (all) => {
      if (Object.prototype.hasOwnProperty.call(all, id))
        fail(409, "That device ID is already registered");
      if (
        u.role !== "admin" &&
        Object.values(all).filter((d) => d.ownerId === u.id).length >=
          MAX_DEVICES_PER_USER
      )
        fail(403, "Device limit reached");
      all[id] = {
        key,
        name: String(b.name || id)
          .trim()
          .slice(0, 40),
        ownerId: u.id,
        createdAt: new Date().toISOString(),
        revoked: false,
        pairing: code ? "code" : "key",
      };
      return deviceView(id, all[id], u);
    });
    log(
      `Device added: ${id} by ${u.email} (${code ? "pairing code" : "generated key"})`,
    );
    if (code) return json(res, 201, { device: view });
    json(res, 201, { device: view, key, serialCommand: `key ${key}` });
  });

  const ownedDevice = (all, id, u) => {
    const d = Object.prototype.hasOwnProperty.call(all, id) ? all[id] : null;
    if (!d || !canSee(u, d.ownerId)) fail(404, "Device not found");
    return d;
  };

  on("PATCH", "/api/devices/:id", async (req, res, p) => {
    const u = need(req);
    const b = await body(req);
    const view = updateDevices(cfg.devicesFile, (all) => {
      const d = ownedDevice(all, p.id, u);
      if (d.pairing === "code")
        fail(
          409,
          "This device is paired with a code. Remove it, make a new code on the pin (setup mode), and add it again.",
        );
      if (typeof b.name === "string")
        d.name = b.name.trim().slice(0, 40) || p.id;
      if (typeof b.revoked === "boolean") d.revoked = b.revoked;
      if (b.ownerId !== undefined) {
        if (u.role !== "admin") fail(403, "Admin only");
        if (b.ownerId && !users.byId(b.ownerId)) fail(400, "No such user");
        d.ownerId = b.ownerId || null;
      }
      return deviceView(p.id, d, u);
    });
    if (b.revoked === true && ctx.disconnect) ctx.disconnect(p.id);
    json(res, 200, { device: view });
  });

  on("POST", "/api/devices/:id/rotate", (req, res, p) => {
    const u = need(req);
    const key = newKey();
    updateDevices(cfg.devicesFile, (all) => {
      ownedDevice(all, p.id, u).key = key;
    });
    if (ctx.disconnect) ctx.disconnect(p.id);
    log(`Device key rotated: ${p.id} by ${u.email}`);
    json(res, 200, { key, serialCommand: `key ${key}` });
  });

  on("DELETE", "/api/devices/:id", (req, res, p) => {
    const u = need(req);
    updateDevices(cfg.devicesFile, (all) => {
      ownedDevice(all, p.id, u);
      delete all[p.id];
    });
    if (ctx.disconnect) ctx.disconnect(p.id);
    log(`Device removed: ${p.id} by ${u.email}`);
    json(res, 200, { ok: true });
  });

  // recordings
  on("GET", "/api/recordings", (req, res, p, url) => {
    const u = need(req);
    const q = url.searchParams;
    const limit = Math.min(
      Math.max(parseInt(q.get("limit"), 10) || 30, 1),
      100,
    );
    json(
      res,
      200,
      recordings.list({
        ownerId: scope(u),
        deviceId: q.get("device") || undefined,
        q: q.get("q") || "",
        limit,
        before: q.get("before") || undefined,
      }),
    );
  });

  const ownedRecording = (req, id) => {
    const u = need(req);
    const r = recordings.get(id);
    if (!r || !canSee(u, r.ownerId)) fail(404, "Recording not found");
    return r;
  };

  on("GET", "/api/recordings/:id", (req, res, p) =>
    json(res, 200, { recording: ownedRecording(req, p.id) }),
  );

  on("DELETE", "/api/recordings/:id", (req, res, p) => {
    const r = ownedRecording(req, p.id);
    if (!r.endedAt) fail(409, "Recording is still in progress");
    json(res, 200, { ok: recordings.remove(r.id) });
  });

  on("POST", "/api/recordings/:id/notes", (req, res, p) => {
    const r = ownedRecording(req, p.id);
    if (!pipeline.regenerate(r.id)) fail(409, "Recording is not finished");
    json(res, 202, { ok: true });
  });

  on("GET", "/api/recordings/:id/export", (req, res, p, url) => {
    const r = ownedRecording(req, p.id);
    const out = exportRecording(r, url.searchParams.get("format") || "txt");
    res.writeHead(200, {
      "Content-Type": out.type,
      "Content-Disposition": `attachment; filename="${out.name}"`,
      "Cache-Control": "no-store",
      ...SEC_HEADERS,
    });
    res.end(out.data);
  });

  on("GET", "/api/stats", (req, res) => {
    const u = need(req);
    const mine = Object.entries(loadDevices(cfg.devicesFile)).filter(([, d]) =>
      canSee(u, d.ownerId),
    );
    json(res, 200, {
      ...recordings.stats({ ownerId: scope(u) }),
      devices: mine.length,
      online: mine.filter(([id]) => presence.has(id)).length,
      notesEnabled: ctx.notes.enabled,
      transcriptionEnabled: !!cfg.deepgramKey,
    });
  });

  // live updates (Server-Sent Events), filtered by ownership
  on("GET", "/api/events", (req, res) => {
    const u = need(req);
    req.socket.setTimeout(0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...SEC_HEADERS,
    });
    res.write("retry: 3000\n\n");
    const send = (ev) => {
      if (u.role !== "admin" && ev.ownerId !== u.id) return;
      res.write(`data: ${JSON.stringify({ ...ev, ownerId: undefined })}\n\n`);
    };
    bus.on("event", send);
    const beat = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(beat);
      bus.off("event", send);
    });
  });

  // ---- static dashboard ----
  function serveStatic(req, res, pathname) {
    const dir = cfg.dashboardDir;
    if (!fs.existsSync(path.join(dir, "index.html"))) {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        ...SEC_HEADERS,
      });
      return res.end(
        'NotePin API is running.\nDashboard not built: run "npm ci && npm run build" in the dashboard folder.\n',
      );
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      fail(400, "Bad path");
    }
    let file = path.normalize(path.join(dir, decoded));
    if (!file.startsWith(dir + path.sep) && file !== dir)
      fail(404, "Not found");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(dir, "index.html"); // SPA fallback
    const ext = path.extname(file);
    const immutable = pathname.startsWith("/assets/");
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      ...SEC_HEADERS,
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const pathname = url.pathname;
      if (pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host)
            fail(403, "Cross-origin request blocked");
        }
        if (pathname.startsWith("/api/auth/") && ipLimiter.hit(ipOf(req)))
          fail(429, "Too many requests");
        for (const [method, re, fn] of routes) {
          const m = method === req.method && re.exec(pathname);
          if (m) return await fn(req, res, { ...m.groups }, url);
        }
        fail(404, "Not found");
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        fail(405, "Method not allowed");
      serveStatic(req, res, pathname);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError)
        return json(res, err.status, { error: err.message });
      if (err.status) return json(res, err.status, { error: err.message }); // userStore validation errors
      log(`HTTP 500 ${req.method} ${req.url}: ${err.stack || err.message}`);
      json(res, 500, { error: "Internal error" });
    }
  });
  server.requestTimeout = 30000;

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(cfg.httpPort, cfg.httpHost, () => {
          server.removeListener("error", reject);
          const a = server.address();
          log(`HTTP dashboard/API listening on ${a.address}:${a.port}`);
          resolve(a);
        });
      }),
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(r);
      }),
  };
}

module.exports = { createHttpServer };
