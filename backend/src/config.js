"use strict";
const fs = require("fs");
const path = require("path");

// Minimal .env loader (no dependency). Real env vars win over the file.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env))
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const truthy = (v) =>
  ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

function load() {
  loadEnvFile(path.join(__dirname, "..", ".env"));
  const e = process.env;
  const int = (k, d) =>
    Number.isFinite(parseInt(e[k], 10)) ? parseInt(e[k], 10) : d;
  const dataDir = path.resolve(
    e.NOTEPIN_DATA_DIR || path.join(__dirname, "..", "data"),
  );
  const signup = String(e.NOTEPIN_SIGNUP || "invite").toLowerCase();
  return {
    // --- device ingest (TCP) ---
    host: e.NOTEPIN_TCP_HOST || "0.0.0.0",
    port: int("NOTEPIN_TCP_PORT", 5000),
    maxConnections: int("NOTEPIN_MAX_CONNECTIONS", 8),
    maxRecordingSeconds: int("NOTEPIN_MAX_RECORDING_SECONDS", 7200),
    idleTimeoutMs: int("NOTEPIN_IDLE_TIMEOUT_MS", 15000),
    requireAuth: truthy(e.NOTEPIN_REQUIRE_AUTH),
    allowedIps: (e.NOTEPIN_ALLOWED_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),

    // --- storage (JSON files; audio is NOT kept unless storeAudio) ---
    dataDir,
    devicesFile: path.resolve(
      e.NOTEPIN_DEVICES_FILE || path.join(dataDir, "devices.json"),
    ),
    usersFile: path.join(dataDir, "users.json"),
    transcriptsDir: path.join(dataDir, "transcripts"),
    secretFile: path.join(dataDir, "secret.key"),
    storeAudio: truthy(e.NOTEPIN_STORE_AUDIO),
    recordingsDir: path.resolve(
      e.NOTEPIN_RECORDINGS_DIR || path.join(__dirname, "..", "recordings"),
    ),
    retentionDays: int("NOTEPIN_RETENTION_DAYS", 0), // 0 = keep forever

    // --- speech-to-text ---
    deepgramKey: e.DEEPGRAM_API_KEY || "",
    deepgramModel: e.DEEPGRAM_MODEL || "nova-3",
    deepgramLanguage: e.DEEPGRAM_LANGUAGE || "en",

    // --- notes (Claude) ---
    anthropicKey: e.ANTHROPIC_API_KEY || "",
    anthropicUrl:
      e.NOTEPIN_ANTHROPIC_URL || "https://api.anthropic.com/v1/messages",
    notesModel: e.NOTEPIN_NOTES_MODEL || "claude-sonnet-5-5",
    notesMinChars: int("NOTEPIN_NOTES_MIN_CHARS", 40),

    // --- dashboard / API (HTTP) ---
    httpHost: e.NOTEPIN_HTTP_HOST || "0.0.0.0",
    httpPort: int("NOTEPIN_HTTP_PORT", 8080),
    dashboardDir: path.resolve(
      e.NOTEPIN_DASHBOARD_DIR ||
        path.join(__dirname, "..", "..", "dashboard", "dist"),
    ),
    signup: ["open", "invite", "closed"].includes(signup) ? signup : "invite",
    cookieSecure: truthy(e.NOTEPIN_COOKIE_SECURE),
    sessionDays: int("NOTEPIN_SESSION_DAYS", 7),
    secret: e.NOTEPIN_SECRET || "",
  };
}

module.exports = { load, truthy };
