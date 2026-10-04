"use strict";
const fs = require("fs");
const fsp = fs.promises;
const WAV_HEADER_SIZE = 44;

function wavHeader(dataBytes, sampleRate, bits, channels) {
  const b = Buffer.alloc(WAV_HEADER_SIZE);
  const blockAlign = (channels * bits) / 8;
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * blockAlign, 28);
  b.writeUInt16LE(blockAlign, 32);
  b.writeUInt16LE(bits, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(dataBytes, 40);
  return b;
}

// Streams PCM straight to disk; header is patched on close().
class WavWriter {
  constructor(file, { sampleRate, bits, channels }) {
    this.file = file;
    this.fmt = { sampleRate, bits, channels };
    this.frameBytes = (channels * bits) / 8;
    this.dataBytes = 0;
    this.carry = Buffer.alloc(0); // keeps writes aligned to whole frames
    this.out = fs.createWriteStream(file, { flags: "w" });
    this.out.write(wavHeader(0, sampleRate, bits, channels));
    this.out.on("error", () => {});
  }

  // Returns false when the caller should wait for 'drain'.
  write(chunk) {
    const buf = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const usable = buf.length - (buf.length % this.frameBytes);
    this.carry =
      usable < buf.length ? Buffer.from(buf.subarray(usable)) : Buffer.alloc(0);
    if (usable === 0) return true;
    this.dataBytes += usable;
    return this.out.write(
      usable === buf.length ? buf : buf.subarray(0, usable),
    );
  }

  onDrain(fn) {
    this.out.once("drain", fn);
  }

  async close() {
    await new Promise((res, rej) => {
      this.out.once("error", rej);
      this.out.end(res);
    });
    const fh = await fsp.open(this.file, "r+");
    try {
      const { sampleRate, bits, channels } = this.fmt;
      await fh.write(
        wavHeader(this.dataBytes, sampleRate, bits, channels),
        0,
        WAV_HEADER_SIZE,
        0,
      );
    } finally {
      await fh.close();
    }
    return this.dataBytes;
  }
}

module.exports = { WavWriter, wavHeader, WAV_HEADER_SIZE };
