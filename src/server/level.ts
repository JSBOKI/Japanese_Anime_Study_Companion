export const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
export type StudyLevel = (typeof LEVELS)[number];
export type PassageLength = "scene" | "long";
export type FuriganaMode = "level" | "all" | "off";

const RANK: Record<StudyLevel, number> = { N5: 5, N4: 4, N3: 3, N2: 2, N1: 1 };

export const DEFAULT_LEVEL: StudyLevel = "N2";
export const DEFAULT_PASSAGE: PassageLength = "scene";
export const DEFAULT_FURIGANA: FuriganaMode = "level";

export function isStudyLevel(value: string): value is StudyLevel {
  return (LEVELS as readonly string[]).includes(value);
}

export function isPassageLength(value: string): value is PassageLength {
  return value === "scene" || value === "long";
}

export function isFuriganaMode(value: string): value is FuriganaMode {
  return value === "level" || value === "all" || value === "off";
}

export function levelRank(level: StudyLevel): number {
  return RANK[level];
}

export function parseJlpt(value: string | null | undefined): StudyLevel | null {
  if (!value) return null;
  return isStudyLevel(value) ? value : null;
}

/** Easier than the level the learner asked to study. Unknown tags are not treated as easy. */
export function isEasierThan(jlpt: string | null | undefined, level: StudyLevel): boolean {
  const parsed = parseJlpt(jlpt);
  if (!parsed) return false;
  return RANK[parsed] > RANK[level];
}

/** Harder than the chosen level. Used for furigana: at-level kanji stay unmarked. */
export function isHarderThan(jlpt: string | null | undefined, level: StudyLevel): boolean {
  const parsed = parseJlpt(jlpt);
  if (!parsed) return true;
  return RANK[parsed] < RANK[level];
}

export function revealEnglishByDefault(level: StudyLevel): boolean {
  return level === "N5" || level === "N4";
}

export function vocabCap(level: StudyLevel): number {
  if (level === "N1" || level === "N2") return 22;
  if (level === "N3") return 18;
  return 14;
}

export function grammarCap(level: StudyLevel): number {
  return level === "N5" || level === "N4" ? 8 : 10;
}

export function passageBounds(length: PassageLength): { minChars: number; maxChars: number; gapSeconds: number } {
  if (length === "long") return { minChars: 900, maxChars: 2200, gapSeconds: 12 };
  return { minChars: 360, maxChars: 900, gapSeconds: 7 };
}

export function levelLabel(level: StudyLevel): string {
  const names: Record<StudyLevel, string> = {
    N5: "N5 · starting out",
    N4: "N4 · elementary",
    N3: "N3 · intermediate",
    N2: "N2 · advanced",
    N1: "N1 · near native prose",
  };
  return names[level];
}
