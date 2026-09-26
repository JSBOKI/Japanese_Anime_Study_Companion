import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, postJson } from "../api";
import type { AniListHit, SeriesSummary } from "../../shared/types";
import { Cover } from "./Home";

export function NewSeriesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AniListHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState({
    title: "",
    titleNative: "",
    episodeCount: "12",
    mediaType: "drama",
    coverUrl: "",
  });

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    try {
      setHits(await api<AniListHit[]>(`/api/anilist/search?q=${encodeURIComponent(query.trim())}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function addAniList(id: number) {
    setError(null);
    try {
      const series = await postJson<SeriesSummary>("/api/series", { source: "anilist", anilistId: id });
      navigate(`/series/${series.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that series");
    }
  }

  async function addManual(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const series = await postJson<SeriesSummary>("/api/series", {
        source: "manual",
        title: manual.title,
        titleNative: manual.titleNative,
        episodeCount: Number(manual.episodeCount) || 0,
        mediaType: manual.mediaType,
        coverUrl: manual.coverUrl,
      });
      navigate(`/series/${series.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that series");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Add a series</h1>
        <p>Anime titles come from AniList, with the cover and episode count. Live-action shows can be typed in.</p>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      <form className="panel" onSubmit={search}>
        <h2>Search anime</h2>
        <label>
          Title
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Spy × Family" />
        </label>
        <button className="btn primary" type="submit" disabled={searching || query.trim().length < 2}>
          {searching ? "Searching…" : "Search AniList"}
        </button>
        <div className="hits">
          {hits.map((hit) => (
            <article key={hit.id} className="hit">
              <Cover url={hit.coverUrl} title={hit.native || hit.title} />
              <div>
                <h3>{hit.title}</h3>
                {hit.native ? <p className="native" lang="ja">{hit.native}</p> : null}
                <p className="meta">
                  {[hit.format, hit.year, hit.episodes ? `${hit.episodes} episodes` : "episode count unknown"].filter(Boolean).join(" · ")}
                </p>
                <button className="btn" type="button" onClick={() => addAniList(hit.id)}>
                  Add
                </button>
              </div>
            </article>
          ))}
        </div>
      </form>
      <form className="panel" onSubmit={addManual}>
        <h2>Enter it yourself</h2>
        <p className="hint">Use this for dramas, variety shows, or anything AniList does not list.</p>
        <label>
          Title
          <input value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} required />
        </label>
        <label>
          Japanese title
          <input lang="ja" value={manual.titleNative} onChange={(event) => setManual({ ...manual, titleNative: event.target.value })} />
        </label>
        <label>
          Episodes
          <input inputMode="numeric" value={manual.episodeCount} onChange={(event) => setManual({ ...manual, episodeCount: event.target.value })} />
        </label>
        <label>
          Kind
          <select value={manual.mediaType} onChange={(event) => setManual({ ...manual, mediaType: event.target.value })}>
            <option value="drama">Live-action</option>
            <option value="anime">Anime</option>
          </select>
        </label>
        <label>
          Cover image URL
          <input value={manual.coverUrl} onChange={(event) => setManual({ ...manual, coverUrl: event.target.value })} placeholder="https://" />
        </label>
        <button className="btn primary" type="submit">
          Create series
        </button>
      </form>
    </div>
  );
}
