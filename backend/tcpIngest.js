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
// buffered in memory, so a long recording doesn't blow up RAM), patches the
// WAV header's size fields once the stream ends, then kicks off a DeepFilterNet
// noise-reduction pass on the finished file as a background step, followed by
// a faster-whisper transcription pass - neither blocks new incoming
// connections, since child_process.spawn is async.

const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");
const { addSession, updateSession } = require("./sessionStore");

const HEADER_MAGIC = "NPIN";
const WAV_HEADER_BYTES = 44;

// Invoked via `python -m df.enhance` rather than the `deepFilter` console
// script directly - sidesteps a common Windows issue where pip's Scripts
// folder (holding deepFilter.exe) isn't on PATH, especially with the
// Microsoft Store Python distribution. `python` itself is already on PATH
// if you've been able to run the scripts\*.py files earlier in this project.
const PYTHON_BIN = process.env.PYTHON_BIN || "python";

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

// Runs DeepFilterNet on a finished session's WAV file. Fire-and-forget from
// the caller's point of view - updates the session record when done rather
// than making anything wait. The FIRST call after installing DeepFilterNet
// will be slow (it downloads and caches the model weights); every call
// after that reuses the cached model and runs fully offline.
function runNoiseReduction(session) {
  const cleanDir = path.join(config.RECORDINGS_DIR, "clean");
  if (!fs.existsSync(cleanDir)) fs.mkdirSync(cleanDir, { recursive: true });

  console.log(`[denoise] starting for ${session.id}`);

  const proc = spawn(
    PYTHON_BIN,
    [
      "-m",
      "df.enhance",
      "--output-dir",
      cleanDir,
      "--no-suffix",
      session.filePath,
    ],
    {
      windowsHide: true,
    },
  );

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    process.stderr.write(d); // show progress (e.g. model download) live, not just at the end
  });

  proc.on("close", (code) => {
    const expectedOut = path.join(cleanDir, path.basename(session.filePath));
    // Transcribe whichever audio is actually best: the cleaned version if
    // denoise succeeded, otherwise fall back to the original recording -
    // a transcript from noisy audio is still better than no transcript.
    let transcribeInput = session.filePath;
    if (code === 0 && fs.existsSync(expectedOut)) {
      updateSession(session.id, { processed: true, cleanedPath: expectedOut });
      console.log(`[denoise] done for ${session.id}`);
      transcribeInput = expectedOut;
    } else {
      updateSession(session.id, {
        processed: false,
        processingError: stderr.trim().slice(-500) || `exit code ${code}`,
      });
      console.error(`[denoise] FAILED for ${session.id} (exit ${code})`);
      if (stderr) console.error(stderr.trim().slice(-1000));
    }
    runTranscription(session, transcribeInput);
  });

  proc.on("error", (err) => {
    updateSession(session.id, {
      processed: false,
      processingError: err.message,
    });
    console.error(
      `[denoise] could not start "${PYTHON_BIN}" - is Python on PATH? ${err.message}`,
    );
    // Denoise couldn't even launch - still worth trying to transcribe the
    // original recording rather than giving up on the whole session.
    runTranscription(session, session.filePath);
  });
}

// Runs faster-whisper on the given audio file (the cleaned version when
// available, otherwise the original) and stores the transcript on the
// session. Same fire-and-forget pattern as runNoiseReduction - doesn't
// block new incoming connections. The FIRST call downloads and caches the
// Whisper model (~500MB for the default "small" size); every call after
// that reuses the cached model and runs fully offline.
function runTranscription(session, inputPath) {
  const transcriptDir = path.join(config.RECORDINGS_DIR, "transcripts");
  if (!fs.existsSync(transcriptDir))
    fs.mkdirSync(transcriptDir, { recursive: true });

  const scriptPath = path.join(__dirname, "transcribe.py");
  const outJsonPath = path.join(transcriptDir, `${session.id}.json`);

  console.log(`[transcribe] starting for ${session.id}`);

  const proc = spawn(PYTHON_BIN, [scriptPath, inputPath, outJsonPath], {
    windowsHide: true,
  });

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  proc.on("close", (code) => {
    if (code === 0 && fs.existsSync(outJsonPath)) {
      try {
        const transcript = JSON.parse(fs.readFileSync(outJsonPath, "utf8"));
        updateSession(session.id, {
          transcribed: true,
          transcript,
          transcriptError: null,
        });
        console.log(
          `[transcribe] done for ${session.id} (${transcript.text.length} chars)`,
        );
      } catch (e) {
        updateSession(session.id, {
          transcribed: false,
          transcriptError: `failed to read result: ${e.message}`,
        });
        console.error(
          `[transcribe] FAILED reading result for ${session.id}: ${e.message}`,
        );
      }
    } else {
      updateSession(session.id, {
        transcribed: false,
        transcriptError: stderr.trim().slice(-500) || `exit code ${code}`,
      });
      console.error(`[transcribe] FAILED for ${session.id} (exit ${code})`);
      if (stderr) console.error(stderr.trim().slice(-1000));
    }
  });

  proc.on("error", (err) => {
    updateSession(session.id, {
      transcribed: false,
      transcriptError: err.message,
    });
    console.error(
      `[transcribe] could not start "${PYTHON_BIN}" - is Python on PATH? ${err.message}`,
    );
  });
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
        processed: false,
        cleanedPath: null,
        transcribed: false,
        transcript: null,
        transcriptError: null,
      };
      addSession(session);
      console.log(
        `[ingest] session saved: ${session.id} (${session.durationSec}s, ${bytesWritten} bytes)`,
      );

      runNoiseReduction(session);
    });

    socket.on("error", (err) => {
      console.error(`[ingest] socket error from ${remote}:`, err.message);
    });
  });

  // Bind IPv4 explicitly - the ESP32 only ever connects over IPv4 (mDNS
  // resolves an IPv4 IPAddress, and the secrets.h fallback is a plain
  // IPv4 string), so there's no reason to attempt the default dual-stack
  // "::" bind, which is what was actually failing on Windows here.
  server.listen(config.TCP_PORT, "0.0.0.0", () => {
    console.log(
      `[ingest] listening for NotePin audio on TCP ${config.TCP_PORT} (IPv4)`,
    );
  });

  return server;
}

module.exports = { startTcpIngest };
