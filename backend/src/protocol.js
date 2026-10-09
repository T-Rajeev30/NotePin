"use strict";
// Two stream headers, both little-endian (ESP32-S3 memcpy):
//
//  NPIN (legacy, 12 bytes, no auth):
//    [0..3] "NPIN"  [4..7] u32 sample rate  [8..9] u16 bits  [10..11] u16 channels
//
//  NPN2 (28 bytes, authenticated):
//    [0..11] same as above but magic "NPN2"
//    [12..27] device id, ASCII, NUL padded (16 bytes)
//    then: server -> 16-byte nonce, device -> HMAC-SHA256(key, nonce || deviceId16) (32 bytes),
//          server -> 1 byte (0x01 accepted / 0x00 rejected), then raw PCM.
const HEADER_SIZE = 12;
const HEADER_V2_SIZE = 28;
const MAGIC = "NPIN";
const MAGIC_V2 = "NPN2";
const NONCE_SIZE = 16;
const MAC_SIZE = 32;
const SUPPORTED = { sampleRate: 16000, bits: 16, channels: 1 };

// Bytes needed before the header can be parsed; 0 = need at least 4 bytes first.
function headerSizeFor(buf) {
  if (buf.length < 4) return 0;
  return buf.toString("ascii", 0, 4) === MAGIC_V2
    ? HEADER_V2_SIZE
    : HEADER_SIZE;
}

function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) throw new Error("short header");
  const magic = buf.toString("ascii", 0, 4);
  const h = {
    magic,
    sampleRate: buf.readUInt32LE(4),
    bits: buf.readUInt16LE(8),
    channels: buf.readUInt16LE(10),
    deviceId: null,
    deviceIdRaw: null,
  };
  if (magic === MAGIC_V2 && buf.length >= HEADER_V2_SIZE) {
    h.deviceIdRaw = Buffer.from(buf.subarray(12, 28));
    h.deviceId = h.deviceIdRaw.toString("ascii").replace(/\0+$/, "");
  }
  return h;
}

// Returns null if valid, otherwise a human-readable reason.
function validateHeader(h) {
  if (h.magic !== MAGIC && h.magic !== MAGIC_V2)
    return `bad magic ${JSON.stringify(h.magic)}`;
  if (h.sampleRate !== SUPPORTED.sampleRate)
    return `unsupported sample_rate=${h.sampleRate}`;
  if (h.bits !== SUPPORTED.bits) return `unsupported bits=${h.bits}`;
  if (h.channels !== SUPPORTED.channels)
    return `unsupported channels=${h.channels}`;
  if (h.magic === MAGIC_V2 && !/^[A-Za-z0-9._-]{1,16}$/.test(h.deviceId || ""))
    return "bad device id";
  return null;
}

module.exports = {
  HEADER_SIZE,
  HEADER_V2_SIZE,
  MAGIC,
  MAGIC_V2,
  NONCE_SIZE,
  MAC_SIZE,
  SUPPORTED,
  headerSizeFor,
  parseHeader,
  validateHeader,
};
