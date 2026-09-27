export const LISTEN_PAUSE_SECONDS = 0.4;
export const LISTEN_MAX_GAP_SECONDS = 1.5;
/** Bump when a finished MP3 would be wrong to keep serving. Older rows are rebuilt. */
export const LISTEN_AUDIO_REVISION = 2;
export const LISTEN_BYTES_PER_SECOND = 6_000;
export const LISTEN_MAX_SECONDS = 25 * 60;
export const LISTEN_MAX_BYTES = 8 * 1024 * 1024;
export const DISK_RESERVE_BYTES = 150 * 1024 * 1024;

export const JA_LISTEN_VOICES = [
  "ja-JP-NanamiNeural",
  "ja-JP-KeitaNeural",
  "ja-JP-AoiNeural",
  "ja-JP-DaichiNeural",
  "ja-JP-MayuNeural",
  "ja-JP-ShioriNeural",
];

const HALFWIDTH: Record<string, string> = {
  "｡": "。", "｢": "「", "｣": "」", "､": "、", "･": "・", "ｦ": "ヲ", "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ",
  "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ", "ｯ": "ッ", "ｰ": "ー", "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ",
  "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ", "ｻ": "サ", "ｼ": "シ", "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ",
  "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト", "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ",
  "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ", "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ",
  "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ", "ﾗ": "ラ", "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ", "ﾜ": "ワ", "ﾝ": "ン",
};

const DAKUTEN: Record<string, string> = {
  カ: "ガ", キ: "ギ", ク: "グ", ケ: "ゲ", コ: "ゴ", サ: "ザ", シ: "ジ", ス: "ズ", セ: "ゼ", ソ: "ゾ",
  タ: "ダ", チ: "ヂ", ツ: "ヅ", テ: "デ", ト: "ド", ハ: "バ", ヒ: "ビ", フ: "ブ", ヘ: "ベ", ホ: "ボ", ウ: "ヴ",
};

const HANDAKUTEN: Record<string, string> = { ハ: "パ", ヒ: "ピ", フ: "プ", ヘ: "ペ", ホ: "ポ" };

export function fullwidthKana(input: string): string {
  let out = "";
  for (const ch of input) {
    if (ch === "ﾞ" || ch === "ﾟ") {
      const prev = out.slice(-1);
      const next = ch === "ﾞ" ? DAKUTEN[prev] : HANDAKUTEN[prev];
      if (next) out = out.slice(0, -1) + next;
      continue;
    }
    out += HALFWIDTH[ch] || ch;
  }
  return out;
}

/** Text that a speech engine can actually say. Music, signs, and bare punctuation become null. */
export function spokenLine(text: string): string | null {
  let value = fullwidthKana(text)
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\\[Nn]/g, " ")
    .replace(/[♪♫♬♩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const onlyWrap = value.match(/^[（(]([^）)]+)[）)]$/);
  if (onlyWrap) value = onlyWrap[1].trim();
  else value = value.replace(/^[（(][^）)]{1,24}[）)]\s*/, "");
  value = value.replace(/\s+/g, " ").trim();
  if (!/[\u3040-\u30ff\u4e00-\u9fffA-Za-z0-9]/.test(value)) return null;
  return value;
}

export function engineNote(used: string[], skipped: number): string {
  const names: Record<string, string> = {
    edge: "Microsoft Edge",
    openai: "OpenAI",
    google: "Google Cloud",
    gtts: "Google Translate",
  };
  const unique = [...new Set(used)];
  let note = "Read with Microsoft Edge voices.";
  if (unique.length === 1 && unique[0] !== "edge") {
    note = `Read with ${names[unique[0]] || unique[0]}. Microsoft Edge could not read from this server.`;
  } else if (unique.length > 1) {
    const rest = unique.filter((name) => name !== "edge").map((name) => names[name] || name);
    note = unique.includes("edge")
      ? `Read with Microsoft Edge. Some lines used ${rest.join(" and ")}.`
      : `Read with ${unique.map((name) => names[name] || name).join(" and ")}.`;
  }
  if (skipped > 0) note += ` ${skipped} line${skipped === 1 ? "" : "s"} that ${skipped === 1 ? "was" : "were"} only music or punctuation stayed silent.`;
  return note;
}

export function assignVoices(
  lines: { speaker?: string | null; text: string }[],
  voices: string[] = JA_LISTEN_VOICES,
): string[] {
  const roster = voices.length ? voices : ["ja-JP-NanamiNeural"];
  const named = lines.some((line) => line.speaker);
  if (!named) {
    const out: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const previous = out[index - 1];
      const carry = index > 0 && /[、…]$/.test(lines[index - 1].text);
      if (index === 0) out.push(roster[0]);
      else if (carry && previous) out.push(previous);
      else out.push(previous === roster[0] ? roster[Math.min(1, roster.length - 1)] : roster[0]);
    }
    return out;
  }
  const map = new Map<string, string>();
  const out: string[] = [];
  let last = roster[0];
  for (const line of lines) {
    if (line.speaker) {
      const known = map.get(line.speaker);
      if (known) last = known;
      else {
        last = roster[map.size % roster.length];
        map.set(line.speaker, last);
      }
    }
    out.push(last);
  }
  return out;
}

