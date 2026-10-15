"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Async scrypt so hashing never blocks the audio ingest event loop.
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(pw, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

async function verifyPassword(pw, stored) {
  const [alg, n, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt") return false;
  const want = Buffer.from(hash || "", "base64");
  if (!want.length) return false;
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, {
    N: parseInt(n, 10) || N,
    r: 8,
    p: 1,
  });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// users.json: { users: { <id>: {...} }, invites: { <code>: {...} } }
function createUserStore(file) {
  const read = () => {
    try {
      const d = JSON.parse(fs.readFileSync(file, "utf8"));
      return { users: d.users || {}, invites: d.invites || {} };
    } catch {
      return { users: {}, invites: {} };
    }
  };
  const write = (d) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const pub = (u) =>
    u && {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
    };

  return {
    EMAIL_RE,
    count: () => Object.keys(read().users).length,
    byId: (id) => read().users[id] || null,
    byEmail: (email) =>
      Object.values(read().users).find(
        (u) => u.email === String(email).toLowerCase(),
      ) || null,
    list: () => Object.values(read().users).map(pub),
    pub,

    async create({ email, name, password, role = "user" }) {
      email = String(email || "")
        .trim()
        .toLowerCase();
      if (!EMAIL_RE.test(email))
        throw Object.assign(new Error("Enter a valid email address"), {
          status: 400,
        });
      if (String(password || "").length < 10)
        throw Object.assign(
          new Error("Password must be at least 10 characters"),
          { status: 400 },
        );
      const passHash = await hashPassword(password);
      const d = read();
      if (Object.values(d.users).some((u) => u.email === email))
        throw Object.assign(new Error("That email is already registered"), {
          status: 409,
        });
      const id = `usr_${crypto.randomBytes(8).toString("hex")}`;
      d.users[id] = {
        id,
        email,
        name: String(name || email.split("@")[0])
          .trim()
          .slice(0, 60),
        role,
        passHash,
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
      };
      write(d);
      return d.users[id];
    },

    async setPassword(id, password) {
      if (String(password || "").length < 10)
        throw Object.assign(
          new Error("Password must be at least 10 characters"),
          { status: 400 },
        );
      const passHash = await hashPassword(password);
      const d = read();
      if (!d.users[id])
        throw Object.assign(new Error("No such user"), { status: 404 });
      d.users[id].passHash = passHash;
      d.users[id].tokenVersion += 1; // signs out every other session
      write(d);
      return d.users[id];
    },

    verifyPassword,
    hashPassword,

    // --- invites (single use) ---
    createInvite(createdBy) {
      const d = read();
      const code = crypto.randomBytes(9).toString("base64url");
      d.invites[code] = {
        code,
        createdBy,
        createdAt: new Date().toISOString(),
        usedBy: null,
      };
      write(d);
      return d.invites[code];
    },
    listInvites: () => Object.values(read().invites).filter((i) => !i.usedBy),
    revokeInvite(code) {
      const d = read();
      const had = delete d.invites[code];
      write(d);
      return had;
    },
    consumeInvite(code, userId) {
      const d = read();
      const inv = d.invites[code];
      if (!inv || inv.usedBy) return false;
      inv.usedBy = userId;
      write(d);
      return true;
    },
    hasInvite: (code) => {
      const i = read().invites[code];
      return !!i && !i.usedBy;
    },
  };
}

module.exports = { createUserStore, hashPassword, verifyPassword };
