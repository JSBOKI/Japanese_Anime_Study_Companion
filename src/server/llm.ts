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
    signal: AbortSignal.timeout(25_000),
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
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 2500,
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

function parseJson(text: string): { translations?: unknown; notes?: unknown } {
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
  const system = [
    "You help an English-speaking beginner read Japanese dialogue.",
    "Return only JSON: {\"translations\": string[], \"notes\": { [patternId: string]: string } }.",
    `translations must contain exactly ${targets.length} natural English lines, in the same order.`,
    "Keep the tone of the Japanese. Do not add jokes or cultural lectures.",
    "notes: for each grammar id, one plain sentence about how it is used in the examples, or an empty string.",
    "Do not invent grammar that is not in the list. No markdown.",
  ].join(" ");
  const user = JSON.stringify({
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
  const notes = parsed.notes && typeof parsed.notes === "object" ? (parsed.notes as Record<string, unknown>) : {};
  for (const item of lesson.grammar) {
    const note = notes[item.id];
    const extra = typeof note === "string" ? note.trim() : "";
    if (!extra) continue;
    item.explanation = `${item.explanation}\n\nIn this episode: ${extra.slice(0, 400)}`;
  }
}
