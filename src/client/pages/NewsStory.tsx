import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "../api";
import { FuriganaWord, ReadingText } from "../components/Japanese";
import { attachMediaSession } from "../media";
import { isNewsOffline, saveNewsOffline } from "../offline";
import type { FuriganaMode, NewsDetail, RollupPick, StudyLevel, StudySettings, VocabItem } from "../../shared/types";

type Lang = "ja" | "en";
type Mode = "read" | "listen";

export function NewsStoryPage() {
  const { id } = useParams();
  const [story, setStory] = useState<NewsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("ja");
  const [mode, setMode] = useState<Mode>("read");
  const [furigana, setFurigana] = useState<FuriganaMode>("level");
  const [english, setEnglish] = useState<Set<string>>(new Set());
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  const [preparing, setPreparing] = useState(false);
  const [pick, setPick] = useState<RollupPick | null>(null);

  useEffect(() => {
    api<StudySettings>("/api/settings")
      .then((settings) => setFurigana(settings.furigana))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setSaved(id ? isNewsOffline(Number(id)) : false);
    api<NewsDetail>(`/api/news/${id}`)
      .then(setStory)
      .catch((err: Error) => setError(err.message));
    api<{ picks: RollupPick[] }>("/api/news/rollup")
      .then((body) => setPick(body.picks.find((item) => item.storyId === Number(id)) || null))
      .catch(() => undefined);
  }, [id]);

  async function setRollup(checked: boolean, includeDeep: boolean) {
    const body = await postJson<{ picks: RollupPick[] }>("/api/news/rollup", {
      storyId: Number(id),
      checked,
      includeDeep: checked && includeDeep,
    });
    setPick(body.picks.find((item) => item.storyId === Number(id)) || null);
  }

  function choose(nextLang: Lang, nextMode: Mode) {
    setLang(nextLang);
    setMode(nextMode);
    setError(null);
    if (audio.current) {
      audio.current.pause();
    }
  }

  async function rebuild() {
    setError(null);
    try {
      setStory(await postJson<NewsDetail>(`/api/news/${id}/rebuild`, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebuild failed");
    }
  }

  async function addCards() {
    setAdding(true);
    setCardNote(null);
    try {
      const result = await postJson<{ added: number; skipped: number }>(`/api/news/${id}/cards`, {});
      setCardNote(
        result.added
          ? `Added ${result.added} word${result.added === 1 ? "" : "s"}.${result.skipped ? ` ${result.skipped} already in your cards.` : ""}`
          : "Those words are already in your flashcards.",
      );
      const fresh = await api<NewsDetail>(`/api/news/${id}`);
      setStory(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the words");
    } finally {
      setAdding(false);
    }
  }

  async function saveOffline() {
    if (!story) return;
    setSaving(true);
    setError(null);
    try {
      await saveNewsOffline({ id: story.id, title: story.title, hasEnglish: story.hasEnglish });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this story");
    } finally {
      setSaving(false);
    }
  }

  function applyRate(next: number) {
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  if (!story && !error) return <p className="page muted">Opening the story…</p>;
  if (!story) return <p className="page banner bad">{error}</p>;

  const lesson = story.lesson;
  const canListenEn = story.hasEnglish;
  const showEnglish = (key: string) => Boolean(lesson?.revealEnglish) || english.has(key);

  return (
    <div className="page lesson">
      <div className="page-head">
        <Link className="back" to="/news">
          News
        </Link>
        <div className="news-meta">
          <span>{story.category}</span>
          <span>{story.readingMinutes} min</span>
          {story.level ? <span className={`jlpt ${story.level.toLowerCase()}`}>{story.level}</span> : null}
        </div>
        <h1 lang="ja">{story.title}</h1>
        <div className="row-actions">
          <Link className="btn primary" to={`/news/${story.id}/deeper`}>
            Go deeper
          </Link>
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

      <div className="lang-toggle" role="group" aria-label="Language">
        <button className={`btn ${lang === "ja" ? "on" : ""}`} type="button" onClick={() => choose("ja", mode)}>
          JA
        </button>
        <button className={`btn ${lang === "en" ? "on" : ""}`} type="button" onClick={() => choose("en", mode)}>
          EN
        </button>
      </div>
      <div className="mode-grid">
        <button className={`btn ${mode === "read" && lang === "ja" ? "on" : ""}`} type="button" onClick={() => choose("ja", "read")}>
          Read JA
        </button>
        <button className={`btn ${mode === "read" && lang === "en" ? "on" : ""}`} type="button" onClick={() => choose("en", "read")}>
          Read EN
        </button>
        <button className={`btn ${mode === "listen" && lang === "ja" ? "on" : ""}`} type="button" onClick={() => choose("ja", "listen")}>
          Listen JA
        </button>
        <button
          className={`btn ${mode === "listen" && lang === "en" ? "on" : ""}`}
          type="button"
          disabled={!canListenEn}
          onClick={() => choose("en", "listen")}
        >
          Listen EN
        </button>
      </div>

      {error ? <p className="banner bad">{error}</p> : null}
      {story.levelStale && lesson ? (
        <p className="banner">
          This reading was built at {lesson.level}. Rebuild it so furigana, words, and grammar match your level. Cards you already reviewed stay as they are.
          <button className="text-btn" type="button" onClick={rebuild}>
            Rebuild this story
          </button>
        </p>
      ) : null}

      {mode === "read" && lang === "ja" && lesson ? (
        <>
          <section>
            <h2>Reading</h2>
            <p className="hint">Tap a word you do not know. Furigana stays on kanji above your level.</p>
            {(lesson.passages || []).map((passage) => (
              <article key={passage.index} className="passage">
                <p className="meta">{passage.charCount} characters</p>
                <ReadingText tokens={passage.tokens} furigana={furigana} />
                {showEnglish(`p-${passage.index}`) ? <p className="meaning">{passage.translation || passage.gloss}</p> : null}
                {!lesson.revealEnglish ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      setEnglish((current) => {
                        const next = new Set(current);
                        const key = `p-${passage.index}`;
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {english.has(`p-${passage.index}`) ? "Hide English" : "English"}
                  </button>
                ) : null}
              </article>
            ))}
          </section>
          <section>
            <div className="section-head">
              <h2>New words</h2>
              <button className="btn primary" type="button" onClick={addCards} disabled={adding || lesson.vocabulary.length === 0}>
                {adding ? "Adding…" : "Add words to flashcards"}
              </button>
            </div>
            {cardNote ? <p className="banner">{cardNote}</p> : null}
            {story.cardCount ? <p className="hint">{story.cardCount} from this story are already in Review.</p> : null}
            {lesson.vocabulary.length === 0 ? <p className="hint">Nothing new to add at this level.</p> : null}
            <div className="vocab">
              {lesson.vocabulary.map((item) => (
                <article key={item.lemma} className="word">
                  <div className="word-top">
                    <h3>
                      <FuriganaWord text={item.lemma} reading={item.reading} show={showHeadwordRuby(item, furigana, lesson.level)} />
                    </h3>
                    {item.jlpt ? <span className={`jlpt ${item.jlpt.toLowerCase()}`}>{item.jlpt}</span> : null}
                  </div>
                  <p className="glosses">{item.glosses.join("; ") || "No common-dictionary gloss yet."}</p>
                </article>
              ))}
            </div>
          </section>
          {lesson.grammar.length ? (
            <section>
              <h2>Grammar</h2>
              {lesson.grammar.map((item) => (
                <article key={item.id} className="grammar">
                  <h3 lang="ja">{item.name}</h3>
                  {item.explanation.split("\n\n").map((paragraph) => (
                    <p key={paragraph.slice(0, 24)}>{paragraph}</p>
                  ))}
                </article>
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {mode === "read" && lang === "en" ? (
        <section className="panel">
          <h2>{story.titleEn || "English"}</h2>
          {story.paragraphsEn.length ? (
            <>
              <p className="hint">{story.englishNote}</p>
              {story.paragraphsEn.map((paragraph) => (
                <p key={paragraph.slice(0, 48)} className="english-body">
                  {paragraph}
                </p>
              ))}
            </>
          ) : (
            <p>{story.englishNote}</p>
          )}
          {story.englishUrl ? (
            <a href={story.englishUrl} target="_blank" rel="noreferrer">
              Open the NHK World article
            </a>
          ) : null}
        </section>
      ) : null}

      {mode === "listen" ? (
        <section className="panel" id="listen">
          <h2>{lang === "ja" ? "Listen in Japanese" : "Listen in English"}</h2>
          <p className="hint">
            {lang === "en" && !canListenEn
              ? story.englishNote
              : "The first play creates the MP3. Playback continues on the lock screen. Speed stays on this phone."}
          </p>
          {lang === "en" && !canListenEn ? null : (
            <>
              <div className="speeds" role="group" aria-label="Playback speed">
                {[0.75, 1, 1.25].map((value) => (
                  <button key={value} className={`btn ${rate === value ? "on" : ""}`} type="button" onClick={() => applyRate(value)}>
                    {value === 1 ? "1x" : `${value}x`}
                  </button>
                ))}
              </div>
              {preparing ? <p className="banner">Preparing the reading…</p> : null}
              <audio
                ref={audio}
                controls
                preload="none"
                src={`/api/news/${story.id}/audio/${lang}`}
                onLoadStart={() => setPreparing(true)}
                onCanPlay={() => {
                  setPreparing(false);
                  if (audio.current) audio.current.playbackRate = rate;
                }}
                onError={() => {
                  setPreparing(false);
                  setError("The reading could not be played. Try again in a moment.");
                }}
                onPlay={() => {
                  if (!audio.current) return;
                  audio.current.playbackRate = rate;
                  attachMediaSession(audio.current, {
                    title: lang === "en" && story.titleEn ? story.titleEn : story.title,
                    artist: "Yomu News",
                    album: lang === "ja" ? "Japanese" : "English",
                  });
                }}
              />
              <button className="btn" type="button" onClick={saveOffline} disabled={saving || saved}>
                {saved ? "Saved on this phone" : saving ? "Saving…" : "Save for offline"}
              </button>
            </>
          )}
        </section>
      ) : null}

      {mode === "read" ? (
        <button className="btn" type="button" onClick={saveOffline} disabled={saving || saved}>
          {saved ? "Saved on this phone" : saving ? "Saving…" : "Save for offline"}
        </button>
      ) : null}
    </div>
  );
}

function showHeadwordRuby(item: VocabItem, mode: FuriganaMode, level: StudyLevel | undefined): boolean {
  if (mode === "off" || !level) return false;
  if (mode === "all") return true;
  const rank: Record<StudyLevel, number> = { N5: 5, N4: 4, N3: 3, N2: 2, N1: 1 };
  const tagged = item.jlpt && item.jlpt in rank ? rank[item.jlpt as StudyLevel] : null;
  if (tagged === null) return true;
  return tagged < rank[level];
}
