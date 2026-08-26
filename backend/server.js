// NotePin backend entry point - starts both the audio ingest (raw TCP,
// same protocol as scripts/stream_receiver.py) and the REST API (for
// browsing recorded sessions, and for the Phase 5 web app later).

const express = require("express");
const path = require("path");
const config = require("./config");
const { ensureStore, listSessions, getSession } = require("./sessionStore");
const { startTcpIngest } = require("./tcpIngest");
const { startMdnsResponder } = require("./mdnsResponder");
ensureStore();

const app = express();

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/api/sessions", (req, res) => {
  res.json(listSessions());
});

app.get("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  res.json(session);
});

// ?variant=clean serves the DeepFilterNet output once it's ready; falls
// back to the original recording if processing hasn't finished (or failed).
app.get("/api/sessions/:id/audio", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const wantClean = req.query.variant === "clean";
  const filePath =
    wantClean && session.processed && session.cleanedPath
      ? session.cleanedPath
      : session.filePath;
  res.setHeader("Content-Type", "audio/wav");
  res.sendFile(path.resolve(filePath));
});

// Bound to IPv4 explicitly for the same reason as the TCP ingest server
// below - avoids relying on the default dual-stack "::" bind.
app.listen(config.HTTP_PORT, "0.0.0.0", () => {
  console.log(
    `[api] REST API listening on http://localhost:${config.HTTP_PORT}`,
  );
});

startTcpIngest();

// So the ESP32 no longer needs a hardcoded IP: it queries "notepin-server.local"
// over mDNS and this responder answers with whatever this PC's current LAN IP is.
// If this PC's IP changes (new network, DHCP lease renewal), no firmware
// re-flash or secrets.h edit is needed - the device just re-resolves on its
// next connection attempt.
startMdnsResponder();
