import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, postJson } from "../api";
import { listOfflineNews } from "../offline";
import type { NewsList } from "../../shared/types";

export function NewsPage() {
  const [data, setData] = useState<NewsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline] = useState(() => listOfflineNews());

  async function load(day?: string) {
    const query = day ? `?day=${encodeURIComponent(day)}` : "";
    const next = await api<NewsList>(`/api/news${query}`);
    setData(next);
    setError(next.error);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setData(await postJson<NewsList>("/api/news/refresh", {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the news");
    } finally {
      setBusy(false);
    }
  }

  function dayLabel(day: string): string {
    if (data && day === data.today) return "Today";
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  if (!data && !error) return <p className="page muted">Fetching today’s news…</p>;

  const days = data ? [...new Set([data.today, ...data.days])].sort().reverse() : [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Daily news</h1>
        <p>A short set of current NHK stories. Read them in Japanese at your level, or switch to English and listening.</p>
      </div>
      <div className="row-actions">
        <button className="btn primary" type="button" onClick={refresh} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        {data?.refreshedAt ? <span className="meta">Updated {new Date(data.refreshedAt).toLocaleString()}</span> : null}
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {days.length > 1 ? (
        <div className="day-chips" role="tablist" aria-label="News days">
          {days.map((day) => (
            <button
              key={day}
              className={`btn ${data?.day === day ? "on" : ""}`}
              type="button"
              onClick={() => load(day).catch((err: Error) => setError(err.message))}
            >
              {dayLabel(day)}
            </button>
          ))}
        </div>
      ) : null}
      {offline.length ? (
        <section className="panel">
          <h2>On this phone</h2>
          <div className="stack">
            {offline.map((item) => (
              <Link key={item.id} to={`/news/${item.id}`}>
                {item.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {data && data.stories.length === 0 ? (
        <p className="empty">No stories saved for {dayLabel(data.day)} yet.</p>
      ) : null}
      <div className="news-list">
        {data?.stories.map((story) => (
          <Link key={story.id} className="news-card" to={`/news/${story.id}`}>
            <div className="news-meta">
              <span>{story.category}</span>
              <span>{story.readingMinutes} min</span>
              {story.level ? <span className={`jlpt ${story.level.toLowerCase()}`}>{story.level}</span> : null}
            </div>
            <h2 lang="ja">{story.title}</h2>
            <p className="meta">{story.hasEnglish ? "English available" : "Japanese only"}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
