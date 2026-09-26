import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, postJson } from "../api";
import type { SeriesSummary } from "../../shared/types";

export function HomePage() {
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    api<SeriesSummary[]>("/api/series")
      .then(setSeries)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  async function loadSample() {
    setBusy(true);
    setError(null);
    try {
      const created = await postJson<SeriesSummary>("/api/series/sample", {});
      navigate(`/series/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the sample");
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Your shelf</h1>
        <p>Name a series, add a Japanese subtitle, and get a reading lesson for that episode.</p>
      </div>
      <div className="row-actions">
        <Link className="btn primary" to="/new">
          Add a series
        </Link>
        <button className="btn" type="button" onClick={loadSample} disabled={busy}>
          {busy ? "Building the sample…" : "Try the sample scene"}
        </button>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {series && series.length === 0 ? (
        <section className="empty">
          <h2>Nothing here yet</h2>
          <p>
            Search AniList for an anime, or type in a live-action show yourself. Then upload one subtitle file per episode.
            The sample scene is original dialogue, so you can try the whole loop before you have a real file.
          </p>
        </section>
      ) : null}
      <div className="series-list">
        {series?.map((item) => (
          <Link key={item.id} to={`/series/${item.id}`} className="series-card">
            <Cover url={item.coverUrl} title={item.titleNative || item.title} />
            <div>
              <h2>{item.title}</h2>
              {item.titleNative && item.titleNative !== item.title ? <p className="native" lang="ja">{item.titleNative}</p> : null}
              <p className="meta">
                {item.lessonsReady} lesson{item.lessonsReady === 1 ? "" : "s"}
                {item.episodeCount ? ` · ${item.episodeCount} episodes` : ""}
                {item.dueCount ? ` · ${item.dueCount} cards due` : ""}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Cover({ url, title }: { url: string | null; title: string }) {
  if (url) return <img className="cover" src={url} alt="" referrerPolicy="no-referrer" />;
  return (
    <div className="cover fallback" aria-hidden="true">
      {(title || "?").slice(0, 1)}
    </div>
  );
}
