import iconv from "iconv-lite";

export type AozoraSpan = { base: string; reading: string | null };

export type AozoraParagraph = {
  text: string;
  speak: string;
  spans: AozoraSpan[];
};

export type AozoraChapter = {
  partTitle: string | null;
  title: string;
  paragraphs: AozoraParagraph[];
};

export type SpeechCue = {
  text: string;
  speak: string;
  spans: AozoraSpan[];
};

const KANJI = /[\u4e00-\u9fff々〆ヵヶ]/;
const PART_CHARS = 1700;
const SPEAK_LIMIT = 150;

export function decodeAozora(buffer: Buffer): string {
  return iconv.decode(buffer, "cp932");
}

export function chapterLabel(partTitle: string | null, title: string): string {
  if (partTitle && partTitle !== title) return `${partTitle} · ${title}`;
  return title;
}

function cleanTitle(title: string): string {
  return title.replace(/\u3000/g, " ").replace(/[ \t]+/g, " ").trim();
}

function isKanji(char: string): boolean {
  return KANJI.test(char);
}

function attachReading(spans: AozoraSpan[], reading: string): boolean {
  const last = spans[spans.length - 1];
  if (!last || last.reading !== null) return false;
  const chars = [...last.base];
  let index = chars.length;
  while (index > 0 && isKanji(chars[index - 1])) index -= 1;
  const kanji = chars.slice(index).join("");
  if (!kanji) return false;
  const head = chars.slice(0, index).join("");
  spans.pop();
  if (head) spans.push({ base: head, reading: null });
  spans.push({ base: kanji, reading });
  return true;
}

/** Turn Aozora ruby into display text and the reading a voice should say. */
export function parseRuby(input: string): AozoraParagraph {
  const spans: AozoraSpan[] = [];
  let index = 0;
  while (index < input.length) {
    if (input.startsWith("｜", index)) {
      const open = input.indexOf("《", index + 1);
      const close = open >= 0 ? input.indexOf("》", open + 1) : -1;
      if (open > index && close > open) {
        const base = input.slice(index + 1, open);
        const reading = input.slice(open + 1, close);
        if (base) spans.push({ base, reading });
        index = close + 1;
        continue;
      }
    }
    if (input.startsWith("《", index)) {
      const close = input.indexOf("》", index + 1);
      if (close > index) {
        const reading = input.slice(index + 1, close);
        if (attachReading(spans, reading)) {
          index = close + 1;
          continue;
        }
      }
    }
    const char = input[index];
    const last = spans[spans.length - 1];
    if (last && last.reading === null) last.base += char;
    else spans.push({ base: char, reading: null });
    index += 1;
  }
  const text = spans.map((span) => span.base).join("");
  const speak = spans.map((span) => span.reading ?? span.base).join("");
  return { text, speak, spans };
}

function takeHeadings(line: string): { headings: { rank: "大" | "中" | "小"; title: string }[]; rest: string } {
  const headings: { rank: "大" | "中" | "小"; title: string }[] = [];
  let rest = line;
  rest = rest.replace(/［＃(大|中|小)見出し］([\s\S]*?)［＃\1見出し終わり］/g, (_all, rank: "大" | "中" | "小", title: string) => {
    const plain = cleanTitle(title.replace(/｜/g, "").replace(/《[^》]*》/g, ""));
    if (plain) headings.push({ rank, title: plain });
    return "";
  });
  rest = rest.replace(/［＃「([^」]*)」は(大|中|小)見出し］/g, (_all, title: string, rank: "大" | "中" | "小") => {
    const plain = cleanTitle(title);
    if (plain) headings.push({ rank, title: plain });
    return "";
  });
  rest = rest.replace(/［＃[^］]*］/g, "");
  rest = rest.replace(/※/g, "");
  const trimmed = rest.replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, "");
  const same = headings.some((heading) => cleanTitle(trimmed) === heading.title);
  return { headings, rest: same ? "" : trimmed };
}

