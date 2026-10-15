import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { errMsg } from "../api";
import { Led } from "../components/ui";

export function Login() {
  const { login, signup, config } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [f, setF] = useState({ name: "", email: "", password: "", invite: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const canSignup =
    config && config.signup !== "closed" && !config.needsBootstrap;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "in") await login(f.email, f.password);
      else await signup(f);
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-mark">
          <Led on busy />
        </div>
        <h1>{mode === "in" ? "Welcome back" : "Create your account"}</h1>
        <p className="muted">
          {mode === "in"
            ? "Sign in to see what your NotePin heard."
            : "You need an invite code from your admin."}
        </p>

        {config?.needsBootstrap && (
          <p className="notice">
            No admin account exists yet. On the server, run{" "}
            <code>node scripts/admin.js create-admin you@example.com</code>.
          </p>
        )}

        {mode === "up" && (
          <label>
            Name
            <input
              value={f.name}
              onChange={set("name")}
              autoComplete="name"
              required
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={f.email}
            onChange={set("email")}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={f.password}
            onChange={set("password")}
            minLength={mode === "up" ? 10 : undefined}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            required
          />
        </label>
        {mode === "up" && (
          <>
            <p className="hint">At least 10 characters.</p>
            {config?.signup === "invite" && (
              <label>
                Invite code
                <input
                  value={f.invite}
                  onChange={set("invite")}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </label>
            )}
          </>
        )}

        <div className="err" role="alert">
          {err}
        </div>
        <button className="btn primary wide" disabled={busy}>
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
        {canSignup && (
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setErr("");
            }}
          >
            {mode === "in"
              ? "Have an invite code? Create an account"
              : "Already have an account? Sign in"}
          </button>
        )}
      </form>
    </div>
  );
}
