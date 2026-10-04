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
const SERVER_STARTED_AT = new Date().toISOString();

// Serves backend/public/index.html (the demo dashboard) at http://localhost:<port>/ -
// same-origin, so its fetch() calls to /api/... work with zero CORS setup.
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Summary numbers for the dashboard's stat bar - deliberately cheap to
// compute (just scans the existing session list) rather than a new store.
app.get("/api/stats", (req, res) => {
  const sessions = listSessions();
  const todayStr = new Date().toISOString().slice(0, 10);
  const sessionsToday = sessions.filter(
    (s) => s.startedAt.slice(0, 10) === todayStr,
  ).length;
  const processing = sessions.filter(
    (s) => !s.transcribed && !s.transcriptError,
  ).length;
  const totalDurationSec = sessions.reduce(
    (sum, s) => sum + (s.durationSec || 0),
    0,
  );
  res.json({
    serverStartedAt: SERVER_STARTED_AT,
    uptimeSec: Math.round(process.uptime()),
    totalSessions: sessions.length,
    sessionsToday,
    processing,
    totalDurationSec: Number(totalDurationSec.toFixed(2)),
  });
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
