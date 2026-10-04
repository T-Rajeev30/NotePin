"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const { HEADER_SIZE, parseHeader, validateHeader } = require("./protocol");
const { WavWriter } = require("./wavWriter");

const defaultLog = (msg) => console.log(`[NotePin] ${msg}`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const normIp = (a) => (a || "unknown").replace(/^::ffff:/, "");
const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

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
      head: Buffer.alloc(0),
      bytes: 0,
      file: null,
      finished: null,
    };
    sessions.add(s);
    const maxBytes = cfg.maxRecordingSeconds * 16000 * 2;
    let paused = false;
    let progress = null;

    function startRecording(hdr) {
      const dir = path.join(
        cfg.recordingsDir,
        new Date().toISOString().slice(0, 10),
      );
      fs.mkdirSync(dir, { recursive: true });
      s.file = path.join(
        dir,
        `NP_${stamp()}_${ip.replace(/[^0-9a-zA-Z.-]/g, "-")}_${id}.wav`,
      );
      s.writer = new WavWriter(s.file, hdr);
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
      if (!s.writer.write(chunk) && !paused) {
        paused = true;
        socket.pause();
        s.writer.onDrain(() => {
          paused = false;
          socket.resume();
        });
      }
    }

    socket.on("data", (chunk) => {
      if (s.writer) return push(chunk);
      s.head = Buffer.concat([s.head, chunk]);
      if (s.head.length < HEADER_SIZE) return;
      const hdr = parseHeader(s.head);
      const bad = validateHeader(hdr);
      if (bad) {
        log(
          `Rejected ${tag}: ${bad} (first bytes: ${s.head.subarray(0, HEADER_SIZE).toString("hex")})`,
        );
        return socket.destroy();
      }
      const rest = s.head.subarray(HEADER_SIZE);
      s.head = null;
      startRecording(hdr);
      if (rest.length) push(rest);
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
