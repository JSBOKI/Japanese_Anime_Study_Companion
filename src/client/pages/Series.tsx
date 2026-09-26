import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { EpisodeSummary, JimakuEntry, JimakuFile, SeriesSummary } from "../../shared/types";
import { Cover } from "./Home";

type Detail = { series: SeriesSummary; episodes: EpisodeSummary[] };

export function SeriesPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jimaku, setJimaku] = useState(false);
  const [entries, setEntries] = useState<JimakuEntry[] | null>(null);
  const [files, setFiles] = useState<JimakuFile[] | null>(null);

  async function load() {
    const data = await api<Detail>(`/api/series/${id}`);
    setDetail(data);
  }

  useEffect(() => {
    api<{ jimaku: boolean }>("/api/config").then((config) => setJimaku(config.jimaku)).catch(() => undefined);
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function upload(files: FileList | File[], episodeNumber?: number) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      if (episodeNumber) body.append("episodeNumber", String(episodeNumber));
      const result = await fetch(`/api/series/${id}/subtitles`, { method: "POST", body });
      const payload = (await result.json()) as { error?: string; episodes?: { id: number }[] };
      if (!result.ok) throw new Error(payload.error || "Upload failed");
      await load();
      if (payload.episodes?.length === 1) {
        window.location.assign(`/episodes/${payload.episodes[0].id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!detail || !confirm(`Remove ${detail.series.title} and its cards?`)) return;
    await api(`/api/series/${id}`, { method: "DELETE" });
    window.location.assign("/");
  }

  async function findJimaku() {
    if (!detail) return;
    setError(null);
    try {
      const params = new URLSearchParams();
      if (detail.series.anilistId) params.set("anilistId", String(detail.series.anilistId));
      else params.set("q", detail.series.titleNative || detail.series.title);
      params.set("anime", detail.series.mediaType === "drama" ? "false" : "true");
      setEntries(await api<JimakuEntry[]>(`/api/jimaku/search?${params}`));
      setFiles(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jimaku search failed");
    }
  }

  async function openEntry(entryId: number) {
    setFiles(await api<JimakuFile[]>(`/api/jimaku/entries/${entryId}/files`));
  }

  async function takeFile(file: JimakuFile, episodeNumber: number) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/series/${id}/jimaku`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: file.url, episodeNumber }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  if (!detail && !error) return <p className="page muted">Loading…</p>;
  if (!detail) return <p className="page banner bad">{error}</p>;
  const { series, episodes } = detail;

  return (
    <div className="page">
      <div className="hero">
        <Cover url={series.coverUrl} title={series.titleNative || series.title} />
        <div>
          <h1>{series.title}</h1>
          {series.titleNative && series.titleNative !== series.title ? <p className="native" lang="ja">{series.titleNative}</p> : null}
          <p className="meta">
            {series.lessonsReady} of {episodes.length || series.episodeCount || "?"} episodes ready
            {series.cardCount ? ` · ${series.cardCount} cards` : ""}
          </p>
          {series.synopsis ? <p className="synopsis">{series.synopsis}</p> : null}
        </div>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      <section className="panel">
        <h2>Subtitles</h2>
        <p className="hint">One .srt, .ass, or .vtt per episode, or a zip of them. Numbers in the filename (episode 01, E02) are picked up automatically.</p>
        <label className={`drop file-btn ${busy ? "busy" : ""}`}>
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => {
              if (event.target.files) void upload(event.target.files);
              event.target.value = "";
            }}
          />
          {busy ? "Building the lesson…" : "Choose subtitle files"}
        </label>
        <p className="hint">On iPhone, pick the file from Files. .srt, .ass, .vtt, and .zip all work, including files the picker does not label.</p>
        <div className="row-actions">
          {series.cardCount > 0 ? (
            <>
              <a className="btn" href={`/api/series/${series.id}/export.csv`}>
                Export CSV
              </a>
              <a className="btn" href={`/api/series/${series.id}/export.apkg`}>
                Export Anki
              </a>
            </>
          ) : null}
          <Link className="btn" to={`/review?series=${series.id}`}>
            Review this series
          </Link>
        </div>
      </section>
      {jimaku ? (
        <section className="panel">
          <h2>Jimaku</h2>
          <p className="hint">Optional. Search the Jimaku library for this show and attach a file to an episode.</p>
          <button className="btn" type="button" onClick={findJimaku}>
            Search Jimaku
          </button>
          <div className="stack">
            {entries?.map((entry) => (
              <button key={entry.id} className="text-btn" type="button" onClick={() => openEntry(entry.id)}>
                {entry.englishName || entry.name}
                {entry.japaneseName ? <small lang="ja"> {entry.japaneseName}</small> : null}
              </button>
            ))}
            {files?.slice(0, 30).map((file) => (
              <div key={file.url} className="file-row">
                <span>{file.name}</span>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => takeFile(file, file.episodeGuess || 1)}
                >
                  Use for ep {file.episodeGuess || 1}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="hint aside">Jimaku search is off until you set JIMAKU_API_KEY. Uploading your own subtitles works without it.</p>
      )}
      <ol className="episodes">
        {episodes.map((episode) => (
          <li key={episode.id}>
            <div>
              <strong>Episode {episode.number}</strong>
              {episode.title && episode.title !== `Episode ${episode.number}` ? <span> {episode.title}</span> : null}
              <p className="meta">
                {episode.hasLesson ? `${episode.newWords} new words · ${episode.cueCount} lines` : "No subtitle yet"}
                {episode.audioStatus === "ready" ? " · audio ready" : ""}
                {episode.audioStatus === "pending" ? " · making audio" : ""}
              </p>
            </div>
            <div className="row-actions">
              {episode.hasLesson ? (
                <Link className="btn primary" to={`/episodes/${episode.id}`}>
                  Lesson
                </Link>
              ) : null}
              <label className="btn file-btn">
                Upload
                <input
                  type="file"
                  onChange={(event) => {
                    if (event.target.files) void upload(event.target.files, episode.number);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </li>
        ))}
      </ol>
      <button className="btn danger" type="button" onClick={remove}>
        Remove series
      </button>
    </div>
  );
}
