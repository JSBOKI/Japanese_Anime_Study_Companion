import { useState } from "react";
import type { FuriganaMode, LessonLine, LineToken } from "../../shared/types";

export function showRuby(token: LineToken, mode: FuriganaMode): boolean {
  if (mode === "off") return false;
  if (mode === "all") {
    return Boolean(token.reading) && token.reading !== token.surface && /[\u4e00-\u9fff]/.test(token.surface);
  }
  return token.furigana;
}

export function DialogueLine({
  line,
  furigana,
  onPlay,
  playing,
  showEnglish = true,
  onToggleEnglish,
}: {
  line: LessonLine;
  furigana: FuriganaMode;
  onPlay: () => void;
  playing: boolean;
  showEnglish?: boolean;
  onToggleEnglish?: () => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const token = active === null ? null : line.tokens[active];
  return (
    <article className="line">
      <div className="line-meta">
        <span>{line.start}</span>
        <button type="button" className="play" onClick={onPlay} disabled={playing}>
          {playing ? "…" : "Play"}
        </button>
      </div>
      <p className={`line-jp ${furigana !== "off" ? "with-ruby" : ""}`} lang="ja">
        {line.tokens.map((item, index) => (
          <TokenSpan
            key={`${item.surface}-${index}`}
            token={item}
            furigana={showRuby(item, furigana)}
            active={active === index}
            onClick={() => setActive(active === index ? null : index)}
          />
        ))}
      </p>
      {token ? (
        <div className="gloss-pop" role="dialog" aria-label="Word meaning">
          <strong lang="ja">{token.lemma}</strong>
          {(token.lemmaReading || token.reading) ? <span lang="ja">{token.lemmaReading || token.reading}</span> : null}
          <em>{token.pos}</em>
          <button type="button" className="gloss-close" onClick={() => setActive(null)}>
            Close
          </button>
          <p>{token.gloss || "No gloss for this piece."}</p>
        </div>
      ) : null}
      {showEnglish && line.translation ? <p className="meaning">{line.translation}</p> : null}
      {showEnglish && line.gloss ? <p className={line.translation ? "gloss-sub" : "meaning"}>{line.gloss}</p> : null}
      {onToggleEnglish ? (
        <button className="btn" type="button" onClick={onToggleEnglish}>
          {showEnglish ? "Hide English" : "English"}
        </button>
      ) : null}
    </article>
  );
}

export function ReadingText({ tokens, furigana }: { tokens: LineToken[]; furigana: FuriganaMode }) {
  const [active, setActive] = useState<number | null>(null);
  const token = active === null ? null : tokens[active];
  return (
    <div>
      <p className={`passage-body ${furigana !== "off" ? "with-ruby" : ""}`} lang="ja">
        {tokens.map((item, index) => (
          <TokenSpan
            key={`${item.surface}-${index}`}
            token={item}
            furigana={showRuby(item, furigana)}
            active={active === index}
            onClick={() => setActive(active === index ? null : index)}
          />
        ))}
      </p>
      {token ? (
        <div className="gloss-pop" role="dialog" aria-label="Word meaning">
          <strong lang="ja">{token.lemma}</strong>
          {token.lemmaReading || token.reading ? <span lang="ja">{token.lemmaReading || token.reading}</span> : null}
          <em>{token.pos}</em>
          <button type="button" className="gloss-close" onClick={() => setActive(null)}>
            Close
          </button>
          <p>{token.gloss || "No gloss for this piece."}</p>
        </div>
      ) : null}
    </div>
  );
}

function TokenSpan({
  token,
  furigana,
  active,
  onClick,
}: {
  token: LineToken;
  furigana: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const punct = /^[、。！？!?…「」『』（）()・\s]+$/.test(token.surface);
  return (
    <button type="button" className={`tok ${punct ? "punct" : ""} ${active ? "on" : ""}`} onClick={onClick} lang="ja">
      {furigana && token.reading ? (
        <ruby>
          {token.surface}
          <rt>{token.reading}</rt>
        </ruby>
      ) : (
        token.surface
      )}
    </button>
  );
}

export function FuriganaWord({ text, reading, show }: { text: string; reading?: string | null; show: boolean }) {
  if (!show || !reading || reading === text) return <span lang="ja">{text}</span>;
  return (
    <ruby lang="ja">
      {text}
      <rt>{reading}</rt>
    </ruby>
  );
}
