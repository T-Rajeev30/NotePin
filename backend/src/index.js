"use strict";
const { EventEmitter } = require("events");
const { load } = require("./config");
const { createIngestServer } = require("./tcpIngest");
const { createHttpServer } = require("./http");
const { createUserStore } = require("./userStore");
const { createRecordings } = require("./recordings");
const { createNotes } = require("./notes");
const { createPipeline } = require("./pipeline");

const cfg = load();
const log = (msg) => console.log(`[NotePin] ${msg}`);

const bus = new EventEmitter();
bus.setMaxListeners(0);
const presence = new Map();
const recordings = createRecordings(cfg, log);
const notes = createNotes(cfg, log);
const pipeline = createPipeline({ cfg, recordings, notes, bus, log });
const users = createUserStore(cfg.usersFile);

const ingest = createIngestServer(cfg, log, {
  bus,
  recordings,
  pipeline,
  presence,
});
const web = createHttpServer(
  cfg,
  {
    users,
    recordings,
    pipeline,
    presence,
    bus,
    notes,
    disconnect: ingest.disconnect,
  },
  log,
);

(async () => {
  try {
    await ingest.listen();
    await web.listen();
  } catch (err) {
    console.error(
      `[NotePin] Cannot start: ${err.code || err.message} (${err.address || ""}:${err.port || ""})`,
    );
    process.exit(1);
  }
  log(
    `Data dir: ${cfg.dataDir}  |  audio stored: ${cfg.storeAudio ? "yes (" + cfg.recordingsDir + ")" : "no (transcripts only)"}`,
  );
  log(
    `Transcription: ${cfg.deepgramKey ? `Deepgram ${cfg.deepgramModel} (${cfg.deepgramLanguage})` : "DISABLED - set DEEPGRAM_API_KEY, otherwise nothing is stored"}`,
  );
  log(
    `Notes: ${notes.enabled ? cfg.notesModel : "disabled (set ANTHROPIC_API_KEY)"}  |  sign-up: ${cfg.signup}`,
  );
  if (!users.count())
    log(
      "No users yet. Create the admin:  node scripts/admin.js create-admin <email>",
    );
  if (!cfg.requireAuth)
    log(
      "WARNING: NOTEPIN_REQUIRE_AUTH is off - unauthenticated NPIN streams are accepted",
    );
  if (!cfg.cookieSecure)
    log(
      "NOTE: serving the dashboard over plain HTTP (NOTEPIN_COOKIE_SECURE off). Put it behind HTTPS before exposing it publicly.",
    );
  if (cfg.allowedIps.length)
    log(`Allowed device IPs: ${cfg.allowedIps.join(", ")}`);

  if (cfg.retentionDays) {
    const sweep = () => {
      const n = recordings.purgeOlderThan(cfg.retentionDays);
      if (n)
        log(
          `Retention: removed ${n} transcript(s) older than ${cfg.retentionDays} days`,
        );
    };
    sweep();
    setInterval(sweep, 6 * 3600 * 1000).unref();
  }
})();

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    log(`${sig} received, finalizing recordings...`);
    await web.close();
    await ingest.stop();
    process.exit(0);
  });
}
