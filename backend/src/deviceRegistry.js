"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Registry file: { "NP-EA62F2A0": { "key": "<32 hex>", "name": "...", "createdAt": "...", "revoked": false } }
// Re-read on every handshake, so adding/revoking a device needs no server restart.
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
  fs.writeFileSync(file, JSON.stringify(devices, null, 2), { mode: 0o600 });
}

const newKey = () => crypto.randomBytes(16).toString("hex");

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

module.exports = { loadDevices, saveDevices, newKey, computeMac, verify };
