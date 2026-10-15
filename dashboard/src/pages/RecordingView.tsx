import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "../api";
import { useLive } from "../live";
import { useStats } from "../hooks";
import { duration, mmss } from "../format";
import {
  Bars,
  CopyButton,
  Confirm,
  Icon,
  Skeleton,
  useToast,
} from "../components/ui";
import type { Recording, Segment } from "../types";

export function RecordingView() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { live, version } = useLive();
  const { data: stats } = useStats();
  const [rec, setRec] = useState<Recording | null>(null);
  const [err, setErr] = useState("");
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRec(null);
    setErr("");
  }, [id]);
  useEffect(() => {
    let off = false;
    api
      .get<{ recording: Recording }>(`/api/recordings/${id}`)
      .then((r) => !off && setRec(r.recording))
      .catch((e) => !off && setErr(errMsg(e)));
    return () => {
      off = true;
    };
  }, [id, version]);

  const liveSegs = live[id]?.segments;
  const isLive = !!rec && !rec.endedAt;
  const segments: Segment[] = useMemo(() => {
    if (!rec) return [];
    if (!isLive || !liveSegs) return rec.segments;
    const seen = new Set(rec.segments.map((s) => `${s.start}|${s.text}`));
    return [
      ...rec.segments,
      ...liveSegs.filter((s) => !seen.has(`${s.start}|${s.text}`)),
    ];
  }, [rec, isLive, liveSegs]);

  useEffect(() => {
    if (isLive)
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments.length, isLive]);

  if (err)
    return (
      <div className="pad">
        <p className="err">{err}</p>
        <Link to="/" className="btn ghost">
          Back to recordings
        </Link>
      </div>
    );
  if (!rec)
    return (
      <div className="pad">
        <Skeleton lines={6} />
      </div>
    );

  const n = rec.notes;
  const text = segments.map((s) => `[${mmss(s.start)}] ${s.text}`).join("\n");

  async function regenerate() {
    try {
      await api.post(`/api/recordings/${id}/notes`);
      toast("Writing notes…");
    } catch (e) {
      toast(errMsg(e), true);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.del(`/api/recordings/${id}`);
      toast("Recording deleted");
      nav("/");
    } catch (e) {
      toast(errMsg(e), true);
      setBusy(false);
      setDel(false);
    }
  }

  return (
    <article className="detail">
      <Link to="/" className="back">
        <Icon name="back" size={18} /> Recordings
      </Link>

      <header>
        {isLive ? (
          <h1 className="live-title">
            <Bars /> Listening now
          </h1>
        ) : (
          <h1>
            {n?.title ||
              (n?.status === "pending" ? "Writing notes…" : "Recording")}
          </h1>
        )}
        <p className="muted">
          {new Date(rec.startedAt).toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {!isLive && `, ${duration(rec.durationSec)}`} from {rec.deviceId}
        </p>
      </header>

      {!isLive && (
        <div className="toolbar">
          <a
            className="btn ghost small"
            href={`/api/recordings/${id}/export?format=md`}
          >
            <Icon name="download" size={16} /> Markdown
          </a>
          <a
            className="btn ghost small"
            href={`/api/recordings/${id}/export?format=txt`}
          >
            Text
          </a>
          <a
            className="btn ghost small"
            href={`/api/recordings/${id}/export?format=json`}
          >
            JSON
          </a>
          <CopyButton text={text} label="Copy transcript" />
          {stats?.notesEnabled && (
            <button className="btn ghost small" onClick={regenerate}>
              <Icon name="spark" size={16} /> {n ? "Redo notes" : "Write notes"}
            </button>
          )}
          <button
            className="btn ghost small danger-text"
            onClick={() => setDel(true)}
          >
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      )}

      {n?.status === "pending" && (
        <div className="card">
          <Skeleton lines={3} />
        </div>
      )}
      {n?.status === "error" && (
        <p className="notice">
          Notes could not be written ({n.error}).{" "}
          {stats?.notesEnabled && "Try “Redo notes”."}
        </p>
      )}
      {n?.status === "ready" && (
        <section className="card notes">
          {n.summary && <p className="summary-text">{n.summary}</p>}
          {!!n.keyPoints?.length && (
            <>
              <h3>Key points</h3>
              <ul className="dots">
                {n.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </>
          )}
          {!!n.actionItems?.length && (
            <>
              <div className="h-row">
                <h3>To do</h3>
                <CopyButton
                  text={n.actionItems.map((a) => `- [ ] ${a}`).join("\n")}
                  label="Copy"
                />
              </div>
              <ul className="todo">
                {n.actionItems.map((a, i) => (
                  <li key={i}>
                    <span className="box" />
                    {a}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section
        className="transcript"
        aria-label="Transcript"
        aria-live={isLive ? "polite" : undefined}
      >
        <h3>Transcript</h3>
        {segments.length === 0 ? (
          <p className="muted">Waiting for speech…</p>
        ) : (
          segments.map((s, i) => (
            <p key={`${s.start}-${i}`} className="seg">
              <time>{mmss(s.start)}</time>
              <span>{s.text}</span>
            </p>
          ))
        )}
        <div ref={end} />
      </section>

      <Confirm
        open={del}
        onClose={() => setDel(false)}
        title="Delete this recording?"
        body="The transcript and notes are removed from the server. This can’t be undone."
        action="Delete"
        danger
        busy={busy}
        onConfirm={remove}
      />
    </article>
  );
}
