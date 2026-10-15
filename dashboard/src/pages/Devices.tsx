import { useEffect, useState, type FormEvent } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { useDevices } from "../hooks";
import { ago, clock } from "../format";
import {
  Confirm,
  CopyButton,
  Empty,
  Icon,
  Led,
  Sheet,
  Skeleton,
  useToast,
} from "../components/ui";
import type { Device, User } from "../types";

type Modal =
  | { t: "add" }
  | { t: "key"; device: string; key: string; cmd: string }
  | { t: "rename" | "rotate" | "remove" | "assign"; d: Device };

function KeyReveal({
  device,
  cmd,
  onDone,
}: {
  device: string;
  cmd: string;
  onDone: () => void;
}) {
  return (
    <>
      <p className="notice">
        This key is shown once. Put it on the device now; you can always issue a
        new one.
      </p>
      <ol className="steps">
        <li>
          Plug {device} into your computer and open the Serial Monitor at 115200
          baud.
        </li>
        <li>Send this line exactly:</li>
      </ol>
      <pre className="cmd" tabIndex={0}>
        {cmd}
      </pre>
      <div className="row-actions">
        <CopyButton text={cmd} label="Copy command" />
        <button className="btn primary" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="hint">
        The serial reply should read <code>[key] saved</code>. Then tap the pin
        to start streaming.
      </p>
    </>
  );
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const cleanCode = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .split("")
    .filter((c) => ALPHA.includes(c))
    .slice(0, 12)
    .join("");
const showCode = (c: string) => c.replace(/(.{4})(?=.)/g, "$1-");
function codeOk(c: string) {
  if (c.length !== 12) return false;
  let s = 0;
  for (let i = 0; i < 11; i++) s += (ALPHA.indexOf(c[i]) + 1) * (i + 1);
  return ALPHA[s % ALPHA.length] === c[11];
}

export function Devices() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: devices, loading, error, reload } = useDevices();
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<User[]>([]);
  const [f, setF] = useState({ deviceId: "", name: "", code: "" });
  const [useKey, setUseKey] = useState(false);
  const [err, setErr] = useState("");
  const close = () => {
    setModal(null);
    setErr("");
    setUseKey(false);
    setF({ deviceId: "", name: "", code: "" });
  };

  // The pin's setup page links here as /devices#add=NP-XXXXXXXX&code=XXXX-XXXX-XXXX
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const id = (h.get("add") || "").trim();
    if (!id) return;
    setF({ deviceId: id, name: "", code: cleanCode(h.get("code") || "") });
    setModal({ t: "add" });
    history.replaceState(null, "", window.location.pathname);
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const deviceId = f.deviceId.trim();
      const name = f.name.trim() || deviceId;
      if (!useKey) {
        if (!codeOk(f.code))
          throw new Error(
            "That pairing code does not look right. Check it against the one on the setup page.",
          );
        await api.post("/api/devices", { deviceId, name, code: f.code });
        toast(`${name} added. Your pin connects in a few seconds.`);
        close();
        return;
      }
      const r = await api.post<{ key: string; serialCommand: string }>(
        "/api/devices",
        { deviceId, name },
      );
      setModal({
        t: "key",
        device: deviceId,
        key: r.key,
        cmd: r.serialCommand,
      });
    });
  };
  const rename = (e: FormEvent, d: Device) => {
    e.preventDefault();
    void run(async () => {
      await api.patch(`/api/devices/${d.deviceId}`, { name: f.name });
      toast("Renamed");
      close();
    });
  };
  const rotate = (d: Device) =>
    void run(async () => {
      const r = await api.post<{ key: string; serialCommand: string }>(
        `/api/devices/${d.deviceId}/rotate`,
      );
      setModal({
        t: "key",
        device: d.deviceId,
        key: r.key,
        cmd: r.serialCommand,
      });
    });
  const remove = (d: Device) =>
    void run(async () => {
      await api.del(`/api/devices/${d.deviceId}`);
      toast(`${d.name} removed`);
      close();
    });
  const toggle = (d: Device) =>
    void run(async () => {
      await api.patch(`/api/devices/${d.deviceId}`, { revoked: !d.revoked });
      toast(d.revoked ? "Device restored" : "Device blocked");
    });
  const assign = (d: Device, ownerId: string) =>
    void run(async () => {
      await api.patch(`/api/devices/${d.deviceId}`, {
        ownerId: ownerId || null,
      });
      toast("Owner updated");
      close();
    });

  async function openAssign(d: Device) {
    setF({ deviceId: "", name: "", code: "" });
    setModal({ t: "assign", d });
    try {
      setPeople((await api.get<{ users: User[] }>("/api/users")).users);
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  const status = (d: Device) =>
    d.revoked
      ? "Blocked"
      : d.online
        ? `Online since ${d.onlineSince ? clock(d.onlineSince) : "now"}`
        : d.lastSeenAt
          ? `Last seen ${ago(d.lastSeenAt)}`
          : "Never connected";

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>Devices</h1>
          <p className="muted">
            Each NotePin has its own key, so only your pins can send audio to
            your account.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setErr("");
            setModal({ t: "add" });
          }}
        >
          <Icon name="plus" size={18} /> Add device
        </button>
      </header>

      {error && <p className="err">{error}</p>}
      {loading ? (
        <Skeleton lines={3} />
      ) : devices.length === 0 ? (
        <Empty title="No devices yet">
          Power on your NotePin and follow its setup page. It brings you back
          here to finish.
        </Empty>
      ) : (
        <ul className="devices">
          {devices.map((d) => (
            <li key={d.deviceId} className={`device${d.revoked ? " off" : ""}`}>
              <Led on={d.online && !d.revoked} busy={d.online} />
              <div className="device-main">
                <strong>{d.name}</strong>
                <span className="muted">{d.deviceId}</span>
                <span className={d.online ? "ok-text" : "faint"}>
                  {status(d)}
                </span>
                {user?.role === "admin" && (
                  <span className="faint">
                    {d.ownerEmail
                      ? `Owner: ${d.ownerEmail}`
                      : "No owner assigned"}
                  </span>
                )}
              </div>
              <div className="device-actions">
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setF({ deviceId: "", name: d.name, code: "" });
                    setErr("");
                    setModal({ t: "rename", d });
                  }}
                >
                  Rename
                </button>
                {d.pairing !== "code" && (
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      setErr("");
                      setModal({ t: "rotate", d });
                    }}
                  >
                    <Icon name="key" size={16} /> New key
                  </button>
                )}
                <button
                  className="btn ghost small"
                  onClick={() => toggle(d)}
                  disabled={busy}
                >
                  {d.revoked ? "Restore" : "Block"}
                </button>
                {user?.role === "admin" && (
                  <button
                    className="btn ghost small"
                    onClick={() => openAssign(d)}
                  >
                    Assign
                  </button>
                )}
                <button
                  className="btn ghost small danger-text"
                  onClick={() => {
                    setErr("");
                    setModal({ t: "remove", d });
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={modal?.t === "add"} onClose={close} title="Add a device">
        <form onSubmit={add}>
          <label>
            Device ID
            <input
              value={f.deviceId}
              onChange={(e) => setF({ ...f, deviceId: e.target.value })}
              placeholder="NP-1A2B3C4D"
              autoCapitalize="characters"
              spellCheck={false}
              required
              maxLength={16}
            />
          </label>
          <p className="hint">Shown on the pin's setup page.</p>
          {!useKey && (
            <>
              <label>
                Pairing code
                <input
                  value={showCode(f.code)}
                  onChange={(e) =>
                    setF({ ...f, code: cleanCode(e.target.value) })
                  }
                  placeholder="XXXX-XXXX-XXXX"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  required
                />
              </label>
              <p className="hint">
                Tap your pin while it is in setup mode to show the code.
              </p>
            </>
          )}
          <label>
            Name
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Desk pin"
              maxLength={40}
            />
          </label>
          <div className="err" role="alert">
            {err}
          </div>
          <button
            type="button"
            className="linkish"
            onClick={() => setUseKey(!useKey)}
          >
            {useKey
              ? "Use a pairing code instead"
              : "No code? Generate a key to type in the Serial Monitor"}
          </button>
          <div className="row-actions">
            <button type="button" className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Adding…" : useKey ? "Add and get key" : "Add device"}
            </button>
          </div>
        </form>
      </Sheet>

      <Sheet
        open={modal?.t === "key"}
        onClose={() => {
          close();
        }}
        title="Put the key on your pin"
      >
        {modal?.t === "key" && (
          <KeyReveal device={modal.device} cmd={modal.cmd} onDone={close} />
        )}
      </Sheet>

      <Sheet open={modal?.t === "rename"} onClose={close} title="Rename device">
        {modal?.t === "rename" && (
          <form onSubmit={(e) => rename(e, modal.d)}>
            <label>
              Name
              <input
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                maxLength={40}
                required
              />
            </label>
            <div className="err" role="alert">
              {err}
            </div>
            <div className="row-actions">
              <button type="button" className="btn ghost" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        )}
      </Sheet>

      <Confirm
        open={modal?.t === "rotate"}
        onClose={close}
        title="Issue a new key?"
        action="Issue new key"
        busy={busy}
        body="The current key stops working immediately and a streaming pin is disconnected. You will need to type the new key into the pin."
        onConfirm={() => modal?.t === "rotate" && rotate(modal.d)}
      />
      <Confirm
        open={modal?.t === "remove"}
        onClose={close}
        title="Remove this device?"
        action="Remove"
        danger
        busy={busy}
        body="The pin can no longer connect. Its existing transcripts stay in your recordings."
        onConfirm={() => modal?.t === "remove" && remove(modal.d)}
      />

      <Sheet open={modal?.t === "assign"} onClose={close} title="Assign owner">
        {modal?.t === "assign" && (
          <>
            <label>
              Owner
              <select
                defaultValue={modal.d.ownerId || ""}
                onChange={(e) => assign(modal.d, e.target.value)}
              >
                <option value="">No owner (admins only)</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </select>
            </label>
            <div className="err" role="alert">
              {err}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
