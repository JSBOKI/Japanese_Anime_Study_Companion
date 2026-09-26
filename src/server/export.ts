import { createRequire } from "node:module";
import type { ExportCard } from "./db.ts";

const require = createRequire(import.meta.url);

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function cardsToCsv(cards: ExportCard[]): string {
  const header = ["Front", "Back", "Reading", "Meaning", "PartOfSpeech", "JLPT", "Example", "ExampleEnglish", "Series", "Episode", "Tags"];
  const lines = [header.join(",")];
  for (const card of cards) {
    const front = card.lemma;
    const back = [card.meaning, card.exampleJp, card.exampleEn].filter(Boolean).join("<br>");
    const row = [
      front,
      back,
      card.reading,
      card.meaning,
      card.pos || "",
      card.jlpt || "",
      card.exampleJp || "",
      card.exampleEn || "",
      card.seriesTitle,
      String(card.episodeNumber),
      ["yomu", card.jlpt || "", `ep${card.episodeNumber}`].filter(Boolean).join(" "),
    ];
    lines.push(row.map((cell) => csvCell(cell)).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

export async function cardsToApkg(deckName: string, cards: ExportCard[]): Promise<Buffer> {
  const AnkiExport = require("anki-apkg-export").default as (
    name: string,
  ) => { addCard: (front: string, back: string, opts?: { tags?: string[] }) => void; save: () => Promise<Buffer> };
  const deck = AnkiExport(deckName);
  for (const card of cards) {
    const front = `<div style="font-size:28px;font-family:sans-serif">${escapeHtml(card.lemma)}</div><div style="font-size:16px;color:#666">${escapeHtml(card.reading)}</div>`;
    const back = [
      `<div style="font-size:20px">${escapeHtml(card.meaning)}</div>`,
      card.pos || card.jlpt ? `<div style="color:#666">${escapeHtml([card.pos, card.jlpt].filter(Boolean).join(" · "))}</div>` : "",
      card.exampleJp ? `<hr><div style="font-size:18px">${escapeHtml(card.exampleJp)}</div>` : "",
      card.exampleEn ? `<div>${escapeHtml(card.exampleEn)}</div>` : "",
    ].join("");
    deck.addCard(front, back, {
      tags: ["yomu", card.jlpt || "", `episode${card.episodeNumber}`].filter(Boolean),
    });
  }
  return deck.save();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
