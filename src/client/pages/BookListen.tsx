import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "../api";
import { showRuby } from "../components/Japanese";
import { attachMediaSession } from "../media";
import type { BookListenCue, BookListenView, FuriganaMode, LineToken, StudySettings } from "../../shared/types";

const AUTO_KEY = "yomu-book-autonext";

function ScriptLine({
  cue,
  furigana,
  on,
  onSeek,
  bind,
}: {
  cue: BookListenCue;
  furigana: FuriganaMode;
  on: boolean;
  onSeek: () => void;
  bind: (node: HTMLElement | null) => void;
}) {
  const [word, setWord] = useState<number | null>(null);
  const token: LineToken | null = word === null ? null : cue.tokens[word] || null;
  return (
    <article ref={bind} className={`line listen-line ${on ? "on" : ""}`} onClick={onSeek}>
      <p className={`line-jp ${furigana !== "off" ? "with-ruby" : ""}`} lang="ja">
        {cue.tokens.length
          ? cue.tokens.map((item, index) => (
              <button
                key={`${item.surface}-${index}`}
                type="button"
                className={`tok ${word === index ? "on" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setWord(word === index ? null : index);
                }}
              >
                {showRuby(item, furigana) && item.reading ? (
                  <ruby>
                    {item.surface}
                    <rt>{item.reading}</rt>
                  </ruby>
                ) : (
                  item.surface
                )}
              </button>
            ))
          : cue.text}
      </p>
      {token ? (
        <div className="gloss-pop" role="dialog" aria-label="Word meaning" onClick={(event) => event.stopPropagation()}>
          <strong lang="ja">{token.lemma}</strong>
          {token.lemmaReading || token.reading ? <span lang="ja">{token.lemmaReading || token.reading}</span> : null}
          <em>{token.pos}</em>
          <p>{token.gloss || "No gloss for this piece."}</p>
        </div>
      ) : null}
    </article>
  );
}

export function BookListenPage() {
  const { cardId, chapter } = useParams();
  const [listen, setListen] = useState<BookListenView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [furigana, setFurigana] = useState<FuriganaMode>("level");
  const [hidden, setHidden] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem(AUTO_KEY) !== "0");
  const [partIndex, setPartIndex] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [hearing, setHearing] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const seek = useRef(0);
  const partRef = useRef(0);
  const listenRef = useRef<BookListenView | null>(null);
  const nextRef = useRef<BookListenView | null>(null);
  const speedRef = useRef(1);
  const autoRef = useRef(autoNext);
  const lineRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    api<StudySettings>("/api/settings").then((settings) => setFurigana(settings.furigana)).catch(() => undefined);
  }, []);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);
  useEffect(() => {
    speedRef.current = speed;
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    autoRef.current = autoNext;
    localStorage.setItem(AUTO_KEY, autoNext ? "1" : "0");
  }, [autoNext]);

  async function load(index = chapter) {
    const next = await api<BookListenView>(`/api/books/${cardId}/chapters/${index}/listen`);
    setListen(next);
    setError(next.error);
    if (next.nextChapter !== null && next.nextReady) {
      nextRef.current = await api<BookListenView>(`/api/books/${cardId}/chapters/${next.nextChapter}/listen`).catch(() => null);
    } else nextRef.current = null;
    return next;
  }

  useEffect(() => {
    setListen(null);
    setHearing(false);
    setActive(null);
    setPartIndex(0);
    partRef.current = 0;
    load().catch((err: Error) => setError(err.message));
  }, [cardId, chapter]);

  useEffect(() => {
    if (!listen || listen.status !== "ready" || listen.nextChapter === null) return;
    const card = listen.cardId;
    const nextIndex = listen.nextChapter;
    const timer = window.setInterval(() => {
      api<BookListenView>(`/api/books/${card}/chapters/${nextIndex}/listen`)
        .then((next) => {
          if (next.status === "ready") nextRef.current = next;
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [listen?.status, listen?.nextChapter, listen?.cardId, listen?.chapterIndex]);

  useEffect(() => {
    if (listen?.status !== "pending") return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [listen?.status, cardId, chapter]);

  function globalTime(): number {
    const current = listenRef.current;
    const element = audio.current;
    if (!current || !element) return 0;
    const part = current.parts[partRef.current];
    const cue = current.cues.find((item) => item.part === part?.index);
    if (!cue) return element.currentTime;
    return cue.start - cue.offset + element.currentTime;
  }

  function markActive(index: number | null) {
    setActive(index);
    if (index === null || hidden) return;
    lineRefs.current.get(index)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function onTime() {
    const element = audio.current;
    const current = listenRef.current;
    if (!element || !current || element.paused) return;
    const time = globalTime();
    let chosen: BookListenCue | null = null;
    for (const cue of current.cues) {
      if (time + 0.05 >= cue.start) chosen = cue;
    }
    if (chosen) markActive(chosen.index);
  }

  function bindSession(cue: BookListenCue | null) {
    const element = audio.current;
    const current = listenRef.current;
    if (!element || !current) return;
    const part = current.parts[partRef.current];
    attachMediaSession(element, {
      title: cue?.text || current.label,
      artist: `${current.author} · ${current.bookTitle}`,
      album: current.label,
    }, {
      onNext: () => shiftPart(1),
      onPrevious: () => shiftPart(-1),
    });
    if (part) {
      /* album already names the chapter; part changes with the file */
    }
  }

  function onReady() {
    const element = audio.current;
    if (!element) return;
    const offset = seek.current;
    if (offset > 0.05 && element.readyState >= 1) {
      const max = Number.isFinite(element.duration) ? Math.max(0, element.duration - 0.05) : offset;
      element.currentTime = Math.min(offset, max);
    }
  }

  function playPart(nextPart: number, offset: number) {
    const current = listenRef.current;
    const element = audio.current;
    if (!current || !element || !current.parts.length) return;
    const bounded = Math.max(0, Math.min(current.parts.length - 1, nextPart));
    const part = current.parts[bounded];
    partRef.current = bounded;
    setPartIndex(bounded);
    element.muted = false;
    element.volume = 1;
    element.playbackRate = speedRef.current;
    seek.current = offset;
    const src = `/api/books/${current.cardId}/chapters/${current.chapterIndex}/listen/parts/${part.index}`;
    const absolute = new URL(src, window.location.href).href;
    const same = element.src === absolute && element.readyState >= 1;
    if (!same) element.src = src;
    else if (Math.abs(element.currentTime - offset) > 0.2) element.currentTime = offset;
    bindSession(current.cues.find((cue) => cue.part === part.index) || null);
    element.onended = () => {
      const playing = listenRef.current;
      if (!playing) return;
      if (partRef.current < playing.parts.length - 1) {
        playPart(partRef.current + 1, 0);
        return;
      }
      const upcoming = nextRef.current;
      if (autoRef.current && upcoming?.status === "ready" && upcoming.parts.length) {
        listenRef.current = upcoming;
        nextRef.current = null;
        setListen(upcoming);
        setPartIndex(0);
        partRef.current = 0;
        window.history.replaceState(null, "", `/books/${upcoming.cardId}/listen/${upcoming.chapterIndex}`);
        playPart(0, 0);
        if (upcoming.nextChapter !== null) {
          api<BookListenView>(`/api/books/${upcoming.cardId}/chapters/${upcoming.nextChapter}/listen`)
            .then((following) => {
              nextRef.current = following.status === "ready" ? following : null;
            })
            .catch(() => undefined);
        }
      }
    };
    const started = element.play();
    started.catch(() => {
      setHearing(false);
      setError("Playback did not start. Tap Play again. If the iPhone ringer switch is off, turn it on — that switch mutes this audio.");
    });
  }

  function playCue(cue: BookListenCue) {
    const current = listenRef.current;
    const partAt = current?.parts.findIndex((part) => part.index === cue.part) ?? 0;
    playPart(partAt < 0 ? 0 : partAt, cue.offset);
  }

  function shiftPart(delta: number) {
    const current = listenRef.current;
    if (!current) return;
    const next = partRef.current + delta;
    if (next >= 0 && next < current.parts.length) playPart(next, 0);
  }

  async function make() {
    setError(null);
    try {
      setListen(await postJson<BookListenView>(`/api/books/${cardId}/chapters/${chapter}/listen`, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the audio");
    }
  }

  async function saveOffline() {
    if (!listen || !("caches" in window)) return;
    const cache = await caches.open("yomu-offline-v1");
    const urls = [`/api/books/${listen.cardId}/chapters/${listen.chapterIndex}/listen`];
    for (const part of listen.parts) {
      urls.push(`/api/books/${listen.cardId}/chapters/${listen.chapterIndex}/listen/parts/${part.index}`);
    }
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("A part is not ready to save.");
      await cache.put(response.url, response);
    }
    setSaved(true);
  }

  if (!listen && !error) return <p className="page muted">Opening the chapter audio…</p>;
  if (!listen) return <p className="page banner bad">{error}</p>;

  const minutes = Math.max(1, Math.round((listen.seconds || listen.estimate.seconds) / 60));

  return (
    <div className={`page lesson ${hidden ? "listen-hidden" : ""}`}>
      <div className="page-head">
        <Link className="back" to={`/books/${listen.cardId}?c=${listen.chapterIndex}`}>
          Back to the chapter
        </Link>
        <h1 lang="ja">{listen.bookTitle}</h1>
        <p className="hint" lang="ja">{listen.label}. {listen.author}. About {minutes} min.</p>
        {listen.engineNote ? <p className="hint">{listen.engineNote}</p> : null}
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {listen.status === "pending" ? <p className="banner">{listen.progress || "Recording… Playback starts when the file is ready."}</p> : null}
      {listen.status !== "ready" && listen.status !== "pending" ? (
        <button className="btn primary" type="button" onClick={() => void make()}>
          Read this chapter aloud
        </button>
      ) : null}
      {listen.status === "ready" ? (
        <section className="panel">
          <div className="speeds" role="group" aria-label="Speed">
            {[0.75, 1, 1.25].map((value) => (
              <button key={value} className={`btn ${speed === value ? "on" : ""}`} type="button" onClick={() => setSpeed(value)}>
                {value === 1 ? "1x" : `${value}x`}
              </button>
            ))}
          </div>
          <div className="row-actions">
            <button className="btn primary" type="button" onClick={() => playPart(partIndex, audio.current && !audio.current.paused ? audio.current.currentTime : 0)}>
              Play
            </button>
            <button className="btn" type="button" onClick={() => setHidden((value) => !value)}>
              {hidden ? "Show text" : "Hide text"}
            </button>
            <button className="btn" type="button" onClick={() => void saveOffline().catch((err: Error) => setError(err.message))}>
              {saved ? "Saved on this phone" : "Save for offline"}
            </button>
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />
            Play the next chapter
          </label>
          <audio
            ref={audio}
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={onReady}
            onTimeUpdate={onTime}
            onPlaying={() => {
              setHearing(true);
              onTime();
            }}
            onPause={() => {
              setHearing(false);
              setActive(null);
            }}
            onPlay={() => bindSession(listen.cues.find((cue) => cue.index === active) || null)}
          />
          <p className="meta">
            {hearing ? "Playing" : "Paused"}. Part {partIndex + 1} of {listen.parts.length}. The highlighted line follows the audio.
          </p>
          <p className="hint">Sound uses the speaker. An iPhone on silent mutes it. Names are read from the furigana.</p>
          <div className="stack">
            {listen.parts.map((part) => (
              <div key={part.index} className="row-actions">
                <span>Part {part.index}</span>
                <a className="btn" href={`/api/books/${listen.cardId}/chapters/${listen.chapterIndex}/listen/parts/${part.index}?download=1`}>
                  Download
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="listen-script">
        {listen.cues.map((cue) => (
          <ScriptLine
            key={cue.index}
            cue={cue}
            furigana={furigana}
            on={hearing && active === cue.index}
            onSeek={() => playCue(cue)}
            bind={(node) => {
              if (node) lineRefs.current.set(cue.index, node);
              else lineRefs.current.delete(cue.index);
            }}
          />
        ))}
      </div>
    </div>
  );
}