export function estimateLineSeconds(text: string): number {
  const chars = [...text.replace(/\s/g, "")].length;
  return Math.max(0.7, chars * 0.16) + LISTEN_PAUSE_SECONDS;
}

export function estimateListen(lines: { text: string }[]): { seconds: number; bytes: number } {
  const seconds = lines.reduce((sum, line) => sum + estimateLineSeconds(line.text), 0);
  return { seconds, bytes: Math.round(seconds * LISTEN_BYTES_PER_SECOND) };
}

export type MeasuredLine = { index: number; seconds: number; bytes: number };

export type PlannedCue = {
  index: number;
  part: number;
  start: number;
  end: number;
  offset: number;
};

export type PlannedPart = {
  index: number;
  seconds: number;
  bytes: number;
  cues: PlannedCue[];
};

export function planListenParts(
  lines: MeasuredLine[],
  limits: { maxSeconds: number; maxBytes: number } = { maxSeconds: LISTEN_MAX_SECONDS, maxBytes: LISTEN_MAX_BYTES },
): PlannedPart[] {
  const parts: PlannedPart[] = [];
  let cues: PlannedCue[] = [];
  let seconds = 0;
  let bytes = 0;
  let global = 0;
  const flush = () => {
    if (!cues.length) return;
    parts.push({ index: parts.length + 1, seconds, bytes, cues });
    cues = [];
    seconds = 0;
    bytes = 0;
  };
  for (const line of lines) {
    const dur = Math.max(0.05, line.seconds);
    const size = Math.max(0, line.bytes);
    const over = seconds + dur > limits.maxSeconds + 0.05 || bytes + size > limits.maxBytes;
    if (cues.length && over) flush();
    cues.push({ index: line.index, part: 0, start: global, end: global + dur, offset: seconds });
    seconds += dur;
    bytes += size;
    global += dur;
  }
  flush();
  for (const part of parts) {
    for (const cue of part.cues) cue.part = part.index;
  }
  return parts;
}

export function lineAtTime(cues: { index: number; start: number; end: number }[], time: number): number | null {
  if (!cues.length) return null;
  if (time < cues[0].start) return cues[0].index;
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) return cue.index;
  }
  return cues[cues.length - 1].index;
}

export function timeForLine<T extends { index: number }>(cues: T[], index: number): T | null {
  return cues.find((cue) => cue.index === index) || null;
}

export function bytesToFree(freeBytes: number, neededBytes: number, reserve = DISK_RESERVE_BYTES): number {
  return Math.max(0, neededBytes + reserve - Math.max(0, freeBytes));
}

export function pickNamedEvictions(
  rows: { id: string; bytes: number; playedAt: string }[],
  needToFree: number,
  keepId?: string,
): string[] {
  if (needToFree <= 0) return [];
  const sorted = [...rows]
    .filter((row) => row.id !== keepId)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id));
  const ids: string[] = [];
  let freed = 0;
  for (const row of sorted) {
    if (freed >= needToFree) break;
    ids.push(row.id);
    freed += Math.max(0, row.bytes);
  }
  return ids;
}

export function pickEvictions(
  rows: { episodeId: number; bytes: number; playedAt: string }[],
  needToFree: number,
  keepEpisodeId?: number,
): number[] {
  if (needToFree <= 0) return [];
  const sorted = [...rows]
    .filter((row) => row.episodeId !== keepEpisodeId)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.episodeId - b.episodeId);
  const ids: number[] = [];
  let freed = 0;
  for (const row of sorted) {
    if (freed >= needToFree) break;
    ids.push(row.episodeId);
    freed += Math.max(0, row.bytes);
  }
  return ids;
}

export function listenNeedsRebuild(revision: number | null | undefined): boolean {
  return (revision || 0) < LISTEN_AUDIO_REVISION;
}

/** Drop leading silence and shorten any quiet stretch to about 1.5 seconds. */
export function silenceTightenFilter(): string {
  const cap = [
    "silenceremove=start_periods=1",
    "start_threshold=-50dB",
    "start_silence=0.05",
    "stop_periods=-1",
    "stop_threshold=-50dB",
    `stop_duration=${LISTEN_MAX_GAP_SECONDS}`,
    "stop_silence=0",
    "detection=peak",
  ].join(":");
  const tail = [
    "silenceremove=start_periods=1",
    "start_threshold=-50dB",
    "start_silence=0.08",
    "detection=peak",
  ].join(":");
  return `${cap},areverse,${tail},areverse`;
}

export function shouldEnlarge(freeBytes: number, neededBytes: number, reserve = DISK_RESERVE_BYTES): boolean {
  return neededBytes > Math.max(0, freeBytes - reserve);
}
