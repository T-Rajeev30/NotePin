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

function load() {
  loadEnvFile(path.join(__dirname, "..", ".env"));
  const e = process.env;
  const int = (k, d) =>
    Number.isFinite(parseInt(e[k], 10)) ? parseInt(e[k], 10) : d;
  return {
    host: e.NOTEPIN_TCP_HOST || "0.0.0.0",
    port: int("NOTEPIN_TCP_PORT", 5000),
    recordingsDir: path.resolve(
      e.NOTEPIN_RECORDINGS_DIR || path.join(__dirname, "..", "recordings"),
    ),
    maxConnections: int("NOTEPIN_MAX_CONNECTIONS", 8),
    maxRecordingSeconds: int("NOTEPIN_MAX_RECORDING_SECONDS", 1800),
    idleTimeoutMs: int("NOTEPIN_IDLE_TIMEOUT_MS", 15000),
    deepgramKey: e.DEEPGRAM_API_KEY || "",
    deepgramModel: e.DEEPGRAM_MODEL || "nova-3",
    deepgramLanguage: e.DEEPGRAM_LANGUAGE || "multi",
    requireAuth: ["1", "true", "yes"].includes(
      String(e.NOTEPIN_REQUIRE_AUTH || "").toLowerCase(),
    ),
    devicesFile: path.resolve(
      e.NOTEPIN_DEVICES_FILE ||
        path.join(__dirname, "..", "data", "devices.json"),
    ),
    allowedIps: (e.NOTEPIN_ALLOWED_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

module.exports = { load };
