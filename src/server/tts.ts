import { spawn } from "node:child_process";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { Readable } from "node:stream";
import {
  openaiTtsModel,
  ttsName,
  voices,
  voicevoxSpeaker,
  voicevoxUrl,
  type TtsName,
} from "./config.ts";
import { xmlEscape } from "./kana.ts";

export type SpeechLang = "ja" | "en";

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const locks = { ja: new Mutex(), en: new Mutex() };
let edgeJa: MsEdgeTTS | null = null;
let edgeEn: MsEdgeTTS | null = null;

async function edgeEngine(lang: SpeechLang): Promise<MsEdgeTTS> {
  if (lang === "ja") {
    if (!edgeJa) {
      edgeJa = new MsEdgeTTS();
      await edgeJa.setMetadata(voices.ja, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    }
    return edgeJa;
  }
  if (!edgeEn) {
    edgeEn = new MsEdgeTTS();
    await edgeEn.setMetadata(voices.en, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  }
  return edgeEn;
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function edgeSpeak(text: string, lang: SpeechLang, slow: boolean): Promise<Buffer> {
  return locks[lang].run(async () => {
    const engine = await edgeEngine(lang);
    const spoken = xmlEscape(text).slice(0, 800);
    const { audioStream } = engine.toStream(spoken, slow ? { rate: "slow" } : undefined);
    const audio = await streamToBuffer(audioStream);
    if (audio.length < 400) throw new Error("Edge TTS returned an empty audio clip");
    return audio;
  });
}

async function openAiSpeak(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiTtsModel,
      voice: process.env.OPENAI_TTS_VOICE || "nova",
      input: text.slice(0, 800),
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

function ffmpegBuffer(args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString("utf8").slice(-500) || `ffmpeg exited ${code}`));
        return;
      }
      resolve(Buffer.concat(out));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function voicevoxSpeak(text: string): Promise<Buffer> {
  const queryUrl = `${voicevoxUrl}/audio_query?text=${encodeURIComponent(text.slice(0, 400))}&speaker=${voicevoxSpeaker}`;
  const queryRes = await fetch(queryUrl, { method: "POST" });
  if (!queryRes.ok) throw new Error(`VOICEVOX audio_query failed (${queryRes.status}). Is the engine running at ${voicevoxUrl}?`);
  const query = await queryRes.json();
  const synth = await fetch(`${voicevoxUrl}/synthesis?speaker=${voicevoxSpeaker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synth.ok) throw new Error(`VOICEVOX synthesis failed (${synth.status})`);
  const wav = Buffer.from(await synth.arrayBuffer());
  return ffmpegBuffer(["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "mp3", "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k", "pipe:1"], wav);
}

export async function synthesize(text: string, lang: SpeechLang, slow = false): Promise<Buffer> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Nothing to speak");
  const provider = safeTtsName();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (provider === "openai") return await openAiSpeak(cleaned);
      if (provider === "voicevox") {
        if (lang === "en") return await edgeSpeak(cleaned, "en", slow);
        return await voicevoxSpeak(cleaned);
      }
      return await edgeSpeak(cleaned, lang, slow);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Speech synthesis failed");
}

export function safeTtsName(): TtsName {
  try {
    return ttsName();
  } catch {
    return "edge";
  }
}

export function describeTts(): string {
  const name = safeTtsName();
  if (name === "edge") return `edge (${voices.ja} / ${voices.en})`;
  if (name === "voicevox") return `voicevox speaker ${voicevoxSpeaker}`;
  return `openai (${openaiTtsModel})`;
}
