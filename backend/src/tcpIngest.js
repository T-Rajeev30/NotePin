"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  MAGIC_V2,
  NONCE_SIZE,
  MAC_SIZE,
  headerSizeFor,
  parseHeader,
  validateHeader,
} = require("./protocol");
const { WavWriter } = require("./wavWriter");
const { createTranscriber } = require("./deepgram");
const { loadDevices, verify } = require("./deviceRegistry");
const defaultLog = (msg) => console.log(`[NotePin] ${msg}`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const normIp = (a) => (a || "unknown").replace(/^::ffff:/, "");
const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
const AUTH_TIMEOUT_MS = 5000;

function createIngestServer(cfg, log = defaultLog) {
  const sessions = new Set();
  let seq = 0;
  const server = net.createServer(onConnection);
  server.on("error", (err) => log(`Server error: ${err.code || err.message}`));

  function onConnection(socket) {
    const ip = normIp(socket.remoteAddress);
    const id = ++seq;
    const tag = `#${id} ${ip}`;

    if (cfg.allowedIps.length && !cfg.allowedIps.includes(ip)) {
      log(`Rejected ${tag}: not in NOTEPIN_ALLOWED_IPS`);
      return socket.destroy();
    }
    if (sessions.size >= cfg.maxConnections) {
      log(`Rejected ${tag}: max connections (${cfg.maxConnections}) reached`);
      return socket.destroy();
    }

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);
    socket.setTimeout(cfg.idleTimeoutMs);
    log(`Device connected: ${tag}`);

    const s = {
      id,
      ip,
      socket,
      writer: null,
      stt: null,
      head: Buffer.alloc(0),
      hdr: null, // parsed NPN2 header while waiting for the auth reply
      nonce: null,
      deviceId: null,
      bytes: 0,
      file: null,
      finished: null,
    };
    sessions.add(s);
    const maxBytes = cfg.maxRecordingSeconds * 16000 * 2;
    let paused = false;
    let progress = null;
    let authTimer = null;

    function reject(reason, answer) {
      log(`Rejected ${tag}${s.deviceId ? ` (${s.deviceId})` : ""}: ${reason}`);
      clearTimeout(authTimer);
      s.head = null;
      if (answer) socket.end(answer);
      else socket.destroy();
      setTimeout(() => socket.destroy(), 500).unref();
    }

    function startRecording(hdr) {
      const dir = path.join(
        cfg.recordingsDir,
        new Date().toISOString().slice(0, 10),
      );
      fs.mkdirSync(dir, { recursive: true });
      const who = (s.deviceId || ip).replace(/[^0-9a-zA-Z.-]/g, "-");
      s.file = path.join(dir, `NP_${stamp()}_${who}_${id}.wav`);
      s.writer = new WavWriter(s.file, hdr);
      s.stt = createTranscriber(cfg, s.file.replace(/\.wav$/, ".txt"), log);
      log(
        `Header: sample_rate=${hdr.sampleRate} bits=${hdr.bits} channels=${hdr.channels}`,
      );
      log("Receiving audio...");
      progress = setInterval(() => {
        log(
          `Received: ${kb(s.bytes)} (${(s.bytes / 32000).toFixed(2)} sec) from ${tag}`,
        );
      }, 5000);
    }

    function push(chunk) {
      s.bytes += chunk.length;
      if (s.bytes > maxBytes) {
        log(
          `${tag} exceeded NOTEPIN_MAX_RECORDING_SECONDS=${cfg.maxRecordingSeconds}; closing`,
        );
        return socket.destroy();
      }
      if (s.stt) s.stt.send(chunk);
      if (!s.writer.write(chunk) && !paused) {
        paused = true;
        socket.pause();
        s.writer.onDrain(() => {
          paused = false;
          socket.resume();
        });
      }
    }

    // Step 1: read + validate the stream header (NPIN legacy or NPN2).
    function readHeader() {
      const need = headerSizeFor(s.head);
      if (!need || s.head.length < need) return;
      const hdr = parseHeader(s.head);
      const bad = validateHeader(hdr);
      if (bad) {
        return reject(
          `${bad} (first bytes: ${s.head.subarray(0, need).toString("hex")})`,
        );
      }
      const rest = s.head.subarray(need);

      if (hdr.magic === MAGIC_V2) {
        s.hdr = hdr;
        s.deviceId = hdr.deviceId;
        s.head = rest;
        s.nonce = crypto.randomBytes(NONCE_SIZE);
        socket.write(s.nonce);
        authTimer = setTimeout(() => reject("auth timeout"), AUTH_TIMEOUT_MS);
        return readAuth();
      }

      if (cfg.requireAuth) {
        return reject("legacy NPIN stream not allowed (NOTEPIN_REQUIRE_AUTH)");
      }
      s.head = null;
      startRecording(hdr);
      if (rest.length) push(rest);
    }

    // Step 2 (NPN2): verify HMAC reply, then start recording.
    function readAuth() {
      if (s.head.length < MAC_SIZE) return;
      const mac = s.head.subarray(0, MAC_SIZE);
      const rest = s.head.subarray(MAC_SIZE);
      const res = verify(
        loadDevices(cfg.devicesFile),
        s.hdr.deviceId,
        s.hdr.deviceIdRaw,
        s.nonce,
        mac,
      );
      if (!res.ok) return reject(res.reason, Buffer.from([0]));
      clearTimeout(authTimer);
      socket.write(Buffer.from([1]));
      log(`Device authenticated: ${s.deviceId}`);
      s.head = null;
      startRecording(s.hdr);
      if (rest.length) push(rest);
    }

    socket.on("data", (chunk) => {
      if (s.writer) return push(chunk);
      if (!s.head) return; // rejected; ignore trailing bytes
      s.head = Buffer.concat([s.head, chunk]);
      return s.hdr ? readAuth() : readHeader();
    });

    socket.on("timeout", () => {
      log(`${tag} idle for ${cfg.idleTimeoutMs} ms; closing`);
      socket.destroy();
    });
    socket.on("error", (err) =>
      log(`Socket error ${tag}: ${err.code || err.message}`),
    );

    s.finished = new Promise((resolve) => {
      socket.on("close", async () => {
        clearInterval(progress);
        clearTimeout(authTimer);
        sessions.delete(s);
        try {
          if (s.writer) {
            const dataBytes = await s.writer.close();
            if (dataBytes === 0) {
              fs.unlinkSync(s.file);
              log("No audio received; empty file removed");
            } else {
              log(`Received: ${kb(dataBytes)}`);
              log(`Duration: ${(dataBytes / 32000).toFixed(2)} sec`);
              log(`Saved: ${path.relative(process.cwd(), s.file) || s.file}`);
            }
          }
        } catch (err) {
          log(`Failed to finalize WAV for ${tag}: ${err.message}`);
        }
        try {
          if (s.stt) await s.stt.close();
        } catch (err) {
          log(`Transcriber close failed for ${tag}: ${err.message}`);
        }
        log(`Device disconnected: ${tag}`);
        resolve();
      });
    });
  }

  return {
    server,
    sessions,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(cfg.port, cfg.host, () => {
          server.removeListener("error", reject);
          const a = server.address();
          log(`TCP server listening on ${a.address}:${a.port}`);
          if (cfg.requireAuth)
            log("Auth required: legacy NPIN streams are rejected");
          resolve(a);
        });
      }),
    // Stops accepting, ends live streams, waits for every WAV to be finalized.
    stop: async () => {
      const pending = [...sessions].map((s) => {
        s.socket.end();
        setTimeout(() => s.socket.destroy(), 1000).unref();
        return s.finished;
      });
      await new Promise((r) => server.close(r));
      await Promise.all(pending);
    },
  };
}

module.exports = { createIngestServer };
