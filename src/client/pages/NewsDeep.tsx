import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "../api";
import { ReadingText } from "../components/Japanese";
import { attachMediaSession } from "../media";
import type { DeepDive, DiveSource, FuriganaMode, RollupPick, StudySettings } from "../../shared/types";

type Lang = "ja" | "en";

export function NewsDeepPage() {
  const { id } = useParams();
  const [dive, setDive] = useState<DeepDive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("ja");
  const [furigana, setFurigana] = useState<FuriganaMode>("level");
  const [english, setEnglish] = useState<Set<number>>(new Set());
  const [pick, setPick] = useState<RollupPick | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    api<StudySettings>("/api/settings").then((settings) => setFurigana(settings.furigana)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setDive(null);
    setError(null);
    postJson<DeepDive>(`/api/news/${id}/deeper`, {})
      .then(setDive)
      .catch((err: Error) => setError(err.message));
    api<{ picks: RollupPick[] }>("/api/news/rollup")
      .then((body) => setPick(body.picks.find((item) => item.storyId === Number(id)) || null))
      .catch(() => undefined);
  }, [id]);

  async function refresh() {
    setError(null);
    setDive(null);
    try {
      setDive(await postJson<DeepDive>(`/api/news/${id}/deeper`, { refresh: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the sources");
    }
  }

  async function setRollup(checked: boolean, includeDeep: boolean) {
    const body = await postJson<{ picks: RollupPick[] }>("/api/news/rollup", {
      storyId: Number(id),
      checked,
      includeDeep: checked && includeDeep,
    });
    setPick(body.picks.find((item) => item.storyId === Number(id)) || null);
  }

  if (!dive && !error) return <p className="page muted">Gathering related coverage…</p>;
  if (!dive) return <p className="page banner bad">{error}</p>;

  const lesson = dive.lesson;
  const showEnglish = (index: number) => Boolean(lesson?.revealEnglish) || english.has(index);

  return (
    <div className="page lesson">
      <div className="page-head">
        <Link className="back" to={`/news/${dive.storyId}`}>
          {dive.title}
        </Link>
        <h1>Go deeper</h1>
        <div className="row-actions">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(pick)}
              aria-label="Add this story to the roll-up"
              onChange={(event) => void setRollup(event.target.checked, Boolean(pick?.includeDeep))}
            />
            Roll-up
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(pick?.includeDeep)}
              aria-label="Include the deep dive in the roll-up"
              onChange={(event) => void setRollup(true, event.target.checked)}
            />
            Include deep dive
          </label>
        </div>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {dive.needsKey ? <p className="banner">{dive.note}</p> : null}
      {dive.reactionNote ? <p className="hint">{dive.reactionNote}</p> : null}

      {!dive.needsKey ? (
        <>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button className={`btn ${lang === "ja" ? "on" : ""}`} type="button" onClick={() => setLang("ja")}>JA</button>
            <button className={`btn ${lang === "en" ? "on" : ""}`} type="button" onClick={() => setLang("en")}>EN</button>
          </div>
          {lang === "ja" && lesson ? (
            <section>
              <h2>Reading</h2>
              <p className="hint">Tap a word you do not know. Furigana stays on kanji above your level.</p>
              {(lesson.passages || []).map((passage) => (
                <article key={passage.index} className="passage">
                  <ReadingText tokens={passage.tokens} furigana={furigana} />
                  {showEnglish(passage.index) ? <p className="meaning">{passage.translation || passage.gloss}</p> : null}
                  {!lesson.revealEnglish ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        setEnglish((current) => {
                          const next = new Set(current);
                          if (next.has(passage.index)) next.delete(passage.index);
                          else next.add(passage.index);
                          return next;
                        })
                      }
                    >
                      {english.has(passage.index) ? "Hide English" : "English"}
                    </button>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
          {lang === "en" ? (
            <section className="panel">
              <h2>English</h2>
              {dive.paragraphsEn.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="english-body">{paragraph}</p>
              ))}
            </section>
          ) : null}
          <section className="panel" id="listen">
            <h2>{lang === "ja" ? "Listen JA" : "Listen EN"}</h2>
            <audio
              ref={audio}
              controls
              preload="none"
              src={`/api/news/${dive.storyId}/deeper/audio/${lang}`}
              onPlay={() => {
                if (!audio.current) return;
                attachMediaSession(audio.current, { title: `Deep dive: ${dive.title}`, artist: "Yomu News", album: lang === "ja" ? "Japanese" : "English" });
              }}
            />
          </section>
        </>
      ) : null}

      <section>
        <div className="section-head">
          <h2>Sources</h2>
          <button className="btn" type="button" onClick={() => void refresh()}>Refresh sources</button>
        </div>
        <div className="stack">
          {dive.sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SourceCard({ source }: { source: DiveSource }) {
  return (
    <article className="panel">
      <p className="meta">
        {source.publisher}
        {source.kind === "opinion" ? " · Opinion" : ""}
        {source.kind === "reaction" ? " · Reaction" : ""}
        {source.lang === "en" ? " · English" : ""}
      </p>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
    </article>
  );
}
