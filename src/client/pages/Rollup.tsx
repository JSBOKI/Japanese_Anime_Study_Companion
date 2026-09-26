import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, postJson } from "../api";
import { attachMediaSession } from "../media";
import type { RollupBuild, RollupPick, RollupPart } from "../../shared/types";

type Lang = "ja" | "en" | "both";

export function RollupPage() {
  const [picks, setPicks] = useState<RollupPick[]>([]);
  const [build, setBuild] = useState<RollupBuild | null>(null);
  const [lang, setLang] = useState<Lang>("ja");
  const [speed, setSpeed] = useState(1);
  const [clearAfter, setClearAfter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const indexRef = useRef(0);
  const [partIndex, setPartIndex] = useState(0);

  async function load() {
    const body = await api<{ picks: RollupPick[]; build: RollupBuild | null }>("/api/news/rollup");
    setPicks(body.picks);
    setBuild(body.build);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (build?.status !== "running") return;
    const timer = window.setInterval(() => {
      api<RollupBuild>(`/api/news/rollup/${build.id}`)
        .then((next) => {
          setBuild(next);
          if (next.status !== "running" && clearAfter) {
            api<{ picks: RollupPick[] }>("/api/news/rollup").then((body) => setPicks(body.picks)).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [build?.id, build?.status, clearAfter]);

  async function updatePick(storyId: number, checked: boolean, includeDeep: boolean) {
    const body = await postJson<{ picks: RollupPick[] }>("/api/news/rollup", { storyId, checked, includeDeep: checked && includeDeep });
    setPicks(body.picks);
  }

  async function clearAll() {
    const body = await api<{ picks: RollupPick[] }>("/api/news/rollup", { method: "DELETE" });
    setPicks(body.picks);
  }

  async function buildRollup() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await postJson<RollupBuild>("/api/news/rollup/build", { lang, speed, clearAfter });
      setBuild(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the roll-up");
    } finally {
      setBusy(false);
    }
  }

  function playPart(nextIndex: number) {
    const current = build;
    const element = audio.current;
    if (!current || !element || !current.parts.length) return;
    const bounded = Math.max(0, Math.min(current.parts.length - 1, nextIndex));
    const part = current.parts[bounded];
    indexRef.current = bounded;
    setPartIndex(bounded);
    element.src = `/api/news/rollup/${current.id}/parts/${part.index}`;
    element.playbackRate = 1;
    element.onended = () => {
      if (indexRef.current < current.parts.length - 1) playPart(indexRef.current + 1);
    };
    attachMediaSession(element, {
      title: part.label,
      artist: "Yomu",
      album: `Part ${part.index} of ${current.parts.length}`,
    }, {
      onNext: () => playPart(indexRef.current + 1),
      onPrevious: () => playPart(indexRef.current - 1),
    });
    void element.play();
  }

  async function sharePart(part: RollupPart) {
    if (!build) return;
    const url = `/api/news/rollup/${build.id}/parts/${part.index}?download=1`;
    const response = await fetch(url);
    const blob = await response.blob();
    const name = `yomu-rollup-part-${part.index}.mp3`;
    const file = new File([blob], name, { type: "audio/mpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: part.label });
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
  }

  async function saveOffline() {
    if (!build || !("caches" in window)) return;
    const cache = await caches.open("yomu-offline-v1");
    for (const part of build.parts) {
      const response = await fetch(`/api/news/rollup/${build.id}/parts/${part.index}`);
      if (!response.ok) throw new Error("A part is not ready to save.");
      await cache.put(response.url, response);
    }
    setSaved(true);
  }

  return (
    <div className="page">
      <div className="page-head">
        <Link className="back" to="/news">News</Link>
        <h1>Roll-up</h1>
        <p>Checked stories play as one drive. Parts keep going on the lock screen, including next and previous.</p>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {picks.length === 0 ? <p className="empty">No stories checked yet. Use the boxes on Today.</p> : null}
      <div className="stack">
        {picks.map((pick, index) => (
          <article key={pick.storyId} className="panel">
            <label className="inline-check">
              <input
                type="checkbox"
                checked
                aria-label={`Remove ${pick.title} from the roll-up`}
                onChange={() => void updatePick(pick.storyId, false, false)}
              />
              <span>Story {index + 1}</span>
            </label>
            <h2 lang="ja">{pick.title}</h2>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={pick.includeDeep}
                aria-label={`Include the deep dive for ${pick.title}`}
                onChange={(event) => void updatePick(pick.storyId, true, event.target.checked)}
              />
              Include the deep dive
            </label>
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>Build roll-up</h2>
        <div className="speeds" role="group" aria-label="Language">
          {(["ja", "en", "both"] as Lang[]).map((value) => (
            <button key={value} className={`btn ${lang === value ? "on" : ""}`} type="button" onClick={() => setLang(value)}>
              {value === "ja" ? "Japanese" : value === "en" ? "English" : "JA then EN"}
            </button>
          ))}
        </div>
        <div className="speeds" role="group" aria-label="Speed">
          {[0.75, 1, 1.25].map((value) => (
            <button key={value} className={`btn ${speed === value ? "on" : ""}`} type="button" onClick={() => setSpeed(value)}>
              {value === 1 ? "1x" : `${value}x`}
            </button>
          ))}
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={clearAfter} onChange={(event) => setClearAfter(event.target.checked)} />
          Clear the checks after this build
        </label>
        <div className="row-actions">
          <button className="btn primary" type="button" disabled={busy || build?.status === "running" || picks.length === 0} onClick={() => void buildRollup()}>
            {build?.status === "running" ? "Building…" : "Build roll-up"}
          </button>
          <button className="btn" type="button" onClick={() => void clearAll()} disabled={picks.length === 0}>
            Clear checks
          </button>
        </div>
        {build?.message ? <p className="hint">{build.message}</p> : null}
      </section>
      {build && build.parts.length ? (
        <section className="panel" id="player">
          <h2>Play</h2>
          <p className="meta">Part {partIndex + 1} of {build.parts.length}. {build.parts[partIndex]?.label}</p>
          <audio ref={audio} controls preload="none" />
          <div className="row-actions">
            <button className="btn primary" type="button" onClick={() => playPart(0)}>Play</button>
            <button className="btn" type="button" onClick={() => playPart(partIndex - 1)}>Previous</button>
            <button className="btn" type="button" onClick={() => playPart(partIndex + 1)}>Next</button>
            <button className="btn" type="button" onClick={() => void saveOffline()}>{saved ? "Saved on this phone" : "Save for offline"}</button>
          </div>
          <div className="stack">
            {build.parts.map((part) => (
              <div key={part.index} className="row-actions">
                <span>Part {part.index} · {Math.max(1, Math.round(part.seconds / 60))} min</span>
                <a className="btn" href={`/api/news/rollup/${build.id}/parts/${part.index}?download=1`}>Download</a>
                <button className="btn" type="button" onClick={() => void sharePart(part)}>Share</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
