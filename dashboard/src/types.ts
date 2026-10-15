export type User = { id: string; email: string; name: string; role: 'admin' | 'user'; createdAt: string };
export type Device = {
  deviceId: string; name: string; createdAt: string | null; revoked: boolean; lastSeenAt: string | null;
  online: boolean; onlineSince: string | null; ownerId: string | null; ownerEmail?: string | null;
    pairing?: 'code' | 'key';
};
export type Notes = {
  status: 'pending' | 'ready' | 'error'; title?: string; summary?: string; keyPoints?: string[];
  actionItems?: string[]; error?: string; model?: string; generatedAt?: string;
};
export type RecSummary = {
  id: string; deviceId: string; startedAt: string; endedAt: string | null; durationSec: number; live: boolean;
  title: string | null; notesStatus: Notes['status'] | null; preview: string; words: number;
};
export type Segment = { start: number; end: number; text: string };
export type Recording = {
  id: string; deviceId: string; startedAt: string; endedAt: string | null; durationSec: number; codec: string;
  segments: Segment[]; text: string; notes: Notes | null;
};
export type Stats = {
  recordings: number; seconds: number; words: number; devices: number; online: number;
  notesEnabled: boolean; transcriptionEnabled: boolean;
};
export type Invite = { code: string; createdAt: string };