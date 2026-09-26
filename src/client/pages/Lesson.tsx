import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, postJson } from "../api";
import { DialogueLine, FuriganaWord } from "../components/Japanese";
import type { EpisodeDetail, VocabItem } from "../../shared/types";

export function LessonPage() {
  const { id } = useParams();
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [furigana, setFurigana] = useState(() => localStorage.getItem("yomu-furigana") !== "off");
  const [allLines, setAllLines] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());

  async function load() {
    const data = await api<EpisodeDetail>(`/api/episodes/${id}`);
    setEpisode(data);
    return data;
  }

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

  function toggleFurigana() {
    const next = !furigana;
    setFurigana(next);
    localStorage.setItem("yomu-furigana", next ? "on" : "off");
  }

  async function playLine(index: number) {
    setPlaying(index);
    try {
      const res = await fetch(`/api/episodes/${id}/lines/${index}/audio`);
      if (!res.ok) throw new Error("Could not play that line");
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Playback failed");
    } finally {
      setPlaying(null);
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
          <button className={`btn ${furigana ? "primary" : ""}`} type="button" onClick={toggleFurigana}>
            Furigana {furigana ? "on" : "off"}
          </button>
          <Link className="btn" to={`/review?series=${episode.seriesId}`}>
            Review cards
          </Link>
        </div>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
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

      <section id="vocab">
        <h2>New words</h2>
        {lesson.vocabulary.length === 0 ? <p className="hint">Nothing new to add from this episode.</p> : null}
        <div className="vocab">
          {lesson.vocabulary.map((item) => (
            <article key={item.lemma} className="word">
              <div className="word-top">
                <h3>
                  <FuriganaWord text={item.lemma} reading={item.reading} show={furigana} />
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
        <p className="hint">Tap a word for its reading and meaning. Furigana stays on until kana feels steady.</p>
        {lines.map((line) => (
          <DialogueLine key={line.index} line={line} furigana={furigana} playing={playing === line.index} onPlay={() => playLine(line.index)} />
        ))}
      </section>

      <section id="audio" className="panel">
        <h2>Audio</h2>
        <p className="hint">
          The dialogue drill speaks each key line, leaves a pause for you to repeat it, says the English, then says the Japanese again.
          The vocabulary track drills the new words.
        </p>
        <AudioBlock episode={episode} onRetry={() => postJson(`/api/episodes/${id}/audio`, {}).then(() => load())} />
      </section>
    </div>
  );
}

function AudioBlock({ episode, onRetry }: { episode: EpisodeDetail; onRetry: () => void }) {
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
      <div>
        <h3>Dialogue drill</h3>
        <audio controls preload="none" src={`/api/episodes/${episode.id}/audio/dialogue`} />
        <a className="btn" href={`/api/episodes/${episode.id}/audio/dialogue`} download={`episode-${episode.number}-dialogue.mp3`}>
          Download MP3
        </a>
      </div>
      <div>
        <h3>Vocabulary drill</h3>
        <audio controls preload="none" src={`/api/episodes/${episode.id}/audio/vocab`} />
        <a className="btn" href={`/api/episodes/${episode.id}/audio/vocab`} download={`episode-${episode.number}-vocab.mp3`}>
          Download MP3
        </a>
      </div>
    </div>
  );
}