function stripFrame(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let start = -1;
  let end = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^-{8,}$/.test(lines[index].trim())) {
      if (start < 0) start = index;
      else {
        end = index;
        break;
      }
    }
  }
  let body = start >= 0 && end > start ? lines.slice(0, start).concat(lines.slice(end + 1)) : lines;
  const cut = body.findIndex((line) => /^(底本：|底本:|入力：|校正：|青空文庫作成ファイル：)/.test(line.trim()));
  if (cut >= 0) body = body.slice(0, cut);
  return body.join("\n");
}

function looksLikeBody(line: string): boolean {
  return line.includes("《") || [...line].length >= 40;
}

function toParagraph(line: string): AozoraParagraph | null {
  const parsed = parseRuby(line);
  const text = parsed.text.trim();
  if (!text) return null;
  return parsed;
}

function splitUnread(lines: string[]): AozoraChapter[] {
  const paragraphs = lines.map(toParagraph).filter((item): item is AozoraParagraph => Boolean(item));
  const out: AozoraChapter[] = [];
  let bucket: AozoraParagraph[] = [];
  let count = 0;
  let number = 1;
  const push = () => {
    if (!bucket.length) return;
    out.push({ partTitle: null, title: `その${number}`, paragraphs: bucket });
    number += 1;
    bucket = [];
    count = 0;
  };
  for (const paragraph of paragraphs) {
    if (bucket.length && count >= PART_CHARS) push();
    bucket.push(paragraph);
    count += [...paragraph.text].length;
  }
  push();
  if (out.length >= 2) {
    const last = out[out.length - 1];
    const lastChars = last.paragraphs.reduce((sum, paragraph) => sum + [...paragraph.text].length, 0);
    if (lastChars < 400) {
      out[out.length - 2].paragraphs.push(...last.paragraphs);
      out.pop();
    }
  }
  return out;
}

export function parseAozoraText(raw: string): AozoraChapter[] {
  const lines = stripFrame(raw).split("\n");
  let part: string | null = null;
  let chapter: AozoraChapter | null = null;
  const chapters: AozoraChapter[] = [];
  const preamble: string[] = [];
  let sawHeading = false;

  const flush = () => {
    if (chapter && chapter.paragraphs.length) chapters.push(chapter);
    chapter = null;
  };

  for (const line of lines) {
    const { headings, rest } = takeHeadings(line);
    for (const heading of headings) {
      sawHeading = true;
      if (heading.rank === "大") {
        flush();
        part = heading.title;
        chapter = { partTitle: part, title: heading.title, paragraphs: [] };
      } else if (chapter && chapter.paragraphs.length === 0 && chapter.title === part) {
        chapter.title = heading.title;
      } else {
        flush();
        chapter = { partTitle: part, title: heading.title, paragraphs: [] };
      }
    }
    if (!rest || /^※/.test(line.trim())) continue;
    if (!sawHeading) {
      preamble.push(rest);
      continue;
    }
    if (!chapter) chapter = { partTitle: part, title: part || "本文", paragraphs: [] };
    const paragraph = toParagraph(rest);
    if (paragraph) chapter.paragraphs.push(paragraph);
  }
  flush();

  if (!sawHeading) {
    const start = preamble.findIndex(looksLikeBody);
    return splitUnread(start >= 0 ? preamble.slice(start) : preamble);
  }

  const prologue = preamble.filter(looksLikeBody).map(toParagraph).filter((item): item is AozoraParagraph => Boolean(item));
  if (prologue.length) chapters.unshift({ partTitle: null, title: "本文", paragraphs: prologue });
  return chapters;
}

function charCount(value: string): number {
  return [...value].length;
}

function blankCue(): SpeechCue {
  return { text: "", speak: "", spans: [] };
}

function pushPiece(cue: SpeechCue, base: string, reading: string | null): void {
  const last = cue.spans[cue.spans.length - 1];
  if (reading === null && last && last.reading === null) last.base += base;
  else cue.spans.push({ base, reading });
  cue.text += base;
  cue.speak += reading ?? base;
}

