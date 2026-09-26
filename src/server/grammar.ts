import type { Token } from "./tokenizer.ts";

export type PatternInfo = {
  id: string;
  name: string;
  priority: number;
  explanation: string;
  reminder: string;
};

const ENDER_NOTES: Record<string, string> = {
  ね: "ね invites the listener to agree, like “right?” or “huh”. 早いね is “you’re early, aren’t you.”",
  よ: "よ insists on something, often information the speaker thinks you don’t have. まだ来てないよ is “it hasn’t come, you know.”",
  な: "な at the end of a casual sentence works like a rougher ね, asking you to go along with it. (A dictionary-form verb plus な, as in するな, is instead a blunt “don’t.”)",
  か: "か turns the sentence into a question. On its own it can sound a bit direct; かな is softer, “I wonder.”",
  ぞ: "ぞ is a rough, masculine push: the speaker is declaring something and expects it to land.",
  ぜ: "ぜ is another rough ending, friendlier than ぞ, like “I’m telling you.”",
  わ: "わ softens a statement. In anime it often sounds gentle or feminine; in some regions it is just emphasis.",
  さ: "さ is a casual filler ending. It keeps the sentence light, a bit like “you see.”",
  の: "の at the very end can be a soft question or an explanation, especially in casual speech.",
  かな: "かな means “I wonder.” It is less direct than a plain か question.",
};

