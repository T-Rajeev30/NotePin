import { Link, Outlet, useLocation } from "react-router-dom";
import { Icon, Led } from "./ui";
import { useLive } from "../live";
import { useAuth } from "../auth";

const NAV = [
  {
    to: "/",
    icon: "mic",
    label: "Recordings",
    match: (p: string) => p === "/" || p.startsWith("/r/"),
  },
  {
    to: "/devices",
    icon: "pin",
    label: "Devices",
    match: (p: string) => p.startsWith("/devices"),
  },
  {
    to: "/settings",
    icon: "gear",
    label: "Settings",
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function Shell() {
  const { live, connected } = useLive();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const recording = Object.keys(live).length > 0;
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="logo">
          <Led on={connected} busy={recording} />
          <span>NotePin</span>
        </div>
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={`navlink${n.match(pathname) ? " active" : ""}`}
            aria-current={n.match(pathname) ? "page" : undefined}
          >
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
        <div className="rail-foot muted">{user?.name}</div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
