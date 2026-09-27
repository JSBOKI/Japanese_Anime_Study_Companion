import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, postJson } from "../api";
import { ReadingText } from "../components/Japanese";
import type { BookChapterView, BookDetail, FuriganaMode, StudySettings } from "../../shared/types";

const FURIGANA: FuriganaMode[] = ["level", "all", "off"];

export function BookReadPage() {
  const { cardId } = useParams();
  const [params, setParams] = useSearchParams();
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [chapter, setChapter] = useState<BookChapterView | null>(null);
  const [furigana, setFurigana] = useState<FuriganaMode>("level");
  const [english, setEnglish] = useState(false);
  const [contents, setContents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cards, setCards] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requested = params.get("c");
  const paragraph = Number(params.get("p") || "0");

  useEffect(() => {
    api<StudySettings>("/api/settings").then((settings) => setFurigana(settings.furigana)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancel = false;
    setDetail(null);
    setChapter(null);
    setError(null);
    api<BookDetail>(`/api/books/${cardId}`)
      .then((next) => {
        if (!cancel) {
          setDetail(next);
          if (next.job?.message) setJobNote(next.job.message);
        }
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [cardId]);

  const chapterIndex = requested !== null && requested !== ""
    ? Number(requested)
    : detail?.progress?.chapterIndex || 0;

  useEffect(() => {
    if (!detail || !cardId) return;
    let cancel = false;
    setChapter(null);
    api<BookChapterView>(`/api/books/${cardId}/chapters/${chapterIndex}`)
      .then((next) => {
        if (cancel) return;
        setChapter(next);
        setEnglish(next.translated);
        const start = requested !== null ? paragraph : detail.progress?.chapterIndex === chapterIndex ? detail.progress.paragraphIndex : 0;
        window.setTimeout(() => {
          document.getElementById(`p-${start}`)?.scrollIntoView({ block: "center" });
        }, 40);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [detail, cardId, chapterIndex]);

  useEffect(() => {
    if (!chapter || !cardId) return;
    let timer = 0;
    const nodes = [...document.querySelectorAll<HTMLElement>("[data-paragraph]")];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        const index = Number((visible.target as HTMLElement).dataset.paragraph || "0");
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          postJson(`/api/books/${cardId}/progress`, { chapterIndex: chapter.index, paragraphIndex: index }).catch(() => undefined);
        }, 400);
      },
      { rootMargin: "-15% 0px -55% 0px", threshold: 0.15 },
    );
    for (const node of nodes) observer.observe(node);
    postJson(`/api/books/${cardId}/progress`, { chapterIndex: chapter.index, paragraphIndex: Math.max(0, paragraph) }).catch(() => undefined);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [chapter, cardId]);

  async function cycleFurigana() {
    const next = FURIGANA[(FURIGANA.indexOf(furigana) + 1) % FURIGANA.length];
    setFurigana(next);
    await postJson("/api/settings", { furigana: next }).catch(() => undefined);
  }

  async function showEnglish() {
    if (!chapter) return;
    if (english) {
      setEnglish(false);
      return;
    }
    if (chapter.translated) {
      setEnglish(true);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const body = await postJson<{ translations: string[] | null; note: string | null }>(
        `/api/books/${cardId}/chapters/${chapter.index}/translate`,
        {},
      );
      if (body.note) setNote(body.note);
      if (body.translations) {
        setChapter({
          ...chapter,
          translated: true,
          paragraphs: chapter.paragraphs.map((paragraphItem, index) => ({
            ...paragraphItem,
            translation: body.translations?.[index] || null,
          })),
        });
        setEnglish(true);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not translate this chapter");
    } finally {
      setBusy(false);
    }
  }

  async function addCards() {
    if (!chapter) return;
    setBusy(true);
    setCards(null);
    try {
      const body = await postJson<{ added: number; skipped: number }>(`/api/books/${cardId}/chapters/${chapter.index}/cards`, {});
      setCards(body.added ? `Added ${body.added} word${body.added === 1 ? "" : "s"} to Review.` : "Those words are already in Review.");
    } catch (err) {
      setCards(err instanceof Error ? err.message : "Could not add words");
    } finally {
      setBusy(false);
    }
  }

  async function wholeBook() {
    setBusy(true);
    setJobNote(null);
    try {
      const job = await postJson<{ message: string | null }>(`/api/books/${cardId}/listen`, {});
      setJobNote(job.message || "Recording the book, one chapter at a time.");
    } catch (err) {
      setJobNote(err instanceof Error ? err.message : "Could not start the book audio");
    } finally {
      setBusy(false);
    }
  }

  function openChapter(index: number) {
    setContents(false);
    setParams({ c: String(index), p: "0" });
  }

  if (!detail && !error) return <p className="page muted">Fetching the text from Aozora Bunko…</p>;
  if (!detail) return <p className="page banner bad">{error}</p>;
  const furiganaLabel = furigana === "all" ? "Furigana all" : furigana === "off" ? "Furigana off" : "Furigana by level";
  let lastPart: string | null = null;

  return (
    <div className="page lesson">
      <div className="page-head">
        <Link className="back" to="/books">Books</Link>
        <h1 lang="ja">{detail.title}</h1>
        <p className="hint" lang="ja">
          {detail.author}
          {detail.difficulty ? ` · ${detail.difficulty}` : ""}
          {detail.lengthLabel ? ` · ${detail.lengthLabel}` : ""}
        </p>
        {detail.summary ? <p className="hint">{detail.summary}</p> : null}
        {detail.sourceUrl ? (
          <p className="meta">
            <a href={detail.sourceUrl} target="_blank" rel="noreferrer">Aozora Bunko card</a>
          </p>
        ) : null}
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {note ? <p className="banner">{note}</p> : null}
      {cards ? <p className="banner">{cards}</p> : null}
      {jobNote ? <p className="banner">{jobNote}</p> : null}
      <div className="row-actions">
        <button className={`btn ${furigana !== "off" ? "primary" : ""}`} type="button" onClick={() => void cycleFurigana()}>
          {furiganaLabel}
        </button>
        <button className="btn" type="button" onClick={() => setContents((value) => !value)}>
          {contents ? "Hide contents" : "Contents"}
        </button>
        <button className="btn" type="button" disabled={busy || !chapter} onClick={() => void addCards()}>
          Add words to flashcards
        </button>
        <button className="btn" type="button" disabled={busy || !chapter} onClick={() => void showEnglish()}>
          {english ? "Hide English" : "English"}
        </button>
      </div>
      {contents ? (
        <nav className="panel toc" aria-label="Contents">
          {detail.chapters.map((item) => {
            const part = item.partTitle && item.partTitle !== item.title ? item.partTitle : null;
            const showPart = part && part !== lastPart;
            if (part) lastPart = part;
            return (
              <div key={item.index}>
                {showPart ? <p className="meta">{part}</p> : null}
                <button className={`btn toc-item ${item.index === chapter?.index ? "on" : ""}`} type="button" onClick={() => openChapter(item.index)}>
                  <span lang="ja">{item.title}</span>
                  <small>{item.charCount} chars</small>
                </button>
              </div>
            );
          })}
        </nav>
      ) : null}
      {!chapter ? <p className="muted">Opening the chapter…</p> : (
        <>
          <div className="section-head">
            <h2 lang="ja">{chapter.label}</h2>
          </div>
          <div className="row-actions">
            <Link className="btn primary" to={`/books/${cardId}/listen/${chapter.index}`}>
              Read this chapter aloud
            </Link>
            <button className="btn" type="button" disabled={busy} onClick={() => void wholeBook()}>
              Make audio for the whole book
            </button>
          </div>
          {chapter.paragraphs.map((item) => (
            <article key={item.index} id={`p-${item.index}`} data-paragraph={item.index} className="line">
              <ReadingText tokens={item.tokens} furigana={furigana} />
              {english && item.translation ? <p className="meaning">{item.translation}</p> : null}
            </article>
          ))}
          <div className="row-actions">
            {chapter.index > 0 ? (
              <button className="btn" type="button" onClick={() => openChapter(chapter.index - 1)}>Previous chapter</button>
            ) : null}
            {chapter.index + 1 < chapter.chapterCount ? (
              <button className="btn" type="button" onClick={() => openChapter(chapter.index + 1)}>Next chapter</button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
