import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, postJson } from "../api";
import type { ReviewCard, ReviewQueue, SeriesSummary } from "../../shared/types";

export function ReviewPage() {
  const [params] = useSearchParams();
  const seriesId = params.get("series");
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const query = seriesId ? `?seriesId=${seriesId}` : "";
    const data = await api<ReviewQueue>(`/api/review${query}`);
    setQueue(data);
    setIndex(0);
    setRevealed(false);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    api<SeriesSummary[]>("/api/series").then(setSeries).catch(() => undefined);
  }, [seriesId]);

  const card = queue?.cards[index];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card || busy) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
      }
      if (!revealed) return;
      const rating = { "1": 1, "2": 2, "3": 3, "4": 4 }[event.key];
      if (rating) void grade(card, rating);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, busy]);

  async function grade(current: ReviewCard, rating: number) {
    setBusy(true);
    try {
      await postJson(`/api/review/${current.id}`, { rating });
      const next = index + 1;
      if (queue && next < queue.cards.length) {
        setIndex(next);
        setRevealed(false);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Review</h1>
        <p>Spaced repetition with FSRS. Again, Hard, Good, and Easy schedule the next time you see the card.</p>
      </div>
      {series.length > 0 ? (
        <label className="inline">
          Series
          <select
            value={seriesId || ""}
            onChange={(event) => {
              const value = event.target.value;
              const url = value ? `/review?series=${value}` : "/review";
              window.history.pushState({}, "", url);
              window.location.assign(url);
            }}
          >
            <option value="">All series</option>
            {series.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="banner bad">{error}</p> : null}
      {!queue ? <p className="muted">Loading cards…</p> : null}
      {queue && !card ? (
        <section className="empty">
          <h2>{queue.totalCount === 0 ? "No cards yet" : "You’re caught up"}</h2>
          <p>
            {queue.totalCount === 0
              ? "Cards are created from each episode’s new vocabulary."
              : `${queue.totalCount} cards in the deck. ${queue.nextDue ? `Next one is due ${new Date(queue.nextDue).toLocaleString()}.` : ""}`}
          </p>
        </section>
      ) : null}
      {queue && card ? (
        <section className="review">
          <p className="meta">
            {index + 1} of {queue.cards.length} due now · {queue.dueCount} waiting
          </p>
          <button className="card-face" type="button" onClick={() => setRevealed(true)}>
            <span className="eyebrow">
              {card.episodeTitle ? `${card.seriesTitle} · ${card.episodeTitle}` : `${card.seriesTitle} · episode ${card.episodeNumber}`}
            </span>
            <strong lang="ja">{card.lemma}</strong>
            {revealed ? (
              <>
                <span className="reading" lang="ja">{card.reading}</span>
                <span className="badges">
                  {card.pos ? <em>{card.pos}</em> : null}
                  {card.jlpt ? <em className={`jlpt ${card.jlpt.toLowerCase()}`}>{card.jlpt}</em> : null}
                </span>
                <span className="meaning">{card.meaning}</span>
                {card.exampleJp ? <span className="example" lang="ja">{card.exampleJp}</span> : null}
                {card.exampleEn ? <span className="example-en">{card.exampleEn}</span> : null}
              </>
            ) : (
              <span className="tap">Tap to show the reading and meaning</span>
            )}
          </button>
          {revealed ? (
            <div className="grades">
              <button type="button" disabled={busy} onClick={() => grade(card, 1)}>
                Again
                <small>{card.intervals.again}</small>
              </button>
              <button type="button" disabled={busy} onClick={() => grade(card, 2)}>
                Hard
                <small>{card.intervals.hard}</small>
              </button>
              <button type="button" className="good" disabled={busy} onClick={() => grade(card, 3)}>
                Good
                <small>{card.intervals.good}</small>
              </button>
              <button type="button" disabled={busy} onClick={() => grade(card, 4)}>
                Easy
                <small>{card.intervals.easy}</small>
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
