"use strict";
// NPIN header, 12 bytes (firmware memcpy on little-endian ESP32-S3):
//   [0..3] "NPIN"  [4..7] u32 LE sample rate  [8..9] u16 LE bits  [10..11] u16 LE channels
const HEADER_SIZE = 12;
const MAGIC = "NPIN";
const SUPPORTED = { sampleRate: 16000, bits: 16, channels: 1 };

function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) throw new Error("short header");
  return {
    magic: buf.toString("ascii", 0, 4),
    sampleRate: buf.readUInt32LE(4),
    bits: buf.readUInt16LE(8),
    channels: buf.readUInt16LE(10),
  };
}

// Returns null if valid, otherwise a reason string.
function validateHeader(h) {
  if (h.magic !== MAGIC) return `bad magic ${JSON.stringify(h.magic)}`;
  if (h.sampleRate !== SUPPORTED.sampleRate)
    return `unsupported sample_rate=${h.sampleRate}`;
  if (h.bits !== SUPPORTED.bits) return `unsupported bits=${h.bits}`;
  if (h.channels !== SUPPORTED.channels)
    return `unsupported channels=${h.channels}`;
  return null;
}

module.exports = { HEADER_SIZE, MAGIC, SUPPORTED, parseHeader, validateHeader };
