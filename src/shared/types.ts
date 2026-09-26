export type MediaType = "anime" | "drama";

export type AudioStatus = "idle" | "pending" | "ready" | "error";

export type AppConfig = {
  llm: string;
  tts: string;
  jimaku: boolean;
  voices: { ja: string; en: string };
};

export type SeriesSummary = {
  id: number;
  title: string;
  titleNative: string | null;
  titleRomaji: string | null;
  coverUrl: string | null;
  synopsis: string | null;
  episodeCount: number | null;
  mediaType: MediaType;
  anilistId: number | null;
  year: number | null;
  format: string | null;
  sample: boolean;
  createdAt: string;
  lessonsReady: number;
  cardCount: number;
  dueCount: number;
};

export type EpisodeSummary = {
  id: number;
  seriesId: number;
  number: number;
  title: string | null;
  subtitleName: string | null;
  hasLesson: boolean;
  cueCount: number;
  newWords: number;
  audioStatus: AudioStatus;
  audioProgress: string | null;
  audioError: string | null;
  stale: boolean;
};

export type KanjiInfo = {
  char: string;
  meanings: string[];
  on: string[];
  kun: string[];
  grade: number | null;
};

export type VocabItem = {
  lemma: string;
  reading: string;
  surface: string;
  glosses: string[];
  pos: string;
  jlpt: string | null;
  count: number;
  example: string;
  exampleEn: string;
  kanji: KanjiInfo[];
};

export type ReviewVocab = {
  lemma: string;
  reading: string;
  gloss: string;
  count: number;
};

export type GrammarItem = {
  id: string;
  name: string;
  explanation: string;
  examples: string[];
  count: number;
};

export type GrammarNote = {
  id: string;
  name: string;
  reminder: string;
  count: number;
};

export type LineToken = {
  surface: string;
  lemma: string;
  reading: string;
  lemmaReading: string;
  pos: string;
  gloss: string | null;
  furigana: boolean;
};

export type LessonLine = {
  index: number;
  start: string;
  end: string;
  text: string;
  translation: string | null;
  gloss: string;
  featured: boolean;
  tokens: LineToken[];
};

export type StudyLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type PassageLength = "scene" | "long";
export type FuriganaMode = "level" | "all" | "off";

export type ReadingPassage = {
  index: number;
  start: string;
  end: string;
  text: string;
  charCount: number;
  gloss: string;
  translation: string | null;
  lineIndexes: number[];
  tokens: LineToken[];
};

export type ProseReading = {
  title: string;
  text: string;
  translation: string | null;
  source: "llm" | "composed";
  note: string;
  tokens: LineToken[];
};

export type StudySettings = {
  level: StudyLevel;
  passage: PassageLength;
  furigana: FuriganaMode;
};

export type Lesson = {
  generatedAt: string;
  llm: string;
  level: StudyLevel;
  passage: PassageLength;
  revealEnglish: boolean;
  summary: string;
  vocabulary: VocabItem[];
  reviewVocabulary: ReviewVocab[];
  grammar: GrammarItem[];
  grammarReview: GrammarNote[];
  alsoNoticed: GrammarNote[];
  lines: LessonLine[];
  passages: ReadingPassage[];
  prose: ProseReading | null;
  carriedOver: number;
  skippedKnown: number;
  skippedEasy: number;
};

export type EpisodeDetail = EpisodeSummary & {
  seriesTitle: string;
  seriesNative: string | null;
  lesson: Lesson | null;
  levelStale?: boolean;
};

export type AniListHit = {
  id: number;
  title: string;
  native: string | null;
  romaji: string | null;
  episodes: number | null;
  coverUrl: string | null;
  synopsis: string | null;
  format: string | null;
  year: number | null;
};

export type JimakuEntry = {
  id: number;
  name: string;
  englishName: string | null;
  japaneseName: string | null;
  anilistId: number | null;
  anime: boolean;
};

export type JimakuFile = {
  name: string;
  size: number;
  url: string;
  episodeGuess: number | null;
};

export type ReviewCard = {
  id: number;
  lemma: string;
  reading: string;
  meaning: string;
  pos: string | null;
  jlpt: string | null;
  exampleJp: string | null;
  exampleEn: string | null;
  seriesId: number;
  seriesTitle: string;
  episodeNumber: number;
  reps: number;
  intervals: { again: string; hard: string; good: string; easy: string };
};

export type ReviewQueue = {
  cards: ReviewCard[];
  dueCount: number;
  totalCount: number;
  nextDue: string | null;
};

export type KnownWord = {
  lemma: string;
  reading: string | null;
  createdAt: string;
};

export type Stats = {
  dueCount: number;
  cardCount: number;
  knownCount: number;
  seriesCount: number;
};
