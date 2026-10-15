"use strict";
const crypto = require("crypto");

// Pairing codes: 12 characters from a 32-letter alphabet without look-alikes (no 0/O/1/I),
// the last one a check character, so a typo is caught before a device is registered.
// The device shows the code during setup; the key is derived from it on both sides,
// so no secret ever has to be sent from the server to the device.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LEN = 12;

function checkChar(body) {
  let s = 0;
  for (let i = 0; i < body.length; i++)
    s += (ALPHABET.indexOf(body[i]) + 1) * (i + 1);
  return ALPHABET[s % ALPHABET.length];
}

// "k7q2-m9xd-4trb" / "K7Q2 M9XD 4TRB" -> "K7Q2M9XD4TRB", or '' when it cannot be a valid code.
function normalize(input) {
  const c = String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (c.length !== LEN) return "";
  for (const ch of c) if (!ALPHABET.includes(ch)) return "";
  return checkChar(c.slice(0, LEN - 1)) === c[LEN - 1] ? c : "";
}

// MUST match the firmware (pairing.h): HMAC-SHA256(key = code, msg = "notepin-key-v1|" + deviceId), first 32 hex chars.
function deriveKey(code, deviceId) {
  return crypto
    .createHmac("sha256", code)
    .update(`notepin-key-v1|${deviceId}`)
    .digest("hex")
    .slice(0, 32);
}

function generate() {
  let body = "";
  for (let i = 0; i < LEN - 1; i++)
    body += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return body + checkChar(body);
}

const format = (code) => code.replace(/(.{4})(?=.)/g, "$1-");

module.exports = {
  ALPHABET,
  normalize,
  deriveKey,
  generate,
  format,
  checkChar,
};
