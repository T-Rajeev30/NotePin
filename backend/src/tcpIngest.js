"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");
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
const { loadDevices, updateDevices, verify } = require("./devices");
const { createDecoder } = require("./adpcm");
const { createRecordings } = require("./recordings");
const { createNotes } = require("./notes");
const { createPipeline } = require("./pipeline");

const defaultLog = (msg) => console.log(`[NotePin] ${msg}`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const normIp = (a) => (a || "unknown").replace(/^::ffff:/, "");
const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
const AUTH_TIMEOUT_MS = 5000;
const RATE = 16000;
const MAX_SKIP_SAMPLES = RATE * 600; // a single silence run may not claim more than 10 min

// deps (all optional, injected by index.js / tests): bus, recordings, pipeline, presence, createTranscriber
function createIngestServer(cfg, log = defaultLog, deps = {}) {
  const bus = deps.bus || new EventEmitter();
  const recordings = deps.recordings || createRecordings(cfg, log);
  const pipeline =
    deps.pipeline ||
    createPipeline({
      cfg,
      recordings,
      notes: deps.notes || createNotes(cfg, log),
      bus,
      log,
    });
  const presence = deps.presence || new Map(); // deviceId -> { sid, since, ip, ownerId }
  const makeStt = deps.createTranscriber || createTranscriber;

  const sessions = new Set();
  let seq = 0;
  const server = net.createServer(onConnection);
  server.on("error", (err) => log(`Server error: ${err.code || err.message}`));

  const touchDevice = (id, ip) => {
    try {
      updateDevices(cfg.devicesFile, (d) => {
        if (d[id]) {
          d[id].lastSeenAt = new Date().toISOString();
          d[id].lastSeenIp = ip;
        }
      });
    } catch (err) {
      log(`Could not update lastSeen for ${id}: ${err.message}`);
    }
  };

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
      rec: null,
      decoder: null,
      head: Buffer.alloc(0),
      hdr: null, // parsed NPN2 header while waiting for the auth reply
      nonce: null,
      deviceId: null,
      ownerId: null,
      bytes: 0, // wire bytes
      samples: 0, // decoded + skipped (= real recording length)
      fed: 0, // samples sent to speech-to-text
      skips: [], // [{ atFed, total }] cumulative skipped samples, for timeline mapping
      file: null,
      finished: null,
    };
    sessions.add(s);
    const maxSamples = cfg.maxRecordingSeconds * RATE;
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

    // Maps seconds of fed audio -> seconds of real recording time (re-inserting VAD-skipped silence).
    function realTime(fedSec) {
      let skipped = 0;
      const fedSamples = fedSec * RATE;
      for (const k of s.skips) {
        if (k.atFed <= fedSamples) skipped = k.total;
        else break;
      }
      return Math.round((fedSec + skipped / RATE) * 100) / 100;
    }

    function onSegment(seg) {
      if (!s.rec) return;
      const out = {
        start: realTime(seg.start),
        end: realTime(seg.end),
        text: seg.text,
      };
      s.rec.segments.push(out);
      bus.emit("event", {
        type: "recording.segment",
        ownerId: s.ownerId,
        recordingId: s.rec.id,
        deviceId: s.rec.deviceId,
        segment: out,
      });
    }

    function onPcm(pcm) {
      s.samples += pcm.length / 2;
      s.fed += pcm.length / 2;
      if (s.stt) s.stt.send(pcm);
      if (s.writer && !s.writer.write(pcm) && !paused) {
        paused = true;
        socket.pause();
        s.writer.onDrain(() => {
          paused = false;
          socket.resume();
        });
      }
    }

    function onSkip(n) {
      if (n > MAX_SKIP_SAMPLES)
        throw new Error(`silence run too long (${n} samples)`);
      s.samples += n;
      s.skips.push({ atFed: s.fed, total: (s.skips.at(-1)?.total || 0) + n });
      if (s.writer) {
        for (let left = n * 2; left > 0; left -= 65536)
          s.writer.write(Buffer.alloc(Math.min(left, 65536)));
      }
    }

    function startRecording(hdr) {
      const codec = hdr.bits === 4 ? "adpcm" : "pcm16";
      s.rec = recordings.begin({
        deviceId: s.deviceId || "legacy",
        ownerId: s.ownerId,
        codec,
      });
      s.decoder = createDecoder(hdr.bits, { onPcm, onSkip });
      s.stt = makeStt(cfg, log, onSegment);

      if (cfg.storeAudio) {
        const dir = path.join(
          cfg.recordingsDir,
          new Date().toISOString().slice(0, 10),
        );
        fs.mkdirSync(dir, { recursive: true });
        const who = (s.deviceId || ip).replace(/[^0-9a-zA-Z.-]/g, "-");
        s.file = path.join(dir, `NP_${stamp()}_${who}_${id}.wav`);
        s.writer = new WavWriter(s.file, { ...hdr, bits: 16 });
      }
      log(
        `Header: sample_rate=${hdr.sampleRate} bits=${hdr.bits} channels=${hdr.channels} codec=${codec}`,
      );
      log("Receiving audio...");
      bus.emit("event", {
        type: "recording.start",
        ownerId: s.ownerId,
        recording: recordings.summary(s.rec),
      });
      progress = setInterval(() => {
        log(
          `Received: ${kb(s.bytes)} (${(s.samples / RATE).toFixed(2)} sec) from ${tag}`,
        );
      }, 5000);
    }

    function push(chunk) {
      s.bytes += chunk.length;
      try {
        s.decoder.push(chunk);
      } catch (err) {
        log(`${tag} stream error: ${err.message}; closing`);
        return socket.destroy();
      }
      if (s.samples > maxSamples) {
        log(
          `${tag} exceeded NOTEPIN_MAX_RECORDING_SECONDS=${cfg.maxRecordingSeconds}; closing`,
        );
        socket.destroy();
      }
    }

    function markOnline() {
      const d = loadDevices(cfg.devicesFile)[s.deviceId];
      s.ownerId = d?.ownerId || null;
      presence.set(s.deviceId, {
        sid: id,
        since: Date.now(),
        ip,
        ownerId: s.ownerId,
      });
      touchDevice(s.deviceId, ip);
      bus.emit("event", {
        type: "device.online",
        ownerId: s.ownerId,
        deviceId: s.deviceId,
        ip,
      });
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
      markOnline();
      startRecording(s.hdr);
      if (rest.length) push(rest);
    }

    socket.on("data", (chunk) => {
      if (s.decoder) return push(chunk);
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
            } else {
              log(
                `Saved audio: ${path.relative(process.cwd(), s.file) || s.file}`,
              );
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
        try {
          if (s.rec) {
            log(
              `Received: ${kb(s.bytes)} wire, ${(s.samples / RATE).toFixed(2)} sec`,
            );
            if (!pipeline.finish(s.rec, s.samples / RATE))
              log("No speech transcribed; nothing stored");
          }
        } catch (err) {
          log(`Failed to store transcript for ${tag}: ${err.message}`);
        }
        if (s.deviceId && s.rec) {
          if (presence.get(s.deviceId)?.sid === id) presence.delete(s.deviceId);
          touchDevice(s.deviceId, ip);
          bus.emit("event", {
            type: "device.offline",
            ownerId: s.ownerId,
            deviceId: s.deviceId,
          });
        }
        log(`Device disconnected: ${tag}`);
        resolve();
      });
    });
  }

  return {
    server,
    sessions,
    bus,
    recordings,
    pipeline,
    presence,
    // Drops live streams of one device (used when its key is rotated / it is revoked or removed).
    disconnect: (deviceId) => {
      for (const s of sessions) if (s.deviceId === deviceId) s.socket.destroy();
    },
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
    // Stops accepting, ends live streams, waits for every transcript to be stored.
    stop: async () => {
      const pending = [...sessions].map((s) => {
        s.socket.end();
        setTimeout(() => s.socket.destroy(), 1000).unref();
        return s.finished;
      });
      await new Promise((r) => server.close(r));
      await Promise.all(pending);
      await Promise.race([
        pipeline.idle(),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
    },
  };
}

module.exports = { createIngestServer };