const PATTERNS: PatternInfo[] = [
  {
    id: "teiru",
    name: "ている / てる",
    priority: 96,
    reminder: "ている / てる — an action in progress, or a state that is still true.",
    explanation:
      "The て-form of a verb plus いる says an action is underway, or that its result is still in effect. 食べている can mean “is eating,” while 開いている often means “is open.” In casual speech いる shrinks to る: 来てない is 来ていない, “hasn’t come.” A trailing てて, as in 待ってて, is the same pattern used as a soft request: “keep doing that” or “do that for me.”",
  },
  {
    id: "tai",
    name: "たい",
    priority: 94,
    reminder: "たい — the speaker wants to do the verb.",
    explanation:
      "たい attaches to the masu-stem of a verb and means the speaker wants to do it. 飲みたい is “I want to drink.” It then conjugates like an い-adjective: たかった (wanted to), たくない (don’t want to). It is about the speaker’s own desire; for someone else, Japanese usually switches to たがる.",
  },
  {
    id: "nai",
    name: "ない",
    priority: 90,
    reminder: "ない — plain present negative, “doesn’t” or “won’t.”",
    explanation:
      "ない is the plain negative ending on verbs. 来ない means “doesn’t come” or “won’t come.” The polite partner is ません. Together with ている, 来てない means “hasn’t come” or “isn’t here,” not a simple “won’t come.”",
  },
  {
    id: "kudasai",
    name: "ください",
    priority: 88,
    reminder: "ください — a polite request, “please do” or “please give me.”",
    explanation:
      "ください asks for something politely. After the て-form it means “please do this” (見てください, “please look”). After a noun it means “please give me this,” as in コーヒーを二つください. The dictionary form of the verb is くださる.",
  },
  {
    id: "enders",
    name: "Sentence-ending particles",
    priority: 86,
    reminder: "ね, よ, and the other sentence endings carry attitude more than meaning.",
    explanation: "",
  },
  {
    id: "nda",
    name: "んだ / のです",
    priority: 84,
    reminder: "んだ / んです — explains a situation or asks for the reason behind it.",
    explanation:
      "んだ (casual) and んです (polite) come from のだ. They frame a sentence as an explanation, a reason, or a request for one. 寝てないんだ feels like “the thing is, I haven’t slept,” not a flat fact. You’ll hear it constantly in dialogue when someone is justifying themselves or pressing for context.",
  },
  {
    id: "chau",
    name: "ちゃう / てしまう",
    priority: 83,
    reminder: "ちゃう / じゃう — casual てしまう, “ended up” or “finished completely.”",
    explanation:
      "てしまう means an action is carried through, sometimes with a sense of “oops” or regret. Casual speech contracts てしまう to ちゃう and でしまう to じゃう. 来ちゃった is “it came (already / before I was ready).” 読んじゃった is “I went and read it.” The past ちゃった / じゃった is especially common in anime.",
  },
  {
    id: "tara",
    name: "たら",
    priority: 82,
    reminder: "たら — “if” or “when,” the most common spoken conditional.",
    explanation:
      "たら is the た-form plus ら. It means “if” or “when” something happens, and then the next clause follows. 雨が降ったら、駅で待ってて is “if it rains, wait at the station.” It is the conditional you will hear most often in conversation. It is not the same as たら in words like やたら (“recklessly”).",
  },
  {
    id: "kara",
    name: "から",
    priority: 78,
    reminder: "から after a clause — “because” or “so.”",
    explanation:
      "When から follows a clause, it gives a reason: “because” or “so.” 熱いから気をつけて means “it’s hot, so be careful.” This is different from から after a noun, which means “from” (駅から, “from the station”). The reason から often comes before a request or a decision.",
  },
  {
    id: "temiru",
    name: "てみる",
    priority: 76,
    reminder: "てみる — try doing something and see.",
    explanation:
      "The て-form plus みる means you do something to see what happens. 行ってみる is “I’ll try going” or “let’s see by going.” It is not the verb 見る, “to look,” on its own. In the sample kind of line 一緒に行ってみる？ the question is “want to try going together?”",
  },
  {
    id: "nakuteii",
    name: "なくていい",
    priority: 75,
    reminder: "なくていい — “you don’t have to.”",
    explanation:
      "なくていい (and なくてもいい) means there is no need to do something. 急がなくていい is “you don’t have to hurry.” It is the opposite feeling of なきゃ (“have to”). いい here means “it’s fine,” not “good at.”",
  },
  {
    id: "volitional",
    name: "おう / よう",
    priority: 74,
    reminder: "The volitional — “let’s” or “I’ll go ahead and.”",
    explanation:
      "The volitional form suggests doing something, either together or as your own decision. 頑張ろう is “let’s do our best” or “I’ll give it a real try.” Godan verbs take an お-row sound plus う (行く → 行こう). Ichidan verbs use the stem plus よう (食べる → 食べよう). ましょう is the polite version of the same idea.",
  },
  {
    id: "teoku",
    name: "ておく",
    priority: 72,
    reminder: "ておく — do something ahead of time, for later.",
    explanation:
      "ておく means you do something now so it is ready later. 買っておいてくれる？ is “will you buy it ahead for me?” Casual speech often contracts ておく to とく and でおく to どく: 聞いとく, “I’ll ask in advance.” おいてくれる adds “do me the favor of.”",
  },
  {
    id: "nakya",
    name: "なきゃ / なくちゃ",
    priority: 71,
    reminder: "なきゃ / なくちゃ — casual “have to.”",
    explanation:
      "なきゃ and なくちゃ are spoken shortenings of なければ and なくては. They mean “have to” or “must.” 行かなきゃ is “I gotta go.” The fuller textbook form is なければならない or なくてはいけない. Anime drops the いけない constantly, and the “have to” is still understood.",
  },
  {
    id: "kedo",
    name: "けど",
    priority: 68,
    reminder: "けど — “but,” often just softening what comes next.",
    explanation:
      "けど (from けれど) means “but” or “though.” In speech it also trails off to soften a request or a preface: いいんだけど… leaves room for the listener. けれども is the more formal shape of the same word.",
  },
  {
    id: "janai",
    name: "じゃない",
    priority: 66,
    reminder: "じゃない — casual “is not.”",
    explanation:
      "じゃない is the casual negative of だ. 学生じゃない means “is not a student.” ではない is the more formal version. At the end of a sentence with a rising tone, じゃない？ can also seek agreement, like “isn’t it?”",
  },
  {
    id: "kamo",
    name: "かもしれない",
    priority: 64,
    reminder: "かもしれない / かも — “might.”",
    explanation:
      "かもしれない means something is possible but not certain. 雨かもしれない is “it might be rain.” Casual speech often stops at かも: そうかも, “maybe.” It is softer than a flat statement and very common when characters are guessing.",
  },
  {
    id: "darou",
    name: "だろう / でしょう",
    priority: 62,
    reminder: "だろう / でしょう — “probably,” or a nudge for agreement.",
    explanation:
      "だろう (plain) and でしょう (polite) mark a guess, “probably,” or invite the listener to agree. 来るでしょう is “they’ll come, won’t they?” A clipped だろ is rougher. It is not the same as the volitional, even though both can feel like a suggestion.",
  },
  {
    id: "mashou",
    name: "ましょう",
    priority: 60,
    reminder: "ましょう — polite “let’s.”",
    explanation:
      "ましょう is the polite “let’s” or “shall we.” 行きましょう is “let’s go.” It is the polite partner of the plain volitional (行こう). You’ll hear it from staff, announcements, and characters being considerate.",
  },
  {
    id: "naide",
    name: "ないで",
    priority: 58,
    reminder: "ないで — “without doing,” or “please don’t.”",
    explanation:
      "ないで before another verb means “without doing” the first action. ないでください is a polite “please don’t.” It is different from なくて, which is the て-form of the negative and shows up in なくていい (“don’t have to”).",
  },
];

const BY_ID = new Map(PATTERNS.map((pattern) => [pattern.id, pattern]));

export function patternInfo(id: string): PatternInfo | undefined {
  return BY_ID.get(id);
}

export function allPatterns(): PatternInfo[] {
  return PATTERNS;
}

