import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "../api";
import { showRuby } from "../components/Japanese";
import { attachMediaSession } from "../media";
import type { FuriganaMode, LineToken, ListenAlong, ListenCue, StudySettings } from "../../shared/types";

const AUTO_KEY = "yomu-listen-autonext";

function ListenLine({
  cue,
  furigana,
  on,
  showEnglish,
  onSeek,
  onToggleEnglish,
  bind,
}: {
  cue: ListenCue;
  furigana: FuriganaMode;
  on: boolean;
  showEnglish: boolean;
  onSeek: () => void;
  onToggleEnglish: () => void;
  bind: (node: HTMLElement | null) => void;
}) {
  const [word, setWord] = useState<number | null>(null);
  const token: LineToken | null = word === null ? null : cue.tokens[word] || null;
  return (
    <article ref={bind} className={`line listen-line ${on ? "on" : ""}`} onClick={onSeek}>
      <p className="meta">{cue.speaker || `Line ${cue.index + 1}`}</p>
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
                {showRuby(item, furigana) ? (
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
      {showEnglish ? <p className="meaning">{cue.translation || cue.gloss || "No English for this line."}</p> : null}
      <button
        className="btn"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleEnglish();
        }}
      >
        {showEnglish ? "Hide English" : "English"}
      </button>
    </article>
  );
}

