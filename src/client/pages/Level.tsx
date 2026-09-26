import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, postJson } from "../api";
import type { FuriganaMode, PassageLength, StudyLevel, StudySettings } from "../../shared/types";

const LEVELS: { id: StudyLevel; name: string; detail: string }[] = [
  { id: "N5", name: "N5", detail: "First kana and everyday words. English stays open. Furigana on harder kanji." },
  { id: "N4", name: "N4", detail: "Elementary patterns. English stays open." },
  { id: "N3", name: "N3", detail: "Intermediate. Easier words drop out. English stays closed until you tap." },
  { id: "N2", name: "N2", detail: "Advanced, and the default. Cards and drills stay on N2 and N1." },
  { id: "N1", name: "N1", detail: "The hardest band. Furigana only where the dictionary has no JLPT tag." },
];

export function LevelPage() {
  const [settings, setSettings] = useState<StudySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuilt, setRebuilt] = useState<number | null>(null);

  useEffect(() => {
    api<StudySettings>("/api/settings")
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load settings"));
  }, []);

  async function save(patch: Partial<StudySettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setRebuilt(null);
    setError(null);
    try {
      setSettings(await postJson<StudySettings>("/api/settings", next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the level");
    }
  }

  async function rebuildAll() {
    setRebuilding(true);
    setError(null);
    try {
      const result = await postJson<{ rebuilt: number }>("/api/lessons/rebuild", {});
      setRebuilt(result.rebuilt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }

  if (!settings && !error) return <p className="page muted">Loading level…</p>;
  if (!settings) return <p className="page banner bad">{error}</p>;

  return (
    <div className="page level-page">
      <div className="page-head">
        <Link className="back" to="/">
          Library
        </Link>
        <h1>Level</h1>
        <p>
          Readings, flashcards, and audio drills follow this setting. Words and patterns below it are left out. Change it here, then rebuild a lesson so the passage matches.
        </p>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      <section className="panel">
        <h2>JLPT band</h2>
        <div className="choice-grid">
          {LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              className={`choice ${settings.level === level.id ? "on" : ""}`}
              onClick={() => void save({ level: level.id })}
            >
              <strong>{level.name}</strong>
              <span>{level.detail}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Passage length</h2>
        <div className="choice-grid two">
          <button
            type="button"
            className={`choice ${settings.passage === "scene" ? "on" : ""}`}
            onClick={() => void save({ passage: "scene" satisfies PassageLength })}
          >
            <strong>Scene</strong>
            <span>A contiguous stretch, a few hundred characters, then the next scene.</span>
          </button>
          <button
            type="button"
            className={`choice ${settings.passage === "long" ? "on" : ""}`}
            onClick={() => void save({ passage: "long" satisfies PassageLength })}
          >
            <strong>Longer</strong>
            <span>Keep going. Passages aim past nine hundred characters when the episode has them.</span>
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Furigana</h2>
        <div className="choice-grid">
          {(
            [
              ["level", "By level", "Readings only on kanji harder than your band. At-level kanji stay bare."],
              ["all", "All kanji", "A reading over every kanji, including ones at your level."],
              ["off", "Off", "No furigana. Tap a word when you need the reading."],
            ] as [FuriganaMode, string, string][]
          ).map(([id, name, detail]) => (
            <button
              key={id}
              type="button"
              className={`choice ${settings.furigana === id ? "on" : ""}`}
              onClick={() => void save({ furigana: id })}
            >
              <strong>{name}</strong>
              <span>{detail}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Rebuild</h2>
        <p className="hint">
          Lessons already on disk keep the level they were built at until you rebuild them. Rebuilding rewrites the passage, the word list, and the audio. Flashcard review history stays.
        </p>
        <button className="btn primary" type="button" disabled={rebuilding} onClick={() => void rebuildAll()}>
          {rebuilding ? "Rebuilding…" : "Rebuild every lesson"}
        </button>
        {rebuilt !== null ? (
          <p className="hint">{rebuilt === 0 ? "No subtitle lessons to rebuild yet." : `Rebuilt ${rebuilt} lesson${rebuilt === 1 ? "" : "s"}.`}</p>
        ) : null}
      </section>
    </div>
  );
}
