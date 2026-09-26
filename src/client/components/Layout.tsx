import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import type { Stats } from "../../shared/types";

export function Layout() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => {
      api<Stats>("/api/stats").then(setStats).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 8000);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <NavLink to="/" className="brand" end>
          <span className="brand-mark">読</span>
          <span>
            <strong>Yomu</strong>
            <small>Read what you watch</small>
          </span>
        </NavLink>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="tabbar">
        <NavLink to="/" end>
          <LibraryIcon />
          Library
        </NavLink>
        <NavLink to="/review">
          <CardsIcon />
          Review
          {stats && stats.dueCount > 0 ? <em>{stats.dueCount}</em> : null}
        </NavLink>
        <NavLink to="/known">
          <CheckIcon />
          Known
        </NavLink>
      </nav>
    </div>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.2A2.2 2.2 0 0 0 5 21.7V4.5Z" />
      <path d="M17 7h2.2A1.8 1.8 0 0 1 21 8.8V19a2 2 0 0 1-2 2h-2" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="6" width="12" height="14" rx="2" />
      <path d="M8 4h10a2 2 0 0 1 2 2v12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12.2 2.3 2.3 4.7-5" />
    </svg>
  );
}
