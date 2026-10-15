"use strict";

// Finishing a recording: persist the transcript, tell dashboards, then (optionally) ask Claude for notes.
function createPipeline({ cfg, recordings, notes, bus, log }) {
  const inflight = new Set();

  const emit = (type, r) =>
    bus.emit("event", {
      type,
      ownerId: r.ownerId,
      recording: recordings.summary(r),
    });

  function runNotes(r) {
    const job = (async () => {
      recordings.update(r.id, { notes: { status: "pending" } });
      emit("notes.pending", r);
      try {
        recordings.update(r.id, { notes: await notes.generate(r) });
        log(`Notes ready for ${r.id}`);
      } catch (err) {
        recordings.update(r.id, {
          notes: { status: "error", error: String(err.message).slice(0, 200) },
        });
        log(`Notes failed for ${r.id}: ${err.message}`);
      }
      emit("notes.done", r);
    })().finally(() => inflight.delete(job));
    inflight.add(job);
    return job;
  }

  return {
    finish(live, durationSec) {
      const r = recordings.finish(live, durationSec);
      if (!r) {
        // Nothing was transcribed: tell dashboards the live card is gone, otherwise it stays on screen.
        bus.emit("event", {
          type: "recording.end",
          ownerId: live.ownerId,
          recording: { ...recordings.summary(live), live: false },
        });
        return null;
      }
      log(
        `Transcript saved: ${r.id} (${r.durationSec}s, ${r.text.length} chars)`,
      );
      emit("recording.end", r);
      if (notes.enabled && r.text.length >= cfg.notesMinChars) runNotes(r);
      else r.notes = r.notes || null;
      return r;
    },
    regenerate(id) {
      const r = recordings.get(id);
      if (!r || !r.endedAt) return null;
      if (!notes.enabled)
        throw Object.assign(
          new Error("Notes are not configured (ANTHROPIC_API_KEY)"),
          { status: 503 },
        );
      runNotes(r);
      return r;
    },
    idle: () => Promise.all([...inflight]),
  };
}

module.exports = { createPipeline };