function isTe(token: Token): boolean {
  return token.surface === "て" || token.surface === "で";
}

function hasSequence(tokens: Token[], test: (left: Token, right: Token) => boolean): boolean {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (test(tokens[i], tokens[i + 1])) return true;
  }
  return false;
}

export function endersIn(tokens: Token[], text: string): string[] {
  const found: string[] = [];
  const add = (key: string) => {
    if (ENDER_NOTES[key] && !found.includes(key)) found.push(key);
  };
  if (/かな/.test(text)) add("かな");
  for (const token of tokens) {
    if (token.pos !== "助詞" || token.detail !== "終助詞") continue;
    add(token.surface);
  }
  return found;
}

export function endersExplanation(enders: string[]): string {
  const notes = enders.map((ender) => ENDER_NOTES[ender]).filter(Boolean);
  return [
    "Anime dialogue leans on small words stuck to the end of a sentence. They rarely change the facts of the sentence. They show attitude: softness, insistence, a question, or “I’m telling you.”",
    ...notes,
  ].join("\n\n");
}

export function endersName(enders: string[]): string {
  const shown = enders.filter((ender) => ender !== "かな").slice(0, 4);
  const list = shown.length ? shown.join("、") : "ね、よ";
  return `Sentence-ending particles (${list})`;
}

function isVolitional(text: string, tokens: Token[]): boolean {
  if (tokens.some((token) => token.pos === "動詞" && /意志|ウ接続/.test(token.conjugation))) return true;
  const stripped = text.replace(/\s/g, "").replace(/[。！？!?…]+$/g, "");
  if (/(ありがとう|おはよう|こんにちは|こんばんは|さようなら)$/.test(stripped)) return false;
  return /[おこそとのほもよろごぞどぼぽ]う$/.test(stripped) && tokens.some((token) => token.pos === "動詞");
}

export function matchPatternIds(text: string, tokens: Token[]): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };

  if (
    tokens.some((token) => token.lemma === "てる" && token.detail === "非自立") ||
    hasSequence(tokens, (left, right) => isTe(left) && (right.lemma === "いる" || right.lemma === "居る"))
  ) {
    add("teiru");
  }
  if (tokens.some((token) => token.pos === "助動詞" && token.lemma === "たい")) add("tai");
  if (tokens.some((token) => token.pos === "助動詞" && token.lemma === "ない")) add("nai");
  if (/ください|下さい/.test(text) || tokens.some((token) => token.lemma === "くださる" || token.lemma === "下さる")) {
    add("kudasai");
  }
  if (endersIn(tokens, text).length) add("enders");
  if (
    hasSequence(
      tokens,
      (left, right) =>
        (left.surface === "ん" || left.lemma === "ん") &&
        (right.lemma === "だ" || right.lemma === "です" || right.surface.startsWith("です")),
    ) ||
    /んです|のです|のだ/.test(text)
  ) {
    add("nda");
  }
  if (
    tokens.some((token) => (token.lemma === "ちゃう" || token.lemma === "じゃう") && token.detail === "非自立") ||
    hasSequence(tokens, (left, right) => isTe(left) && (right.lemma === "しまう" || right.lemma === "仕舞う"))
  ) {
    add("chau");
  }
  if (tokens.some((token) => token.pos === "助動詞" && (token.surface === "たら" || (token.lemma === "た" && token.conjugation === "仮定形")))) {
    add("tara");
  }
  if (tokens.some((token) => token.surface === "から" && token.detail === "接続助詞")) add("kara");
  if (hasSequence(tokens, (left, right) => isTe(left) && (right.lemma === "みる" || right.lemma === "見る"))) add("temiru");
  if (/なく(?:て|ても)いい|なくてもいい|ないでいい/.test(text)) add("nakuteii");
  if (isVolitional(text, tokens)) add("volitional");
  if (
    hasSequence(tokens, (left, right) => isTe(left) && (right.lemma === "おく" || right.lemma === "置く")) ||
    /[てで]おいて|[てで]おく|といて|どいて/.test(text)
  ) {
    add("teoku");
  }
  if (/なきゃ|なくちゃ|なければならない|なくてはいけない|ないといけない|なきゃいけない/.test(text)) add("nakya");
  if (/けど|けれど|けれども|けども/.test(text)) add("kedo");
  if (/じゃない|ではない|じゃねえ|じゃねぇ/.test(text)) add("janai");
  if (/かもしれない|かも知れない|かもね|かもよ|かもな|かも[。！？]?$/.test(text)) add("kamo");
  if (/だろう|でしょう|だろ[うねよ？?]?$/.test(text) || tokens.some((token) => token.lemma === "だろう" || token.surface === "だろ")) {
    add("darou");
  }
  if (/ましょう/.test(text)) add("mashou");
  if (/ないで(?!いい)/.test(text)) add("naide");
  return ids;
}
