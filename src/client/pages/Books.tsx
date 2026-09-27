import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, postJson } from "../api";
import type { BookSearchHit, BookShelfItem } from "../../shared/types";

export function BooksPage() {
  const [books, setBooks] = useState<BookShelfItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BookSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    return api<{ books: BookShelfItem[] }>("/api/books").then((body) => setBooks(body.books));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ hits: BookSearchHit[] }>(`/api/books/search?q=${encodeURIComponent(q)}`);
      setHits(body.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function add(cardId: number) {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/books", { cardId });
      await load();
      setHits((current) => current?.map((hit) => (hit.cardId === cardId ? { ...hit, added: true } : hit)) || current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that book");
    } finally {
      setBusy(false);
    }
  }

  if (!books && !error) return <p className="page muted">Opening the shelf…</p>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Books</h1>
        <p className="hint">
          Public-domain Japanese from Aozora Bunko. Kokoro is the N2 novel to start with. Difficulty is an honest guess for an adult reader, not a grade.
        </p>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      <form className="search-row" onSubmit={(event) => void search(event)}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Aozora by title or author"
          aria-label="Search Aozora"
          enterKeyHint="search"
        />
        <button className="btn primary" type="submit" disabled={busy}>
          Search
        </button>
      </form>
      {hits ? (
        <section className="stack">
          <h2>Aozora</h2>
          {hits.length === 0 ? <p className="muted">No public-domain match.</p> : null}
          {hits.map((hit) => (
            <article key={hit.cardId} className="book-card">
              <div>
                <h2 lang="ja">{hit.title}</h2>
                <p className="meta" lang="ja">{hit.author}{hit.orthography ? ` · ${hit.orthography}` : ""}</p>
              </div>
              {hit.added ? (
                <Link className="btn" to={`/books/${hit.cardId}`}>Open</Link>
              ) : (
                <button className="btn" type="button" disabled={busy} onClick={() => void add(hit.cardId)}>
                  Add
                </button>
              )}
            </article>
          ))}
        </section>
      ) : null}
      <section className="stack">
        {(books || []).map((book) => {
          const href = book.progress
            ? `/books/${book.cardId}?c=${book.progress.chapterIndex}&p=${book.progress.paragraphIndex}`
            : `/books/${book.cardId}`;
          return (
            <Link key={book.cardId} className="book-card" to={href}>
              <div>
                <h2 lang="ja">{book.title}</h2>
                {book.titleKana && book.titleKana !== book.title ? <p className="meta" lang="ja">{book.titleKana}</p> : null}
                <p className="meta" lang="ja">{book.author}</p>
                <p className="news-meta">
                  {book.difficulty ? <span>{book.difficulty}</span> : null}
                  {book.lengthLabel ? <span>{book.lengthLabel}</span> : null}
                  {book.chapterCount ? <span>{book.chapterCount} chapters</span> : null}
                </p>
                {book.summary ? <p className="hint">{book.summary}</p> : null}
                {book.progress?.chapterTitle ? <p className="meta">Continue · {book.progress.chapterTitle}</p> : null}
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
