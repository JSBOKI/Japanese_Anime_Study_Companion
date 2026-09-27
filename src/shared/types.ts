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
  netflixUrl: string | null;
  netflixSource: "anilist" | "justwatch" | "manual" | "none" | null;
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
  netflixWatchUrl: string | null;
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

export type ListenCue = {
  index: number;
  text: string;
  speaker: string | null;
  voice: string;
  part: number;
  start: number;
  end: number;
  offset: number;
  tokens: LineToken[];
  gloss: string;
  translation: string | null;
};

export type ListenAlong = {
  episodeId: number;
  number: number;
  title: string | null;
  seriesTitle: string;
  status: "idle" | "pending" | "ready" | "error";
  progress: string | null;
  error: string | null;
  parts: { index: number; seconds: number; bytes: number }[];
  cues: ListenCue[];
  seconds: number;
  bytes: number;
  engineNote: string | null;
  estimate: { seconds: number; bytes: number };
  nextEpisodeId: number | null;
  diskWarning: string | null;
};

export type EpisodeDetail = EpisodeSummary & {
  seriesTitle: string;
  seriesNative: string | null;
  netflixUrl: string | null;
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
  episodeTitle: string | null;
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

export type SubtitleFetch = {
  status: "idle" | "running" | "done" | "error";
  source: string | null;
  message: string | null;
  matched: number;
  total: number;
};

export type Stats = {
  dueCount: number;
  cardCount: number;
  knownCount: number;
  seriesCount: number;
};

export type NewsEnglishSource = "llm" | "nhk-world" | "none";

export type NewsCard = {
  id: number;
  title: string;
  category: string;
  readingMinutes: number;
  level: StudyLevel | null;
  publishedAt: string | null;
  hasEnglish: boolean;
  englishSource: NewsEnglishSource;
};

export type NewsList = {
  day: string;
  today: string;
  days: string[];
  error: string | null;
  refreshedAt: string | null;
  stories: NewsCard[];
};

export type DiveKind = "report" | "opinion" | "reaction";

export type DiveSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  kind: DiveKind;
  lang: "ja" | "en";
};

export type DeepDive = {
  storyId: number;
  title: string;
  needsKey: boolean;
  note: string | null;
  reactionNote: string | null;
  sources: DiveSource[];
  paragraphsJa: string[];
  paragraphsEn: string[];
  lesson: Lesson | null;
  levelStale: boolean;
  audioJa: boolean;
  audioEn: boolean;
  llm: string;
};

export type RollupPick = {
  storyId: number;
  title: string;
  includeDeep: boolean;
};

export type RollupPart = {
  index: number;
  seconds: number;
  bytes: number;
  label: string;
};

export type RollupBuild = {
  id: number;
  lang: "ja" | "en" | "both";
  speed: number;
  status: "running" | "done" | "error" | string;
  message: string | null;
  parts: RollupPart[];
};

export type BookProgress = {
  chapterIndex: number;
  paragraphIndex: number;
  chapterTitle?: string | null;
};

export type BookShelfItem = {
  cardId: number;
  title: string;
  titleKana: string | null;
  author: string;
  difficulty: string | null;
  lengthLabel: string | null;
  summary: string | null;
  recommended: boolean;
  startHere: boolean;
  added: boolean;
  chapterCount: number;
  sourceUrl: string | null;
  progress: BookProgress | null;
};

export type BookTocItem = {
  index: number;
  partTitle: string | null;
  title: string;
  label: string;
  charCount: number;
};

export type BookDetail = {
  cardId: number;
  title: string;
  titleKana: string | null;
  author: string;
  difficulty: string | null;
  lengthLabel: string | null;
  summary: string | null;
  startHere: boolean;
  sourceUrl: string | null;
  charCount: number;
  chapters: BookTocItem[];
  progress: { chapterIndex: number; paragraphIndex: number } | null;
  job: { status: string; done: number; total: number; message: string | null } | null;
  llm: boolean;
};

export type BookParagraph = {
  index: number;
  text: string;
  tokens: LineToken[];
  translation: string | null;
};

export type BookChapterView = {
  cardId: number;
  title: string;
  author: string;
  index: number;
  partTitle: string | null;
  chapterTitle: string;
  label: string;
  paragraphs: BookParagraph[];
  translated: boolean;
  translationNote: string | null;
  llm: boolean;
  listenStatus: string;
  chapterCount: number;
  sourceUrl: string | null;
};

export type BookListenCue = {
  index: number;
  text: string;
  part: number;
  start: number;
  end: number;
  offset: number;
  tokens: LineToken[];
  gloss: string;
};

export type BookListenView = {
  cardId: number;
  bookTitle: string;
  author: string;
  chapterIndex: number;
  chapterTitle: string;
  partTitle: string | null;
  label: string;
  status: "idle" | "pending" | "ready" | "error";
  progress: string | null;
  error: string | null;
  parts: { index: number; seconds: number; bytes: number }[];
  cues: BookListenCue[];
  seconds: number;
  bytes: number;
  engineNote: string | null;
  estimate: { seconds: number; bytes: number };
  nextChapter: number | null;
  nextReady: boolean;
  prevChapter: number | null;
};

export type BookSearchHit = {
  cardId: number;
  title: string;
  titleKana: string | null;
  author: string;
  orthography: string | null;
  sourceUrl: string;
  added: boolean;
  difficulty: string | null;
  lengthLabel: string | null;
};

export type NewsDetail = NewsCard & {
  url: string | null;
  titleEn: string | null;
  paragraphsJa: string[];
  paragraphsEn: string[];
  englishNote: string | null;
  englishUrl: string | null;
  lesson: Lesson | null;
  levelStale: boolean;
  cardCount: number;
  audioJa: boolean;
  audioEn: boolean;
};
