import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import type { Stats, StudySettings } from "../../shared/types";

export function Layout() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const session = useSession();

  useEffect(() => {
    const load = () => {
      api<Stats>("/api/stats").then(setStats).catch(() => undefined);
    };
    load();
    api<StudySettings>("/api/settings")
      .then((settings) => setLevel(settings.level))
      .catch(() => undefined);
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
        <NavLink to="/level" className="level-chip">
          {level || "Level"}
        </NavLink>
        {session.required ? (
          <button className="text-btn sign-out" type="button" onClick={() => void session.signOut()}>
            Sign out
          </button>
        ) : null}
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="tabbar">
        <NavLink to="/" end>
          <LibraryIcon />
          Library
        </NavLink>
        <NavLink to="/books">
          <BookIcon />
          Books
        </NavLink>
        <NavLink to="/news">
          <NewsIcon />
          News
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

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4.5h11.5A1.5 1.5 0 0 1 19 6v13.5H8.2A2.2 2.2 0 0 0 6 21.7V4.5Z" />
      <path d="M9 8.5h6M9 12h6" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v13H5z" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
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
