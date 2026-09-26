import type { StudyLevel } from "./level.ts";
import { levelRank } from "./level.ts";
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
  {
    id: "wake",
    name: "わけだ / わけではない",
    priority: 92,
    reminder: "わけ — the logic of the situation, or a denial that it is that simple.",
    explanation:
      "わけだ states a conclusion that follows from what was just said: “so that means…” わけではない pulls the other way: “that is not the whole reason” or “it does not follow that…” わけがない is stronger, “there is no way.” わけにはいかない means you cannot do it, not because it is impossible, but because circumstances or duty rule it out. Anime characters use わけじゃない constantly to refuse a simple reading of their motives.",
  },
  {
    id: "youni",
    name: "ようにする / ようになる",
    priority: 70,
    reminder: "ようにする — make yourself do it. ようになる — reach the point where it happens.",
    explanation:
      "ようにする is an effort you keep up: 遅れてこないようにする, “I’ll make sure not to be late.” ようになる is a change of state you have arrived at: 読めるようになった, “I’ve gotten to where I can read it.” A plain ように before a verb can also mean “so that” or “in the way that.”",
  },
  {
    id: "hazu",
    name: "はず",
    priority: 69,
    reminder: "はず — a conclusion you expect to be true.",
    explanation:
      "はず marks what ought to be the case from evidence or logic. 届いているはずだ is “it should have arrived.” はずがない denies that expectation. It is not a promise. When a character says はず, they are often one step away from being wrong.",
  },
  {
    id: "noni",
    name: "のに",
    priority: 67,
    reminder: "のに — “even though,” usually with frustration.",
    explanation:
      "のに connects a fact to an outcome that refuses to follow from it. 言ったのに、聞いてない is “I told you, and yet you didn’t listen.” The complaint is built into the grammar. のに at the end of a sentence can trail off and leave the disappointment hanging.",
  },
  {
    id: "tame",
    name: "ために",
    priority: 65,
    reminder: "ために — purpose (“in order to”) or cause (“because of”).",
    explanation:
      "After a verb, ために usually means purpose: 間に合わせるために夜を潰す, “stay up so it is ready in time.” After a noun it is often a cause: 雨のために遅れた, “delayed because of the rain.” Context tells the two apart. Purpose ために points forward; cause ために points back.",
  },
  {
    id: "nimokakawarazu",
    name: "にもかかわらず",
    priority: 91,
    reminder: "にもかかわらず — “despite,” more formal than のに.",
    explanation:
      "にもかかわらず concedes a fact and then goes against it. 時間がないにもかかわらず、雑な案は出せない is “despite having no time, we still cannot send a sloppy proposal.” It is the written and adult-speech version of the complaint in のに, with less whining and more stance.",
  },
  {
    id: "zaruoenai",
    name: "ざるを得ない",
    priority: 90,
    reminder: "ざるを得ない — “have no choice but to.”",
    explanation:
      "ざるを得ない is a reluctant obligation. やらざるを得ない means “I have no choice but to do it,” not “I want to.” ざる is classical negative, so the verb is in the ない-stem: する → せざる, 見る → 見ざる. You will meet it when a character is boxed in by work, duty, or a promise.",
  },
  {
    id: "chigainai",
    name: "に違いない",
    priority: 89,
    reminder: "に違いない — a firm “it must be.”",
    explanation:
      "に違いない is conviction, stronger than だろう and cooler than はず. 本音はそこだに違いない is “that has to be what they really mean.” The speaker is not asking you to agree. They are closing the case. に相違ない is the stiffer written twin.",
  },
  {
    id: "naikotoniwa",
    name: "ないことには",
    priority: 88,
    reminder: "ないことには — “unless that happens, the rest cannot.”",
    explanation:
      "ないことには says a later step is blocked until something else is done. 直さないことには、明日に間に合わない is “unless we fix it, it will not be ready tomorrow.” The second half is almost always negative or impossible. It is a working adult’s “we cannot move until.”",
  },
  {
    id: "monono",
    name: "ものの",
    priority: 86,
    reminder: "ものの — “although,” conceding before the real point.",
    explanation:
      "ものの grants the first clause and then limits it. 分かっているものの、今は動けない is “I do understand, and yet I cannot move now.” It is more written than けど, and it usually introduces the difficulty that remains after the concession.",
  },
  {
    id: "nishitemo",
    name: "にしても",
    priority: 85,
    reminder: "にしても — “even granting that.”",
    explanation:
      "にしても accepts a point only to say it does not settle the matter. 予算が厳しいにしても、この前提は外せない is “even if the budget is tight, we still cannot drop this premise.” それにしても (“even so”) comments on the whole situation rather than one noun.",
  },
  {
    id: "kaneru",
    name: "かねる / かねない",
    priority: 84,
    reminder: "かねる — cannot bring oneself to. かねない — there is a real risk.",
    explanation:
      "かねる attached to the masu-stem means the speaker finds it hard or improper to do something: 同意しかねる, “I cannot go along with that.” かねない is the opposite warning: 突き返されかねない, “they may well send it back.” かねない is not “unable.” It is “all too able to go wrong.”",
  },
  {
    id: "naradeha",
    name: "ならでは",
    priority: 83,
    reminder: "ならでは — “unique to,” something only this situation produces.",
    explanation:
      "ならでは says a quality exists because of this person or this case and would not otherwise. この案件ならではの線引き is “a line that only this deal would force us to draw.” It is praise or a precise limitation, not a general “if.”",
  },
  {
    id: "seide",
    name: "せいで / おかげで",
    priority: 80,
    reminder: "せいで blames a cause. おかげで gives credit.",
    explanation:
      "せいで pins a bad result on a cause, sometimes unfairly. 準備不足のせいで遅れた is “we are late because the prep was thin.” おかげで does the same job with a good, or sarcastic, result. The grammar is a judgment about whose fault or whose merit it is.",
  },
  {
    id: "tamaranai",
    name: "てしょうがない / てたまらない",
    priority: 78,
    reminder: "てしょうがない — a feeling too strong to sit on.",
    explanation:
      "てしょうがない and てたまらない attach to a feeling or state and say it is overwhelming. 気になってしょうがない is “I cannot stop turning it over.” てならない is the more written shape. These are not commands. They report a pressure inside the speaker.",
  },
  {
    id: "kkonai",
    name: "っこない",
    priority: 76,
    reminder: "っこない — blunt “no way that happens.”",
    explanation:
      "っこない is a rough spoken rejection of a possibility. 間に合いっこない is “there is no way we make it.” It comes from ことはない and is stronger, and ruder, than わけがない. Common when a character is done pretending.",
  },
  {
    id: "contractions",
    name: "Spoken contractions",
    priority: 94,
    reminder: "ちゃう, とく, なきゃ, じゃん, っけ — the full grammar, said fast.",
    explanation:
      "Adult dialogue rarely leaves てしまう, ておく, なければ, or の intact. ちゃう and じゃう are てしまう: 出しちゃった is “I went and sent it,” often with a sting of regret. とく and どく are ておく: 残しとく means “I’ll leave it in place for later,” not “I’ll leave it forever.” なきゃ and なくちゃ are なければならない with the ending dropped. じゃん demands agreement the way ではないか does, and っけ reaches back for a memory the speaker is no longer sure of. Read the short form as the full pattern, then notice the attitude the shortening adds.",
  },
  {
    id: "jan",
    name: "じゃん",
    priority: 74,
    reminder: "じゃん — “isn’t it,” pushing you to see it too.",
    explanation:
      "じゃん is the casual descendant of ではないか. 崩れてるじゃん means “it’s already fallen apart, come on.” The speaker thinks the fact is obvious and wants you to admit it. It is not a neutral question.",
  },
  {
    id: "kke",
    name: "っけ",
    priority: 73,
    reminder: "っけ — checking a memory you no longer trust.",
    explanation:
      "っけ asks the listener, or yourself, to confirm something that should be known. 見直したっけ is “we did revise it, didn’t we?” The doubt is about memory, not about grammar. It often follows た or だ.",
  },
  {
    id: "poi",
    name: "っぽい",
    priority: 72,
    reminder: "っぽい — “has the feel of,” a rough らしい.",
    explanation:
      "っぽい adds “-ish” or “looks like” to a noun, verb stem, or even a clause. 雨っぽい is “it feels like rain.” It is more subjective and spoken than らしい. On a person, 子供っぽい is “childish,” a judgment, not a description of age.",
  },
  {
    id: "yagaru",
    name: "やがる",
    priority: 70,
    reminder: "やがる — contempt or irritation toward the doer.",
    explanation:
      "やがる sticks to the masu-stem and aims the verb at someone the speaker resents. 逃げやがった is “they had the nerve to run.” The action is the same as the plain verb. The grammar adds “and I am angry at them for it.” It is rough, and it is common in conflict scenes.",
  },
  {
    id: "terarenai",
    name: "てらんない",
    priority: 68,
    reminder: "てらんない — “I can’t be bothered to keep doing this.”",
    explanation:
      "てらんない is the crushed form of ていられない. 待ってらんない means “I can’t just keep waiting.” The speaker is refusing to stay in the current state. You will hear it when patience has already run out.",
  },
  {
    id: "zuni",
    name: "ずにはいられない",
    priority: 66,
    reminder: "ずにはいられない — “cannot help but.”",
    explanation:
      "ずにはいられない says the feeling or action forces itself out. 言わずにはいられない is “I cannot not say it.” ず is a classical negative on the ない-stem (する → せず). It is literary, and characters use it when they want that weight.",
  },
];

