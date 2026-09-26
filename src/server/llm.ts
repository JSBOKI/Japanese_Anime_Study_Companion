import { anthropicModel, llmName, openaiModel, type LlmName } from "./config.ts";
import type { Lesson } from "../shared/types.ts";

type Chat = (system: string, user: string) => Promise<string>;

async function openAiChat(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty lesson note");
  return text;
}

async function anthropicChat(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { content?: { text?: string }[] };
  const text = body.content?.map((part) => part.text || "").join("\n");
  if (!text) throw new Error("Anthropic returned an empty lesson note");
  return text;
}

function chatFor(name: LlmName): Chat | null {
  if (name === "openai") return openAiChat;
  if (name === "anthropic") return anthropicChat;
  return null;
}

function parseJson(text: string): { translations?: unknown; notes?: unknown; prose?: unknown } {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LLM did not return JSON");
  return JSON.parse(trimmed.slice(start, end + 1)) as { translations?: unknown; notes?: unknown };
}

export async function enrichLesson(lesson: Lesson): Promise<void> {
  const chat = chatFor(llmName());
  if (!chat) return;
  const targets = lesson.lines.length <= 45 ? lesson.lines : lesson.lines.filter((line) => line.featured).slice(0, 40);
  if (targets.length === 0) return;
  const level = lesson.level || "N2";
  const long = lesson.passage === "long";
  const system = [
    `You help an adult English speaker read Japanese at JLPT ${level}.`,
    "Return only JSON with keys translations, notes, and prose.",
    `translations: exactly ${targets.length} natural English lines, same order as the input lines.`,
    "notes: an object keyed by grammar id. One plain sentence on how that pattern is used here, or an empty string.",
    "prose.japanese: a natural prose recap of the scene, not a subtitle dump.",
    long
      ? "prose.japanese should be about 900 to 1400 characters."
      : "prose.japanese should be about 450 to 800 characters.",
    `Write prose.japanese at JLPT ${level}: grammar and vocabulary appropriate to that level, adult tone, no furigana, no markdown.`,
    "You may quote a short line, but most of the recap must be your own sentences.",
    "prose.english: a natural English translation of that recap.",
    "prose.title: a short Japanese title for the recap.",
    "Do not invent grammar that is not in the list. No markdown.",
  ].join(" ");
  const user = JSON.stringify({
    level,
    lines: targets.map((line) => line.text),
    grammar: lesson.grammar.map((item) => ({
      id: item.id,
      name: item.name,
      examples: item.examples,
    })),
  });
  const parsed = parseJson(await chat(system, user));
  const translations = Array.isArray(parsed.translations) ? parsed.translations.map((item) => String(item)) : [];
  if (translations.length === targets.length) {
    targets.forEach((line, index) => {
      const translation = translations[index]?.trim();
      if (translation) line.translation = translation;
    });
    for (const item of lesson.vocabulary) {
      const line = lesson.lines.find((candidate) => candidate.text === item.example && candidate.translation);
      if (line?.translation) item.exampleEn = line.translation;
    }
    lesson.summary = lesson.summary.replace(
      "The English under each line is a dictionary gloss, in word order, not a polished translation.",
      "Lines include a natural English translation. The gloss is still there if you want the word-by-word reading.",
    );
  }
  const prose = parsed.prose && typeof parsed.prose === "object" ? (parsed.prose as Record<string, unknown>) : null;
  const japanese = typeof prose?.japanese === "string" ? prose.japanese.trim() : "";
  if (lesson.prose && japanese.length >= 180 && /[\u3040-\u30ff\u4e00-\u9fff]/.test(japanese)) {
    lesson.prose = {
      ...lesson.prose,
      title: typeof prose?.title === "string" && prose.title.trim() ? prose.title.trim().slice(0, 40) : lesson.prose.title,
      text: japanese,
      translation: typeof prose?.english === "string" ? prose.english.trim() : null,
      source: "llm",
      note: "A scene recap written for this level.",
      tokens: [],
    };
  }
  const notes = parsed.notes && typeof parsed.notes === "object" ? (parsed.notes as Record<string, unknown>) : {};
  for (const item of lesson.grammar) {
    const note = notes[item.id];
    const extra = typeof note === "string" ? note.trim() : "";
    if (!extra) continue;
    item.explanation = `${item.explanation}\n\nIn this episode: ${extra.slice(0, 400)}`;
  }
}
