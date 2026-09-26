import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(here, "../..");
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
export const dictDir = path.join(dataDir, "dict");
export const audioDir = path.join(dataDir, "audio");
export const dbPath = path.join(dataDir, "yomu.db");
export const sampleDir = path.join(rootDir, "sample");
export const port = Number(process.env.PORT || 3000);
export const host = process.env.HOST || "0.0.0.0";

export type LlmName = "none" | "openai" | "anthropic";
export type TtsName = "edge" | "openai" | "voicevox";

export function llmName(): LlmName {
  const explicit = (process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (explicit === "none" || explicit === "off") return "none";
  if (explicit === "openai") return process.env.OPENAI_API_KEY ? "openai" : "none";
  if (explicit === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : "none";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

export function ttsName(): TtsName {
  const explicit = (process.env.TTS_PROVIDER || "edge").trim().toLowerCase();
  if (explicit === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("TTS_PROVIDER=openai requires OPENAI_API_KEY");
    }
    return "openai";
  }
  if (explicit === "voicevox") return "voicevox";
  return "edge";
}

export const voices = {
  ja: process.env.TTS_VOICE_JA || "ja-JP-NanamiNeural",
  en: process.env.TTS_VOICE_EN || "en-US-JennyNeural",
};

export const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
export const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
export const openaiTtsModel = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
export const voicevoxUrl = (process.env.VOICEVOX_URL || "http://127.0.0.1:50021").replace(/\/$/, "");
export const voicevoxSpeaker = Number(process.env.VOICEVOX_SPEAKER || 2);

export function jimakuKey(): string | null {
  const key = (process.env.JIMAKU_API_KEY || "").trim();
  return key || null;
}

/** Hour in Asia/Tokyo for the daily news fetch. Default 6. Invalid values fall back to 6. */
export function newsFetchHour(): number {
  const raw = process.env.NEWS_FETCH_HOUR;
  if (raw === undefined || raw.trim() === "") return 6;
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 6;
  return hour;
}

/** Optional override for the NHK main RSS URL. Empty uses the public NHK feeds. */
export function newsRssUrl(): string | null {
  const raw = (process.env.NEWS_RSS_URL || "").trim();
  return raw || null;
}
