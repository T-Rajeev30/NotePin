import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from "react";
import type { RecSummary, Segment } from "./types";

export type LiveRec = { rec: RecSummary; segments: Segment[] };
type State = {
  live: Record<string, LiveRec>;
  online: Record<string, boolean>;
  version: number;
  connected: boolean;
};
type Ev =
  | { type: "recording.start"; recording: RecSummary }
  | {
      type: "recording.segment";
      recordingId: string;
      deviceId: string;
      segment: Segment;
    }
  | {
      type: "recording.end" | "notes.pending" | "notes.done";
      recording: RecSummary;
    }
  | { type: "device.online" | "device.offline"; deviceId: string };
type Action = Ev | { type: "_open" } | { type: "_closed" };

const initial: State = { live: {}, online: {}, version: 0, connected: false };

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "_open":
      return { ...s, connected: true, version: s.version + 1 };
    case "_closed":
      return { ...s, connected: false };
    case "recording.start":
      return {
        ...s,
        live: {
          ...s.live,
          [a.recording.id]: { rec: a.recording, segments: [] },
        },
        version: s.version + 1,
      };
    case "recording.segment": {
      const cur = s.live[a.recordingId] ?? {
        rec: {
          id: a.recordingId,
          deviceId: a.deviceId,
          startedAt: new Date().toISOString(),
          endedAt: null,
          durationSec: 0,
          live: true,
          title: null,
          notesStatus: null,
          preview: "",
          words: 0,
        },
        segments: [],
      };
      return {
        ...s,
        live: {
          ...s.live,
          [a.recordingId]: {
            rec: cur.rec,
            segments: [...cur.segments, a.segment],
          },
        },
      };
    }
    case "recording.end": {
      const live = { ...s.live };
      delete live[a.recording.id];
      return { ...s, live, version: s.version + 1 };
    }
    case "notes.pending":
    case "notes.done":
      return { ...s, version: s.version + 1 };
    case "device.online":
    case "device.offline":
      return {
        ...s,
        online: { ...s.online, [a.deviceId]: a.type === "device.online" },
        version: s.version + 1,
      };
  }
}

const LiveCtx = createContext<State>(initial);
export const useLive = () => useContext(LiveCtx);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initial);
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => dispatch({ type: "_open" });
    es.onerror = () => dispatch({ type: "_closed" });
    es.onmessage = (m) => {
      try {
        dispatch(JSON.parse(m.data) as Ev);
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, []);
  return <LiveCtx.Provider value={state}>{children}</LiveCtx.Provider>;
}
