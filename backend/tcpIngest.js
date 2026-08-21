// Raw TCP audio ingest - mirrors the protocol already proven with
// scripts/stream_receiver.py:
//   1. ESP32 connects and sends a 12-byte header:
//        bytes 0-3   "NPIN" magic
//        bytes 4-7   sample rate, uint32 LE
//        bytes 8-9   bits per sample, uint16 LE
//        bytes 10-11 channel count, uint16 LE
//   2. Raw little-endian PCM follows until the ESP32 disconnects (that's
//      how the device signals "session ended" - see wifi_stream.ino).
//
// This writes each session straight to a WAV file on disk (streaming, not
// buffered in memory, so a long recording doesn't blow up RAM) and patches
// the WAV header's size fields once the stream ends and the true length
// is known.

const net = require("net");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { addSession } = require("./sessionStore");

const HEADER_MAGIC = "NPIN";
const WAV_HEADER_BYTES = 44;

function writeWavHeader(fd, sampleRate, bitsPerSample, channels) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(WAV_HEADER_BYTES);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(0, 4); // ChunkSize - patched at close
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(0, 40); // Subchunk2Size - patched at close

  fs.writeSync(fd, header, 0, WAV_HEADER_BYTES, 0);
}

function patchWavHeader(filePath, dataBytes) {
  const fd = fs.openSync(filePath, "r+");

  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(36 + dataBytes, 0);
  fs.writeSync(fd, chunkSize, 0, 4, 4);

  const subchunk2Size = Buffer.alloc(4);
  subchunk2Size.writeUInt32LE(dataBytes, 0);
  fs.writeSync(fd, subchunk2Size, 0, 4, 40);

  fs.closeSync(fd);
}

function startTcpIngest() {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[ingest] connection from ${remote}`);

    let headerBuf = Buffer.alloc(0);
    let gotHeader = false;
    let fd = null;
    let filePath = null;
    let bytesWritten = 0;
    let sampleRate = 0,
      bits = 0,
      channels = 0;
    const startedAt = new Date().toISOString();

    socket.on("data", (chunk) => {
      if (!gotHeader) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length < 12) return; // wait for the rest of the header

        const magic = headerBuf.toString("ascii", 0, 4);
        if (magic !== HEADER_MAGIC) {
          console.error(
            `[ingest] bad magic "${magic}" from ${remote} - dropping connection`,
          );
          socket.destroy();
          return;
        }
        sampleRate = headerBuf.readUInt32LE(4);
        bits = headerBuf.readUInt16LE(8);
        channels = headerBuf.readUInt16LE(10);
        gotHeader = true;

        const ts = startedAt.replace(/[:.]/g, "-");
        const fileName = `notepin_${ts}.wav`;
        filePath = path.join(config.RECORDINGS_DIR, fileName);
        fd = fs.openSync(filePath, "w");
        writeWavHeader(fd, sampleRate, bits, channels);

        console.log(
          `[ingest] ${remote} format ${sampleRate}Hz/${bits}-bit/${channels}ch -> ${fileName}`,
        );

        // anything after byte 12 in this same chunk is already audio data
        const leftover = headerBuf.subarray(12);
        if (leftover.length > 0) {
          fs.writeSync(
            fd,
            leftover,
            0,
            leftover.length,
            WAV_HEADER_BYTES + bytesWritten,
          );
          bytesWritten += leftover.length;
        }
        return;
      }

      fs.writeSync(fd, chunk, 0, chunk.length, WAV_HEADER_BYTES + bytesWritten);
      bytesWritten += chunk.length;
    });

    socket.on("close", () => {
      if (!gotHeader || fd === null) {
        console.log(
          `[ingest] ${remote} disconnected before sending a valid header`,
        );
        return;
      }
      fs.closeSync(fd);
      patchWavHeader(filePath, bytesWritten);

      const durationSec =
        channels && bits && sampleRate
          ? bytesWritten / (sampleRate * channels * (bits / 8))
          : 0;

      const session = {
        id: path.basename(filePath, ".wav"),
        deviceAddr: remote,
        sampleRate,
        bits,
        channels,
        filePath,
        startedAt,
        endedAt: new Date().toISOString(),
        durationSec: Number(durationSec.toFixed(2)),
        bytesReceived: bytesWritten,
      };
      addSession(session);
      console.log(
        `[ingest] session saved: ${session.id} (${session.durationSec}s, ${bytesWritten} bytes)`,
      );
    });

    socket.on("error", (err) => {
      console.error(`[ingest] socket error from ${remote}:`, err.message);
    });
  });

  server.listen(config.TCP_PORT, () => {
    console.log(
      `[ingest] listening for NotePin audio on TCP ${config.TCP_PORT}`,
    );
  });

  return server;
}

module.exports = { startTcpIngest };
