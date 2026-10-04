"use strict";
const { load } = require("./config");
const { createIngestServer } = require("./tcpIngest");

const cfg = load();
const ingest = createIngestServer(cfg);

ingest
  .listen()
  .then(() => {
    console.log(`[NotePin] Recordings dir: ${cfg.recordingsDir}`);
    if (cfg.allowedIps.length)
      console.log(`[NotePin] Allowed IPs: ${cfg.allowedIps.join(", ")}`);
  })
  .catch((err) => {
    console.error(
      `[NotePin] Cannot listen on ${cfg.host}:${cfg.port}: ${err.code || err.message}`,
    );
    process.exit(1);
  });

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`[NotePin] ${sig} received, finalizing recordings...`);
    await ingest.stop();
    process.exit(0);
  });
}
