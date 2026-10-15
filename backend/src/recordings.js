"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Transcript store: one JSON file per recording at <transcriptsDir>/<deviceId>/<recId>.json.
// Audio is never kept here. An in-memory index (rebuilt at start) serves list/search.
function createRecordings(cfg, log = () => {}) {
  const root = cfg.transcriptsDir;
  const index = new Map(); // finished recordings
  const live = new Map(); // in-progress recordings (memory only until finish)
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");
  const fileOf = (r) => path.join(root, safe(r.deviceId), `${r.id}.json`);

  function persist(r) {
    const file = fileOf(r);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(r, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function scan() {
    if (!fs.existsSync(root)) return;
    for (const dev of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dev.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(root, dev.name))) {
        if (!f.endsWith(".json")) continue;
        try {
          const r = JSON.parse(
            fs.readFileSync(path.join(root, dev.name, f), "utf8"),
          );
          if (r && r.id) index.set(r.id, r);
        } catch (err) {
          log(
            `Skipping unreadable transcript ${dev.name}/${f}: ${err.message}`,
          );
        }
      }
    }
  }
  scan();

  const summary = (r) => ({
    id: r.id,
    deviceId: r.deviceId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationSec: r.durationSec,
    live: !r.endedAt,
    title: r.notes?.title || null,
    notesStatus: r.notes?.status || null,
    preview: (r.text || r.segments.map((s) => s.text).join(" ")).slice(0, 180),
    words: (r.text || "").split(/\s+/).filter(Boolean).length,
  });

  return {
    summary,

    begin({ deviceId, ownerId, codec }) {
      const now = new Date();
      const id = `rec_${now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z")}_${crypto.randomBytes(2).toString("hex")}`;
      const r = {
        id,
        deviceId,
        ownerId: ownerId || null,
        startedAt: now.toISOString(),
        endedAt: null,
        durationSec: 0,
        codec,
        segments: [],
        text: "",
        notes: null,
      };
      live.set(id, r);
      return r;
    },

    // Returns the stored record, or null when nothing was transcribed (nothing is written then).
    finish(r, durationSec) {
      live.delete(r.id);
      if (!r.segments.length) return null;
      r.endedAt = new Date().toISOString();
      r.durationSec = Math.round(durationSec * 100) / 100;
      r.text = r.segments.map((s) => s.text).join(" ");
      persist(r);
      index.set(r.id, r);
      return r;
    },

    get: (id) => index.get(id) || live.get(id) || null,

    update(id, patch) {
      const r = index.get(id);
      if (!r) return null;
      Object.assign(r, patch);
      persist(r);
      return r;
    },

    remove(id) {
      const r = index.get(id);
      if (!r) return false;
      try {
        fs.unlinkSync(fileOf(r));
      } catch {
        /* already gone */
      }
      return index.delete(id);
    },

    // Owner scoping: ownerId = restrict to that user; omit (admin) = everything.
    list({ ownerId, deviceId, q, limit = 50, before } = {}) {
      const needle = String(q || "")
        .trim()
        .toLowerCase();
      const all = [...live.values(), ...index.values()]
        .filter(
          (r) =>
            (ownerId === undefined || r.ownerId === ownerId) &&
            (!deviceId || r.deviceId === deviceId) &&
            (!before || r.startedAt < before) &&
            (!needle ||
              `${r.text} ${r.notes?.title || ""} ${r.notes?.summary || ""}`
                .toLowerCase()
                .includes(needle)),
        )
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      const items = all.slice(0, limit).map(summary);
      return {
        items,
        next: all.length > limit ? items[items.length - 1].startedAt : null,
        total: all.length,
      };
    },

    stats({ ownerId } = {}) {
      let count = 0;
      let seconds = 0;
      let words = 0;
      for (const r of index.values()) {
        if (ownerId !== undefined && r.ownerId !== ownerId) continue;
        count += 1;
        seconds += r.durationSec;
        words += (r.text || "").split(/\s+/).filter(Boolean).length;
      }
      return { recordings: count, seconds: Math.round(seconds), words };
    },

    purgeOlderThan(days) {
      if (!days) return 0;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      let n = 0;
      for (const r of [...index.values()])
        if (r.startedAt < cutoff && this.remove(r.id)) n += 1;
      return n;
    },
  };
}

module.exports = { createRecordings };
