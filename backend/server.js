// NotePin backend entry point - starts both the audio ingest (raw TCP,
// same protocol as scripts/stream_receiver.py) and the REST API (for
// browsing recorded sessions, and for the Phase 5 web app later).

const express = require("express");
const path = require("path");
const config = require("./config");
const { ensureStore, listSessions, getSession } = require("./sessionStore");
const { startTcpIngest } = require("./tcpIngest");

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

app.get("/api/sessions/:id/audio", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  res.setHeader("Content-Type", "audio/wav");
  res.sendFile(path.resolve(session.filePath));
});

app.listen(config.HTTP_PORT, () => {
  console.log(
    `[api] REST API listening on http://localhost:${config.HTTP_PORT}`,
  );
});

startTcpIngest();
