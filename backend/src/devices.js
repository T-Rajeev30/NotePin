"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Registry file:
//   { "NP-EA62F2A0": { key, name, ownerId, createdAt, revoked, lastSeenAt, lastSeenIp } }
// Re-read on every handshake and API call (never cached), so the CLI, the dashboard and the
// ingest server can all edit it without restarts. Writes are atomic (tmp + rename).
function loadDevices(file) {
  if (!file || !fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveDevices(file, devices) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(devices, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Read-modify-write helper; fn may mutate and/or return a value.
function updateDevices(file, fn) {
  const devices = loadDevices(file);
  const out = fn(devices);
  saveDevices(file, devices);
  return out;
}

const newKey = () => crypto.randomBytes(16).toString("hex");
const DEVICE_ID_RE = /^[A-Za-z0-9._-]{1,16}$/;

// MAC = HMAC-SHA256(key as ASCII, nonce || 16-byte padded device id)
function computeMac(key, nonce, deviceIdRaw) {
  return crypto
    .createHmac("sha256", Buffer.from(key, "ascii"))
    .update(Buffer.concat([nonce, deviceIdRaw]))
    .digest();
}

// Returns { ok, reason }. Unknown and revoked devices are indistinguishable to the device.
function verify(devices, deviceId, deviceIdRaw, nonce, mac) {
  const d = Object.prototype.hasOwnProperty.call(devices, deviceId)
    ? devices[deviceId]
    : null;
  if (!d) return { ok: false, reason: "unknown device" };
  if (d.revoked) return { ok: false, reason: "device revoked" };
  const want = computeMac(d.key, nonce, deviceIdRaw);
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want))
    return { ok: false, reason: "bad key" };
  return { ok: true };
}

module.exports = {
  loadDevices,
  saveDevices,
  updateDevices,
  newKey,
  computeMac,
  verify,
  DEVICE_ID_RE,
};
