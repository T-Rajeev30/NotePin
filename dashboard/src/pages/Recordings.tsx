import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useMatch } from "react-router-dom";
import { api } from "../api";
import { useLive } from "../live";
import { useAuth } from "../auth";
import { useDevices, useStats } from "../hooks";
import { clock, dayLabel, duration, hours } from "../format";
import { Bars, Empty, Icon, Skeleton } from "../components/ui";
import type { RecSummary, Segment } from "../types";

type Page = { items: RecSummary[]; next: string | null; total: number };

export function Recordings() {
  const activeId = useMatch("/r/:id")?.params.id;
  const { live, version } = useLive();
  const { user } = useAuth();
  const { data: devices } = useDevices();
  const { data: stats } = useStats();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [device, setDevice] = useState("");
  const [page, setPage] = useState<Page>({ items: [], next: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(dq ? { q: dq } : {}),
      ...(device ? { device } : {}),
      ...extra,
    }).toString();

  useEffect(() => {
    let off = false;
    const limit = Math.min(Math.max(30, page.items.length), 100);
    api
      .get<Page>(`/api/recordings?${qs({ limit: String(limit) })}`)
      .then((p) => {
        if (!off) setPage(p);
      })
      .catch(() => {})
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, device, version]);

  async function loadMore() {
    if (!page.next) return;
    setMore(true);
    try {
      const p = await api.get<Page>(
        `/api/recordings?${qs({ limit: "30", before: page.next })}`,
      );
      setPage({ ...p, items: [...page.items, ...p.items] });
    } finally {
      setMore(false);
    }
  }

  const names = useMemo(
    () => Object.fromEntries(devices.map((d) => [d.deviceId, d.name])),
    [devices],
  );
  const groups = useMemo(() => {
    const out: { label: string; items: RecSummary[] }[] = [];
    for (const r of page.items.filter((i) => !i.live)) {
      const label = dayLabel(r.startedAt);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [page.items]);

  // Recordings already in progress when the page opened come from the API; ones that start later arrive over SSE.
  const liveList = useMemo(() => {
    const byId = new Map<string, { rec: RecSummary; segments: Segment[] }>();
    for (const r of page.items)
      if (r.live) byId.set(r.id, { rec: r, segments: [] });
    for (const l of Object.values(live)) byId.set(l.rec.id, l);
    return [...byId.values()].filter(
      (l) => !device || l.rec.deviceId === device,
    );
  }, [page.items, live, device]);

  return (
    <div className={`split${activeId ? " has-detail" : ""}`}>
      <section className="list-pane" aria-label="Recordings">
        <header className="page-head">
          <h1>Recordings</h1>
          {stats && (
            <p className="muted summary">
              {stats.recordings === 0
                ? "Nothing recorded yet."
                : `${stats.recordings} recording${stats.recordings === 1 ? "" : "s"}, ${hours(stats.seconds)} of speech, ${stats.words.toLocaleString()} words.`}
              {stats.devices > 0 &&
                ` ${stats.online} of ${stats.devices} device${stats.devices === 1 ? "" : "s"} online.`}
            </p>
          )}
        </header>

        {stats && !stats.transcriptionEnabled && user?.role === "admin" && (
          <p className="notice">
            Transcription is off. Set <code>DEEPGRAM_API_KEY</code> on the
            server; without it nothing is saved.
          </p>
        )}

        <div className="search">
          <Icon name="search" size={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search what was said"
            aria-label="Search recordings"
          />
        </div>
        {devices.length > 1 && (
          <div className="chips" role="group" aria-label="Filter by device">
            <button
              className={`chip${!device ? " on" : ""}`}
              onClick={() => setDevice("")}
            >
              All devices
            </button>
            {devices.map((d) => (
              <button
                key={d.deviceId}
                className={`chip${device === d.deviceId ? " on" : ""}`}
                onClick={() => setDevice(d.deviceId)}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}

        {liveList.map(({ rec, segments }) => (
          <Link
            key={rec.id}
            to={`/r/${rec.id}`}
            className={`live-card${activeId === rec.id ? " active" : ""}`}
          >
            <div className="live-top">
              <Bars />
              <strong>
                Listening on {names[rec.deviceId] || rec.deviceId}
              </strong>
            </div>
            <p>
              {segments.length
                ? segments[segments.length - 1].text
                : rec.preview || "Waiting for speech…"}
            </p>
          </Link>
        ))}

        {loading ? (
          <Skeleton lines={5} />
        ) : groups.length === 0 && liveList.length === 0 ? (
          dq ? (
            <Empty title="No matches">Nothing you said contains “{dq}”.</Empty>
          ) : devices.length === 0 ? (
            <Empty title="Add your first NotePin">
              Register a device, then tap it and start talking.{" "}
              <Link to="/devices">Go to devices</Link>
            </Empty>
          ) : (
            <Empty title="No recordings yet">
              Tap your NotePin and start talking. The transcript appears here
              within seconds.
            </Empty>
          )
        ) : (
          groups.map((g) => (
            <div key={g.label} className="group">
              <h2 className="group-label">{g.label}</h2>
              <ul>
                {g.items.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/r/${r.id}`}
                      className={`rec${activeId === r.id ? " active" : ""}`}
                    >
                      <span className="rec-time">{clock(r.startedAt)}</span>
                      <span className="rec-body">
                        <strong>
                          {r.title ||
                            (r.notesStatus === "pending"
                              ? "Writing notes…"
                              : r.preview.slice(0, 70) || "Untitled")}
                        </strong>
                        <span className="muted clamp">
                          {r.title ? r.preview : r.preview.slice(70)}
                        </span>
                        <span className="faint">
                          {duration(r.durationSec)},{" "}
                          {names[r.deviceId] || r.deviceId}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {page.next && (
          <button className="btn ghost wide" onClick={loadMore} disabled={more}>
            {more ? "Loading…" : "Show older"}
          </button>
        )}
      </section>

      <section className="detail-pane">
        {activeId ? (
          <Outlet />
        ) : (
          <div className="detail-empty">
            <Icon name="mic" size={28} />
            <p className="muted">Pick a recording to read it.</p>
          </div>
        )}
      </section>
    </div>
  );
}
