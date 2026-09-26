import type { LessonLine, ProseReading, ReadingPassage, StudyLevel } from "../shared/types.ts";
import type { PassageLength } from "./level.ts";
import { passageBounds } from "./level.ts";

function seconds(stamp: string): number {
  const match = stamp.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function chars(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

function joinLines(lines: LessonLine[]): ReadingPassage {
  const text = lines.map((line) => line.text).join("");
  const tokens = lines.flatMap((line) => line.tokens);
  const glosses: string[] = [];
  for (const line of lines) {
    for (const part of line.gloss.split(" · ")) {
      if (part && !glosses.includes(part)) glosses.push(part);
    }
  }
  return {
    index: 0,
    start: lines[0]?.start || "",
    end: lines[lines.length - 1]?.end || "",
    text,
    charCount: chars(text),
    gloss: glosses.slice(0, 14).join(" · "),
    translation: null,
    lineIndexes: lines.map((line) => line.index),
    tokens,
  };
}

export function buildPassages(lines: LessonLine[], length: PassageLength): ReadingPassage[] {
  if (!lines.length) return [];
  const { minChars, maxChars, gapSeconds } = passageBounds(length);
  const scenes: LessonLine[][] = [];
  let current: LessonLine[] = [];
  for (const line of lines) {
    const previous = current[current.length - 1];
    const gap = previous ? seconds(line.start) - seconds(previous.end) : 0;
    if (current.length && gap > gapSeconds) {
      scenes.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) scenes.push(current);

  const packed: LessonLine[][] = [];
  let bucket: LessonLine[] = [];
  let bucketChars = 0;
  const flush = () => {
    if (bucket.length) packed.push(bucket);
    bucket = [];
    bucketChars = 0;
  };
  for (const scene of scenes) {
    const sceneChars = chars(scene.map((line) => line.text).join(""));
    if (bucket.length && bucketChars >= minChars && bucketChars + sceneChars > maxChars) flush();
    bucket.push(...scene);
    bucketChars += sceneChars;
    if (bucketChars >= maxChars) flush();
  }
  flush();

  const chunks: LessonLine[][] = [];
  for (const group of packed) {
    if (chars(group.map((line) => line.text).join("")) <= maxChars) {
      chunks.push(group);
      continue;
    }
    let piece: LessonLine[] = [];
    let count = 0;
    for (const line of group) {
      const next = chars(line.text);
      if (piece.length && count + next > maxChars && count >= minChars) {
        chunks.push(piece);
        piece = [];
        count = 0;
      }
      piece.push(line);
      count += next;
    }
    if (piece.length) chunks.push(piece);
  }

  return chunks.map((group, index) => ({ ...joinLines(group), index }));
}

function quoteLines(lines: LessonLine[], level: StudyLevel): string[] {
  const ranked = [...lines].sort((a, b) => {
    const score = (line: LessonLine) =>
      line.tokens.filter((token) => token.gloss && token.pos !== "particle" && token.pos !== "auxiliary").length +
      (line.text.length > 18 ? 2 : 0);
    return score(b) - score(a);
  });
  const picked: LessonLine[] = [];
  for (const line of ranked) {
    if (picked.length >= 5) break;
    if (line.text.length < 8) continue;
    if (picked.some((item) => item.index === line.index)) continue;
    picked.push(line);
  }
  picked.sort((a, b) => a.index - b.index);
  if (picked.length < 3) {
    const fallback = [lines[0], lines[Math.floor(lines.length / 2)], lines[lines.length - 1]].filter(Boolean) as LessonLine[];
    return fallback.map((line) => line.text);
  }
  void level;
  return picked.map((line) => line.text);
}

export function composeProse(lines: LessonLine[], level: StudyLevel): Omit<ProseReading, "tokens"> {
  const quotes = quoteLines(lines, level).slice(0, 5);
  const [a, b, c, d, e] = quotes;
  const frames: Record<StudyLevel, string> = {
    N5: [
      "この話を、短い文ではなく、まとめて読む。",
      a ? `最初は「${a}」。` : "",
      b ? `次は「${b}」。` : "",
      c ? `最後は「${c}」。` : "",
      "下の本文は、その会話をつなげたものだ。",
    ].join(""),
    N4: [
      "一行ずつ意味を見るだけでは、話の流れは見えない。",
      a ? `場面は「${a}」から動く。` : "",
      b ? `途中で「${b}」。` : "",
      c ? `終わりは「${c}」だ。` : "",
      "下に、同じ会話を切れ目なく置いてある。",
    ].join(""),
    N3: [
      "この場面は、台詞をバラバラに覚えるためのものではない。",
      a ? `きっかけは「${a}」にある。` : "",
      b ? `話が進むと「${b}」。` : "",
      c ? `そのあと「${c}」。` : "",
      d ? `結末に近いところでは「${d}」。` : "",
      "下の本文で、同じ流れを会話のまま追う。英語は、読んでから開く。",
    ].join(""),
    N2: [
      "ここでは、字幕の一行を単位にしない。場面全体の力点を読む。",
      a ? `冒頭の「${a}」が状況を置き、` : "",
      b ? `「${b}」で利害がぶつかり、` : "",
      c ? `「${c}」で条件が絞られる。` : "",
      d ? `終盤の「${d}」は、感情ではなく落としどころの話だ。` : "",
      e ? `締めは「${e}」。` : "",
      "下の本文は、そのやり取りを時間順に溶かし込んだ一続きである。訳を先に見ると、自分で読む練習にならない。",
    ].join(""),
    N1: [
      "断片を暗記する段階は、この読みでは前提にしない。追うのは場面の論理である。",
      a ? `発端は「${a}」にあり、` : "",
      b ? `展開は「${b}」で屈折する。` : "",
      c ? `「${c}」は譲歩の条件を示し、` : "",
      d ? `「${d}」に至って、話は着地の仕方そのものを問題にする。` : "",
      e ? `結着は「${e}」に委ねられる。` : "",
      "本文は台詞を時系列のままつなぎ、あらすじの代用にはしていない。語の意味は、文脈で取れなければ引く。文全体の英語は、読み終えてからで足りる。",
    ].join(""),
  };
  const text = frames[level].replace(/\s/g, "");
  const translations: Record<StudyLevel, string> = {
    N5: "Read this scene as one piece, not as tiny separate sentences. The quoted lines are the start, the middle, and the end. The passage below joins that conversation.",
    N4: "Checking one line at a time hides where the scene is going. The quotes mark the start, a turn in the middle, and the ending. The same conversation sits below without the breaks.",
    N3: "This scene is not a list of lines to memorize one by one. The quotes are the spark, the middle, and the close. Follow that order in the passage below, and open the English after you have read it.",
    N2: "Do not treat each subtitle as the unit. Read what the whole scene is pressing on. The quotes set the situation, the conflict, and the terms. The passage below is that exchange in order. A translation first would skip the practice of reading it yourself.",
    N1: "This reading does not assume you are memorizing fragments. Follow the logic of the scene. The quotes are the opening, the turn, the concession, and the landing. The passage keeps the lines in time order and is not a plot summary. Look a word up if the context will not yield it. The English of the whole paragraph can wait until you have finished.",
  };
  return {
    title: level === "N5" || level === "N4" ? "Scene in one piece" : "Reading the scene",
    text,
    translation: translations[level],
    source: "composed",
    note:
      level === "N5" || level === "N4"
        ? "A short guide into the scene, then the dialogue as one reading."
        : "Written without a model: a prose frame around lines from this episode. A natural recap appears here when an LLM key is set.",
  };
}