/** Sentence-sized cues. The spoken form uses furigana, so names are not guessed. */
export function speechCues(paragraphs: AozoraParagraph[]): SpeechCue[] {
  const cues: SpeechCue[] = [];
  let cue = blankCue();
  const flush = () => {
    const text = cue.text.trim();
    const speak = cue.speak.trim();
    if (text && speak) cues.push({ text, speak, spans: cue.spans });
    cue = blankCue();
  };
  for (const paragraph of paragraphs) {
    if (cue.text.trim()) flush();
    for (const span of paragraph.spans) {
      if (span.reading) {
        if (charCount(cue.speak) + charCount(span.reading) > SPEAK_LIMIT && cue.text.trim()) flush();
        pushPiece(cue, span.base, span.reading);
        continue;
      }
      for (const char of span.base) {
        if (charCount(cue.speak) >= SPEAK_LIMIT && cue.text.trim()) flush();
        pushPiece(cue, char, null);
        if (/[。！？]/.test(char) || (/[、]/.test(char) && charCount(cue.speak) >= 80)) flush();
      }
    }
  }
  flush();
  return cues;
}

function headingText(inner: string): string {
  const without = inner.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "").replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, "");
  return cleanTitle(without.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " "));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function rubyInner(inner: string): string {
  const bases = [...inner.matchAll(/<rb\b[^>]*>([\s\S]*?)<\/rb>/gi)].map((match) =>
    decodeEntities(match[1].replace(/<[^>]+>/g, "")),
  );
  const readings = [...inner.matchAll(/<rt\b[^>]*>([\s\S]*?)<\/rt>/gi)].map((match) =>
    decodeEntities(match[1].replace(/<[^>]+>/g, "")),
  );
  if (bases.length) {
    let out = "";
    for (let index = 0; index < bases.length; index += 1) {
      const reading = readings[index];
      out += reading ? `｜${bases[index]}《${reading}》` : bases[index];
    }
    return out;
  }
  const reading = decodeEntities((inner.match(/<rt\b[^>]*>([\s\S]*?)<\/rt>/i)?.[1] || "").replace(/<[^>]+>/g, ""));
  const base = decodeEntities(
    inner.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "").replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, "").replace(/<[^>]+>/g, ""),
  );
  if (base && reading) return `｜${base}《${reading}》`;
  return base || reading;
}

/** Map an Aozora XHTML file onto the same text markup the ruby zip uses. */
export function xhtmlToAozora(html: string): string {
  let src = html;
  const bib = src.search(/<div[^>]*class="[^"]*bibliographical_information/);
  if (bib >= 0) src = src.slice(0, bib);
  const main = src.search(/<div[^>]*class="[^"]*main_text/);
  if (main >= 0) src = src.slice(main);
  src = src.replace(/<span[^>]*class="[^"]*notes[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "");
  src = src.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/alt="([^"]*)"/i)?.[1] || "";
    const chars = [...alt.trim()];
    return chars.length === 1 && chars[0] !== "※" ? chars[0] : "";
  });
  src = src.replace(/<h([1-6])\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, _level: string, cls: string, inner: string) => {
    const kind = cls.includes("ko-midashi") ? "小" : cls.includes("naka-midashi") ? "中" : cls.includes("o-midashi") ? "大" : "";
    const title = headingText(inner);
    if (!kind || !title) return title ? `\n${title}\n` : "\n";
    return `\n［＃「${title}」は${kind}見出し］\n`;
  });
  src = src.replace(/<ruby\b[^>]*>([\s\S]*?)<\/ruby>/gi, (_all, inner: string) => rubyInner(inner));
  src = src.replace(/<br\s*\/?>/gi, "\n");
  src = src.replace(/<\/p>/gi, "\n");
  src = src.replace(/<[^>]+>/g, "");
  return decodeEntities(src);
}
