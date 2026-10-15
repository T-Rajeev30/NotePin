import { useEffect, useState, type FormEvent } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useStats } from "../hooks";
import { ago } from "../format";
import { CopyButton, Icon, useToast } from "../components/ui";
import type { Invite, User } from "../types";

function Password() {
  const { setUser } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      setUser((await api.post<{ user: User }>("/api/auth/password", f)).user);
      setF({ current: "", next: "" });
      toast("Password changed. Other devices were signed out.");
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Password</h2>
      <label>
        Current password
        <input
          type="password"
          value={f.current}
          onChange={(e) => setF({ ...f, current: e.target.value })}
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        New password
        <input
          type="password"
          value={f.next}
          onChange={(e) => setF({ ...f, next: e.target.value })}
          minLength={10}
          autoComplete="new-password"
          required
        />
      </label>
      <p className="hint">
        At least 10 characters. Changing it signs you out everywhere else.
      </p>
      <div className="err" role="alert">
        {err}
      </div>
      <button className="btn primary" disabled={busy}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

function Admin() {
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const load = () => {
    api
      .get<{ invites: Invite[] }>("/api/invites")
      .then((r) => setInvites(r.invites))
      .catch(() => {});
    api
      .get<{ users: User[] }>("/api/users")
      .then((r) => setPeople(r.users))
      .catch(() => {});
  };
  useEffect(load, []);
  const create = async () => {
    try {
      await api.post("/api/invites");
      load();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  const revoke = async (c: string) => {
    try {
      await api.del(`/api/invites/${c}`);
      load();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  return (
    <>
      <section className="card">
        <div className="h-row">
          <h2>Invite people</h2>
          <button className="btn ghost small" onClick={create}>
            <Icon name="plus" size={16} /> New invite code
          </button>
        </div>
        <p className="muted">
          Each code works once. Send it to the person along with this page’s
          address.
        </p>
        {invites.length === 0 ? (
          <p className="faint">No unused codes.</p>
        ) : (
          <ul className="plain">
            {invites.map((i) => (
              <li key={i.code} className="row-between">
                <span>
                  <code>{i.code}</code>{" "}
                  <span className="faint">created {ago(i.createdAt)}</span>
                </span>
                <span>
                  <CopyButton text={i.code} />
                  <button
                    className="btn ghost small danger-text"
                    onClick={() => revoke(i.code)}
                  >
                    Revoke
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>People</h2>
        <ul className="plain">
          {people.map((p) => (
            <li key={p.id} className="row-between">
              <span>
                {p.name} <span className="muted">{p.email}</span>
              </span>
              <span className="faint">
                {p.role === "admin" ? "Admin" : "Member"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function Settings() {
  const { user, logout } = useAuth();
  const { data: stats } = useStats();
  if (!user) return null;
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <section className="card">
        <h2>Account</h2>
        <p>
          <strong>{user.name}</strong>
          <br />
          <span className="muted">
            {user.email}, {user.role === "admin" ? "admin" : "member"}
          </span>
        </p>
        <button className="btn ghost" onClick={logout}>
          <Icon name="out" size={18} /> Sign out
        </button>
      </section>
      <Password />
      {user.role === "admin" && <Admin />}
      {user.role === "admin" && stats && (
        <section className="card">
          <h2>Server</h2>
          <ul className="plain">
            <li className="row-between">
              <span>Speech to text</span>
              <span
                className={stats.transcriptionEnabled ? "ok-text" : "warn-text"}
              >
                {stats.transcriptionEnabled
                  ? "On"
                  : "Off: set DEEPGRAM_API_KEY"}
              </span>
            </li>
            <li className="row-between">
              <span>Notes by Claude</span>
              <span className={stats.notesEnabled ? "ok-text" : "faint"}>
                {stats.notesEnabled ? "On" : "Off: set ANTHROPIC_API_KEY"}
              </span>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
