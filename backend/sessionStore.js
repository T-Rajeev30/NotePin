// Simple JSON-file-backed session store.
//
// Deliberately NOT a database yet - avoids native build tooling (SQLite's
// better-sqlite3 needs node-gyp/Visual Studio Build Tools, which is real
// friction on a fresh Windows machine). This module is the ONLY place that
// knows the storage format, so swapping to SQLite/Postgres later is a
// rewrite of this one file, not a rewrite of the API or ingest code.

const fs = require("fs");
const config = require("./config");

function ensureStore() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(config.RECORDINGS_DIR)) {
    fs.mkdirSync(config.RECORDINGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(config.SESSIONS_FILE)) {
    fs.writeFileSync(config.SESSIONS_FILE, "[]");
  }
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(config.SESSIONS_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("sessions.json is corrupted, starting fresh:", e.message);
    return [];
  }
}

function writeAll(sessions) {
  ensureStore();
  fs.writeFileSync(config.SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function addSession(session) {
  const sessions = readAll();
  sessions.push(session);
  writeAll(sessions);
  return session;
}

function listSessions() {
  return readAll().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function getSession(id) {
  return readAll().find((s) => s.id === id) || null;
}

module.exports = { ensureStore, addSession, listSessions, getSession };