const PATTERN_LEVEL: Record<string, StudyLevel> = {
  teiru: "N5",
  tai: "N5",
  nai: "N5",
  kudasai: "N5",
  enders: "N5",
  kara: "N5",
  nda: "N4",
  tara: "N4",
  temiru: "N4",
  nakuteii: "N4",
  volitional: "N4",
  kedo: "N4",
  janai: "N4",
  mashou: "N4",
  naide: "N4",
  youni: "N3",
  hazu: "N3",
  noni: "N3",
  tame: "N3",
  chau: "N3",
  teoku: "N3",
  kamo: "N3",
  darou: "N3",
  wake: "N2",
  nimokakawarazu: "N2",
  zaruoenai: "N2",
  chigainai: "N2",
  naikotoniwa: "N2",
  monono: "N2",
  nishitemo: "N2",
  kaneru: "N2",
  naradeha: "N2",
  seide: "N2",
  tamaranai: "N2",
  kkonai: "N2",
  contractions: "N2",
  nakya: "N2",
  jan: "N2",
  kke: "N2",
  poi: "N2",
  yagaru: "N1",
  terarenai: "N1",
  zuni: "N1",
};

const BY_ID = new Map(PATTERNS.map((pattern) => [pattern.id, pattern]));

export function patternInfo(id: string): PatternInfo | undefined {
  return BY_ID.get(id);
}

