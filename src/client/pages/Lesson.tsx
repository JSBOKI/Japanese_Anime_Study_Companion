import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "../api";
import { DialogueLine, FuriganaWord, ReadingText } from "../components/Japanese";
import { attachMediaSession } from "../media";
import { isOfflineSaved, saveEpisodeOffline } from "../offline";
import type { EpisodeDetail, FuriganaMode, StudyLevel, StudySettings, VocabItem } from "../../shared/types";

export function LessonPage() {
  const { id } = useParams();
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [furigana, setFurigana] = useState<FuriganaMode>("level");
  const [allLines, setAllLines] = useState(false);
  const [english, setEnglish] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<number | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const lineAudio = useRef<HTMLAudioElement>(null);

  async function load() {
    const data = await api<EpisodeDetail>(`/api/episodes/${id}`);
    setEpisode(data);
    return data;
  }

  useEffect(() => {
    api<StudySettings>("/api/settings")
      .then((settings) => setFurigana(settings.furigana))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let timer = 0;
    let stop = false;
    const tick = async () => {
      try {
        const data = await load();
        if (!stop && data.audioStatus === "pending") timer = window.setTimeout(tick, 1500);
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Could not load the lesson");
      }
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  async function cycleFurigana() {
    const order: FuriganaMode[] = ["level", "all", "off"];
    const next = order[(order.indexOf(furigana) + 1) % order.length];
    setFurigana(next);
    await postJson<StudySettings>("/api/settings", { furigana: next }).catch(() => undefined);
  }

  function toggleEnglish(key: string) {
    setEnglish((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function playLine(index: number) {
    const audio = lineAudio.current;
    if (!audio || !episode) return;
    setPlaying(index);
    audio.src = `/api/episodes/${id}/lines/${index}/audio`;
    attachMediaSession(audio, {
      title: episode.lesson?.lines.find((line) => line.index === index)?.text || `Line ${index + 1}`,
      artist: episode.seriesTitle,
      album: `Episode ${episode.number}`,
    });
    audio.onended = () => setPlaying(null);
    try {
      await audio.play();
    } catch (err) {
      setPlaying(null);
      setError(err instanceof Error ? err.message : "Playback failed");
    }
  }

  async function markKnown(item: VocabItem) {
    await postJson("/api/known", { lemma: item.lemma, reading: item.reading });
    setKnown((current) => new Set(current).add(item.lemma));
  }

  async function rebuild() {
    setError(null);
    try {
      setEpisode(await postJson<EpisodeDetail>(`/api/episodes/${id}/rebuild`, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rebuild failed");
    }
  }

  if (!episode && !error) return <p className="page muted">Building the lesson…</p>;
  if (!episode) return <p className="page banner bad">{error}</p>;
  const lesson = episode.lesson;
  if (!lesson) {
    return (
      <div className="page">
        <p>This episode has no subtitle yet.</p>
        <Link to={`/series/${episode.seriesId}`}>Back to the series</Link>
      </div>
    );
  }
  const lines = allLines ? lesson.lines : lesson.lines.filter((line) => line.featured);
  const passages = lesson.passages || [];
  const showEnglish = (key: string) => lesson.revealEnglish || english.has(key);
  const furiganaLabel = furigana === "all" ? "Furigana all" : furigana === "off" ? "Furigana off" : "Furigana by level";

  return (
    <div className="page lesson">
      <div className="page-head">
        <Link className="back" to={`/series/${episode.seriesId}`}>
          {episode.seriesTitle}
        </Link>
        <h1>
          Episode {episode.number}
          {episode.title && episode.title !== `Episode ${episode.number}` ? <span className="sub"> {episode.title}</span> : null}
        </h1>
        <div className="row-actions">
          <Link className="btn primary" to="/level">
            {lesson.level || "Level"}
          </Link>
          <button className={`btn ${furigana !== "off" ? "primary" : ""}`} type="button" onClick={() => void cycleFurigana()}>
            {furiganaLabel}
          </button>
          <Link className="btn" to={`/review?series=${episode.seriesId}`}>
            Review cards
          </Link>
          <Link className="btn" to={`/episodes/${episode.id}/listen`}>
            Listen along
          </Link>
          {episode.netflixUrl ? (
            <a className="btn" href={episode.netflixUrl} target="_blank" rel="noopener noreferrer">
              Watch on Netflix
            </a>
          ) : null}
        </div>
        {episode.netflixUrl && !episode.netflixWatchUrl ? (
          <p className="hint">Episode {episode.number}. Opens the series on Netflix. Yomu does not play video.</p>
        ) : null}
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {episode.levelStale ? (
        <p className="banner">
          This lesson was built{lesson.level ? ` at ${lesson.level}` : " before levels"}. Rebuild it so the reading, cards, and audio match your level. Reviewed cards keep their schedule.
          <button className="text-btn" type="button" onClick={rebuild}>
            Rebuild this lesson
          </button>
        </p>
      ) : null}
      {episode.stale ? (
        <p className="banner">
          An earlier episode was rebuilt after this one.{" "}
          <button className="text-btn" type="button" onClick={rebuild}>
            Rebuild this lesson
          </button>{" "}
          so “new” words stay accurate.
        </p>
      ) : null}
      <p className="summary">{lesson.summary}</p>

      {lesson.prose ? (
        <section id="recap" className="panel reading-block">
          <div className="section-head">
            <h2>{lesson.prose.title}</h2>
            <span className="meta">{lesson.prose.source === "llm" ? "Scene recap" : "Reading guide"}</span>
          </div>
          <p className="hint">{lesson.prose.note}</p>
          <ReadingText tokens={lesson.prose.tokens} furigana={furigana} />
          {showEnglish("prose") && lesson.prose.translation ? <p className="meaning">{lesson.prose.translation}</p> : null}
          {!lesson.revealEnglish ? (
            <button className="btn" type="button" onClick={() => toggleEnglish("prose")}>
              {english.has("prose") ? "Hide English" : "English"}
            </button>
          ) : null}
        </section>
      ) : null}

      <section id="reading">
        <div className="section-head">
          <h2>Reading</h2>
          <span className="meta">{lesson.passage === "long" ? "Longer scenes" : "Scenes"}</span>
        </div>
        <p className="hint">A stretch of the episode, not one subtitle at a time. Tap a word you do not know. Furigana stays on kanji above your level.</p>
        {passages.map((passage) => (
          <article key={passage.index} className="passage">
            <p className="meta">
              {passage.start} · {passage.charCount} characters
            </p>
            <ReadingText tokens={passage.tokens} furigana={furigana} />
            {showEnglish(`p-${passage.index}`) ? <p className="meaning">{passage.translation || passage.gloss}</p> : null}
            {!lesson.revealEnglish ? (
              <button className="btn" type="button" onClick={() => toggleEnglish(`p-${passage.index}`)}>
                {english.has(`p-${passage.index}`) ? "Hide English" : "English"}
              </button>
            ) : null}
          </article>
        ))}
      </section>

      <section id="vocab">
        <h2>New words</h2>
        {lesson.vocabulary.length === 0 ? <p className="hint">Nothing new to add from this episode.</p> : null}
        <div className="vocab">
          {lesson.vocabulary.map((item) => (
            <article key={item.lemma} className="word">
              <div className="word-top">
                <h3>
                  <FuriganaWord text={item.lemma} reading={item.reading} show={showHeadwordRuby(item, furigana, lesson.level)} />
                </h3>
                <span className="count">×{item.count}</span>
                {item.jlpt ? <span className={`jlpt ${item.jlpt.toLowerCase()}`}>{item.jlpt}</span> : null}
              </div>
              <p className="reading" lang="ja">{item.reading}</p>
              <p className="pos">{item.pos}</p>
              <p className="glosses">{item.glosses.join("; ") || "Not in the common-word dictionary. The reading is still worth learning."}</p>
              {item.kanji.length ? (
                <div className="kanji">
                  {item.kanji.map((kanji) => (
                    <span key={kanji.char}>
                      <b lang="ja">{kanji.char}</b>
                      {kanji.meanings.slice(0, 2).join(", ")}
                      <i lang="ja">{[...kanji.on, ...kanji.kun].slice(0, 2).join(" · ")}</i>
                    </span>
                  ))}
                </div>
              ) : null}
              {item.example ? <p className="example" lang="ja">{item.example}</p> : null}
              {item.exampleEn ? <p className="example-en">{item.exampleEn}</p> : null}
              <button className="btn" type="button" disabled={known.has(item.lemma)} onClick={() => markKnown(item)}>
                {known.has(item.lemma) ? "Marked known" : "I know this"}
              </button>
            </article>
          ))}
        </div>
        {lesson.reviewVocabulary.length ? (
          <div className="review-strip">
            <h3>Already taught</h3>
            <ul>
              {lesson.reviewVocabulary.map((item) => (
                <li key={item.lemma}>
                  <span lang="ja">{item.lemma}</span>
                  <small lang="ja">{item.reading}</small>
                  {item.gloss}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section id="grammar">
        <h2>Grammar in this episode</h2>
        {lesson.grammar.map((item) => (
          <article key={item.id} className="grammar">
            <h3 lang="ja">{item.name}</h3>
            <p className="count">{item.count} line{item.count === 1 ? "" : "s"}</p>
            {item.explanation.split("\n\n").map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
            <ul className="examples">
              {item.examples.map((example) => (
                <li key={example} lang="ja">{example}</li>
              ))}
            </ul>
          </article>
        ))}
        {lesson.grammarReview.length ? (
          <div className="review-strip">
            <h3>Patterns you already met</h3>
            <ul>
              {lesson.grammarReview.map((item) => (
                <li key={item.id}>
                  <span lang="ja">{item.name}</span>
                  {item.reminder}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {lesson.alsoNoticed.length ? (
          <div className="review-strip">
            <h3>Also in the dialogue</h3>
            <ul>
              {lesson.alsoNoticed.map((item) => (
                <li key={item.id}>
                  <span lang="ja">{item.name}</span>
                  {item.reminder}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section id="lines">
        <div className="section-head">
          <h2>Dialogue</h2>
          {lesson.lines.some((line) => !line.featured) ? (
            <button className="btn" type="button" onClick={() => setAllLines((value) => !value)}>
              {allLines ? "Key lines" : `All ${lesson.lines.length} lines`}
            </button>
          ) : null}
        </div>
        <p className="hint">The same scene, line by line, if you want a timestamp or a single line played aloud. Tap a word for its reading and meaning.</p>
        {lines.map((line) => (
          <DialogueLine
            key={line.index}
            line={line}
            furigana={furigana}
            playing={playing === line.index}
            onPlay={() => playLine(line.index)}
            showEnglish={showEnglish(`line-${line.index}`)}
            onToggleEnglish={lesson.revealEnglish ? undefined : () => toggleEnglish(`line-${line.index}`)}
          />
        ))}
      </section>

      <section id="audio" className="panel">
        <h2>Audio</h2>
        <p className="hint">
          {lesson.revealEnglish
            ? "The dialogue drill speaks a sentence from the passage, leaves a pause for you to repeat it, says the English, then says the Japanese again."
            : "The dialogue drill speaks a sentence from the passage, leaves a pause for you to repeat it, then says the Japanese again. English stays off the track at this level."}{" "}
          The vocabulary track drills the words this level kept.
        </p>
        <AudioBlock episode={episode} onRetry={() => postJson(`/api/episodes/${id}/audio`, {}).then(() => load())} />
      </section>
      <audio ref={lineAudio} className="line-audio" preload="none" />
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

function AudioBlock({ episode, onRetry }: { episode: EpisodeDetail; onRetry: () => void }) {
  const [saved, setSaved] = useState(() => isOfflineSaved(episode.id));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function saveOffline() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveEpisodeOffline({
        id: episode.id,
        number: episode.number,
        title: episode.title,
        seriesTitle: episode.seriesTitle,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save this episode");
    } finally {
      setSaving(false);
    }
  }
  if (episode.audioStatus === "pending") {
    return <p className="banner">{episode.audioProgress || "Making the audio…"}</p>;
  }
  if (episode.audioStatus === "error") {
    return (
      <div>
        <p className="banner bad">{episode.audioError || "Audio failed"}</p>
        <button className="btn" type="button" onClick={onRetry}>
          Try audio again
        </button>
      </div>
    );
  }
  if (episode.audioStatus !== "ready") {
    return (
      <button className="btn primary" type="button" onClick={onRetry}>
        Generate audio
      </button>
    );
  }
  return (
    <div className="players">
      <p className="hint">Play stays on the lock screen. Saving a copy keeps the lesson and both drills for the subway.</p>
      {saveError ? <p className="banner bad">{saveError}</p> : null}
      <button className="btn" type="button" onClick={saveOffline} disabled={saving || saved}>
        {saved ? "Saved on this phone" : saving ? "Saving…" : "Save for offline"}
      </button>
      <Drill
        title="Dialogue drill"
        src={`/api/episodes/${episode.id}/audio/dialogue`}
        artist={episode.seriesTitle}
        album={`Episode ${episode.number}`}
        download={`episode-${episode.number}-dialogue.mp3`}
      />
      <Drill
        title="Vocabulary drill"
        src={`/api/episodes/${episode.id}/audio/vocab`}
        artist={episode.seriesTitle}
        album={`Episode ${episode.number} vocabulary`}
        download={`episode-${episode.number}-vocab.mp3`}
      />
    </div>
  );
}

function Drill({
  title,
  src,
  artist,
  album,
  download,
}: {
  title: string;
  src: string;
  artist: string;
  album: string;
  download: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  return (
    <div>
      <h3>{title}</h3>
      <audio
        ref={ref}
        controls
        preload="metadata"
        src={src}
        onPlay={() => {
          if (ref.current) attachMediaSession(ref.current, { title, artist, album });
        }}
      />
      <a className="btn" href={src} download={download}>
        Download MP3
      </a>
    </div>
  );
}
