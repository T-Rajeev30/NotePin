"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COOKIE = "np_session";

// Server secret: env NOTEPIN_SECRET, else a random value persisted (0600) in the data dir.
function loadSecret(cfg) {
  if (cfg.secret) return cfg.secret;
  try {
    return fs.readFileSync(cfg.secretFile, "utf8").trim();
  } catch {
    /* create below */
  }
  const s = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(cfg.secretFile), { recursive: true });
  fs.writeFileSync(cfg.secretFile, s, { mode: 0o600 });
  return s;
}

const b64 = (b) => Buffer.from(b).toString("base64url");

// Stateless signed session token: base64url(json).hmac. Carries user id + tokenVersion.
function createTokens(secret, ttlSec) {
  const mac = (body) =>
    crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return {
    ttlSec,
    sign(user) {
      const body = b64(
        JSON.stringify({
          u: user.id,
          v: user.tokenVersion,
          e: Math.floor(Date.now() / 1000) + ttlSec,
        }),
      );
      return `${body}.${mac(body)}`;
    },
    verify(token) {
      const [body, sig] = String(token || "").split(".");
      if (!body || !sig) return null;
      const want = Buffer.from(mac(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got))
        return null;
      try {
        const p = JSON.parse(Buffer.from(body, "base64url").toString());
        return p.e > Date.now() / 1000 ? p : null;
      } catch {
        return null;
      }
    },
  };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0)
      out[part.slice(0, i).trim()] = decodeURIComponent(
        part.slice(i + 1).trim(),
      );
  }
  return out;
}

function sessionCookie(token, { maxAge, secure }) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

// Fixed-window limiter keyed by string (IP, IP+email...). In-memory, per process.
function createLimiter(max, windowMs) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();
  return {
    // Returns seconds to wait if blocked, else 0.
    hit(key) {
      const now = Date.now();
      let v = hits.get(key);
      if (!v || v.reset <= now) {
        v = { n: 0, reset: now + windowMs };
        hits.set(key, v);
      }
      v.n += 1;
      return v.n > max ? Math.ceil((v.reset - now) / 1000) : 0;
    },
    clear: (key) => hits.delete(key),
  };
}

module.exports = {
  COOKIE,
  loadSecret,
  createTokens,
  parseCookies,
  sessionCookie,
  createLimiter,
};