export function patternLevel(id: string): StudyLevel {
  return PATTERN_LEVEL[id] || "N3";
}

export function patternInRange(id: string, level: StudyLevel): boolean {
  return levelRank(patternLevel(id)) <= levelRank(level);
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
  if (/わけ(?:では|じゃ)ない|わけがない|わけにはいかない|わけにはいけない|わけだ|わけない/.test(text)) add("wake");
  if (/ようにする|ようになる|ないように/.test(text)) add("youni");
  if (/はず/.test(text)) add("hazu");
  if (/のに/.test(text)) add("noni");
  if (/ために/.test(text)) add("tame");
  if (/にもかかわらず/.test(text)) add("nimokakawarazu");
  if (/ざるを得ない|ざるをえない/.test(text)) add("zaruoenai");
  if (/に違いない|にちがいない/.test(text)) add("chigainai");
  if (/ないことには/.test(text)) add("naikotoniwa");
  if (/ものの/.test(text)) add("monono");
  if (/にしても/.test(text)) add("nishitemo");
  if (/かねない|かねる/.test(text)) add("kaneru");
  if (/ならでは/.test(text)) add("naradeha");
  if (/せいで|おかげで/.test(text)) add("seide");
  if (/てしょうがない|て仕方ない|てたまらない|てならない/.test(text)) add("tamaranai");
  if (/っこない/.test(text)) add("kkonai");
  if (/じゃん/.test(text)) add("jan");
  if (/っけ/.test(text)) add("kke");
  if (/っぽい/.test(text)) add("poi");
  if (/やがる|やがった|やがって/.test(text)) add("yagaru");
  if (/てらんない|てられない|ていられない/.test(text)) add("terarenai");
  if (/ずにはいられない/.test(text)) add("zuni");
  if (
    /ちゃっ|ちゃう|じゃう|なきゃ|なくちゃ|じゃん|っけ/.test(text) ||
    /[きしちにびりみ]と(?:く|いて|いた|こう)/.test(text) ||
    /[きしちにびりみ]ど(?:く|いて|いた|こう)/.test(text)
  ) {
    add("contractions");
  }
  return ids;
}