export function ListenPage() {
  const { id } = useParams();
  const [listen, setListen] = useState<ListenAlong | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [furigana, setFurigana] = useState<FuriganaMode>("level");
  const [english, setEnglish] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem(AUTO_KEY) === "1");
  const [partIndex, setPartIndex] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [hearing, setHearing] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const seek = useRef(0);
  const partRef = useRef(0);
  const listenRef = useRef<ListenAlong | null>(null);
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

  async function load() {
    const next = await api<ListenAlong>(`/api/episodes/${id}/listen`);
    setListen(next);
    setError(next.error);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (listen?.status !== "pending") return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [listen?.status, id]);

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
    let chosen: ListenCue | null = null;
    for (const cue of current.cues) {
      if (time + 0.05 >= cue.start) chosen = cue;
    }
    if (chosen) markActive(chosen.index);
  }

  function bindSession(cue: ListenCue | null) {
    const element = audio.current;
    const current = listenRef.current;
    if (!element || !current) return;
    const part = current.parts[partRef.current];
    attachMediaSession(element, {
      title: cue?.text || `Episode ${current.number}`,
      artist: current.seriesTitle,
      album: `Listen along · part ${part?.index || 1}`,
    }, {
      onNext: () => shiftPart(1),
      onPrevious: () => shiftPart(-1),
    });
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
    const src = `/api/episodes/${current.episodeId}/listen/parts/${part.index}`;
    const absolute = new URL(src, window.location.href).href;
    const same = element.src === absolute && element.readyState >= 1;
    if (!same) element.src = src;
    else if (Math.abs(element.currentTime - offset) > 0.2) element.currentTime = offset;
    bindSession(current.cues.find((cue) => cue.part === part.index) || null);
    element.onended = () => {
      if (partRef.current < (listenRef.current?.parts.length || 1) - 1) playPart(partRef.current + 1, 0);
      else if (autoRef.current && listenRef.current?.nextEpisodeId) {
        window.location.assign(`/episodes/${listenRef.current.nextEpisodeId}/listen`);
      }
    };
    const started = element.play();
    started.catch(() => {
      setHearing(false);
      setError("Playback did not start. Tap Play again. If the iPhone ringer switch is off, turn it on — that switch mutes this audio.");
    });
  }

  function playCue(cue: ListenCue | null) {
    if (!cue) {
      playPart(0, 0);
      return;
    }
    const current = listenRef.current;
    const partAt = current?.parts.findIndex((part) => part.index === cue.part) ?? 0;
    playPart(partAt, cue.offset);
  }

  function shiftPart(delta: number) {
    const current = listenRef.current;
    if (!current) return;
    const next = partRef.current + delta;
    if (next >= 0 && next < current.parts.length) playPart(next, 0);
    else if (delta > 0 && autoRef.current && current.nextEpisodeId) {
      window.location.assign(`/episodes/${current.nextEpisodeId}/listen?play=1`);
    }
  }

  async function make() {
    setError(null);
    try {
      setListen(await postJson<ListenAlong>(`/api/episodes/${id}/listen`, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the audio");
    }
  }

  async function saveOffline() {
    if (!listen || !("caches" in window)) return;
    const cache = await caches.open("yomu-offline-v1");
    const urls = [`/api/episodes/${listen.episodeId}`, `/api/episodes/${listen.episodeId}/listen`];
    for (const part of listen.parts) urls.push(`/api/episodes/${listen.episodeId}/listen/parts/${part.index}`);
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("A part is not ready to save.");
      await cache.put(response.url, response);
    }
    setSaved(true);
  }

  async function sharePart(index: number) {
    if (!listen) return;
    const response = await fetch(`/api/episodes/${listen.episodeId}/listen/parts/${index}?download=1`);
    const blob = await response.blob();
    const file = new File([blob], `yomu-listen-part-${index}.mp3`, { type: "audio/mpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Episode ${listen.number}` });
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
  }

  if (!listen && !error) return <p className="page muted">Opening listen-along…</p>;
  if (!listen) return <p className="page banner bad">{error}</p>;

  const minutes = Math.max(1, Math.round((listen.seconds || listen.estimate.seconds) / 60));
  const megabytes = Math.max(1, Math.round((listen.bytes || listen.estimate.bytes) / (1024 * 1024)));

  return (
    <div className={`page lesson ${hidden ? "listen-hidden" : ""}`}>
      <div className="page-head">
        <Link className="back" to={`/episodes/${listen.episodeId}`}>
          Episode {listen.number}
        </Link>
        <h1>Listen along</h1>
        <p className="hint">{listen.seriesTitle}. About {minutes} min · about {megabytes} MB.</p>
        {listen.engineNote ? <p className="hint">{listen.engineNote}</p> : null}
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {listen.diskWarning ? <p className="banner">{listen.diskWarning}</p> : null}
      {listen.status === "pending" ? <p className="banner">{listen.progress || "Making the episode audio…"}</p> : null}
      {listen.status !== "ready" && listen.status !== "pending" ? (
        <button className="btn primary" type="button" onClick={() => void make()}>
          Make episode audio
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
            <button className="btn primary" type="button" onClick={() => playPart(partIndex, audio.current?.currentTime || 0)}>
              Play
            </button>
            <button className="btn" type="button" onClick={() => setHidden((value) => !value)}>
              {hidden ? "Show text" : "Hide text"}
            </button>
            <button className="btn" type="button" onClick={() => void saveOffline()}>
              {saved ? "Saved on this phone" : "Save for offline"}
            </button>
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />
            Play the next episode
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
          <p className="meta">{hearing ? "Playing" : "Paused"}. Part {partIndex + 1} of {listen.parts.length}. The highlighted line follows the audio.</p>
          <p className="hint">Sound uses the speaker. An iPhone on silent mutes it. This page does not use the Web Speech API.</p>
          <div className="stack">
            {listen.parts.map((part) => (
              <div key={part.index} className="row-actions">
                <span>Part {part.index}</span>
                <a className="btn" href={`/api/episodes/${listen.episodeId}/listen/parts/${part.index}?download=1`}>Download</a>
                <button className="btn" type="button" onClick={() => void sharePart(part.index)}>Share</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="listen-script">
        {listen.cues.map((cue) => (
          <ListenLine
            key={cue.index}
            cue={cue}
            furigana={furigana}
            on={active === cue.index}
            showEnglish={english.has(cue.index)}
            onSeek={() => playCue(cue)}
            onToggleEnglish={() =>
              setEnglish((current) => {
                const next = new Set(current);
                if (next.has(cue.index)) next.delete(cue.index);
                else next.add(cue.index);
                return next;
              })
            }
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
