"use strict";
const fs = require("fs");

// Live speech-to-text over Deepgram's streaming WebSocket (Node 22+ global WebSocket).
// Returns null when no API key is configured. Never throws into the recording path.
function createTranscriber(cfg, txtPath, log) {
  if (!cfg.deepgramKey) return null;

  const q = new URLSearchParams({
    model: cfg.deepgramModel,
    language: cfg.deepgramLanguage,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    endpointing: "300",
  });

  let ws;
  let open = false;
  let dead = false;
  let queued = 0;
  const queue = [];
  const MAX_QUEUE = 16000 * 2 * 5; // buffer up to 5 s while the socket opens
  const out = fs.createWriteStream(txtPath, { flags: "a" });

  const fail = (why) => {
    if (dead) return;
    dead = true;
    log(`Deepgram disabled for this session: ${why}`);
  };

  try {
    ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, [
      "token",
      cfg.deepgramKey,
    ]);
  } catch (err) {
    fail(err.message);
    out.end();
    return null;
  }

  const closed = new Promise((resolve) =>
    ws.addEventListener("close", (ev) => {
      if (!open && !dead)
        fail(`connection refused (code ${ev.code}) - check DEEPGRAM_API_KEY`);
      open = false;
      resolve();
    }),
  );

  ws.addEventListener("open", () => {
    open = true;
    log("Deepgram connected");
    for (const c of queue) ws.send(c);
    queue.length = 0;
  });
  ws.addEventListener("error", () => fail("websocket error"));
  ws.addEventListener("message", (ev) => {
    let m;
    try {
      m = JSON.parse(
        typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString(),
      );
    } catch {
      return;
    }
    if (m.type !== "Results" || !m.is_final) return;
    const text = m.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;
    log(`Transcript: ${text}`);
    out.write(`${text}\n`);
  });

  return {
    send(chunk) {
      if (dead) return;
      if (open) return ws.send(chunk);
      if (queued + chunk.length <= MAX_QUEUE) {
        queue.push(Buffer.from(chunk));
        queued += chunk.length;
      }
    },
    async close() {
      if (open) {
        try {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          /* ignore */
        }
        await Promise.race([closed, new Promise((r) => setTimeout(r, 4000))]);
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      await new Promise((r) => out.end(r));
      try {
        if (fs.statSync(txtPath).size === 0) fs.unlinkSync(txtPath);
        else log(`Transcript saved: ${txtPath}`);
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { createTranscriber };
