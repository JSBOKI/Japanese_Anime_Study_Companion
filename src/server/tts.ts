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
  return locks[lang].run(async () => speakWith(await edgeEngine(lang), text, slow));
}

const jaVoices = new Map<string, MsEdgeTTS>();

export async function synthesizeJaVoice(text: string, voice: string): Promise<Buffer> {
  return locks.ja.run(async () => {
    let engine = jaVoices.get(voice);
    if (!engine) {
      engine = new MsEdgeTTS();
      await engine.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      jaVoices.set(voice, engine);
    }
    return speakWith(engine, text, false);
  });
}

async function speakWith(engine: MsEdgeTTS, text: string, slow: boolean): Promise<Buffer> {
  const spoken = xmlEscape(text).slice(0, 800);
  const { audioStream } = engine.toStream(spoken, slow ? { rate: "slow" } : undefined);
  const audio = await streamToBuffer(audioStream);
  if (audio.length < 400) throw new Error("Edge TTS returned an empty audio clip");
  return audio;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dropJaVoice(voice: string): void {
  const engine = jaVoices.get(voice);
  jaVoices.delete(voice);
  try {
    engine?.close();
  } catch {
    /* the socket may already be gone */
  }
}

export type SpeechEngine = "edge" | "openai" | "google" | "gtts";

export function googleTtsKey(): string | null {
  const key = (process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || "").trim();
  return key || null;
}

async function googleCloudSpeak(text: string, lang: SpeechLang): Promise<Buffer> {
  const key = googleTtsKey();
  if (!key) throw new Error("Google Cloud TTS is not configured");
  const voice = lang === "ja"
    ? process.env.GOOGLE_TTS_VOICE || "ja-JP-Neural2-B"
    : process.env.GOOGLE_TTS_VOICE_EN || "en-US-Neural2-C";
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      input: { text: text.slice(0, 800) },
      voice: { languageCode: lang === "ja" ? "ja-JP" : "en-US", name: voice },
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
    }),
  });
  if (!res.ok) throw new Error(`Google Cloud TTS ${res.status}`);
  const body = (await res.json()) as { audioContent?: string };
  if (!body.audioContent) throw new Error("Google Cloud TTS returned no audio");
  const audio = Buffer.from(body.audioContent, "base64");
  if (audio.length < 400) throw new Error("Google Cloud TTS returned an empty clip");
  return audio;
}

async function gttsSpeak(text: string, lang: SpeechLang): Promise<Buffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text.slice(0, 180))}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google Translate speech ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 400) throw new Error("Google Translate speech returned an empty clip");
  return audio;
}

const EDGE_COOLDOWN_MS = 10 * 60_000;
let edgeUnavailableUntil = 0;
let edgeFailureStreak = 0;

function edgeCoolingDown(): boolean {
  return Date.now() < edgeUnavailableUntil;
}

function noteEdgeSuccess(): void {
  edgeFailureStreak = 0;
}

function noteEdgeFailure(): void {
  edgeFailureStreak += 1;
  if (edgeFailureStreak >= 2) edgeUnavailableUntil = Date.now() + EDGE_COOLDOWN_MS;
}

async function edgeVoiceOnce(text: string, voice: string): Promise<Buffer> {
  return locks.ja.run(async () => {
    let engine = jaVoices.get(voice);
    if (!engine) {
      engine = new MsEdgeTTS();
      await engine.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      jaVoices.set(voice, engine);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        dropJaVoice(voice);
        reject(new Error("Edge TTS timed out"));
      }, 15_000);
    });
    const speech = speakWith(engine, text, false);
    speech.catch(() => undefined);
    try {
      return await Promise.race([speech, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}

/** One Japanese line. Edge is tried first, then OpenAI, Google Cloud, and Google Translate. */
export async function speakJapanese(text: string, voice: string): Promise<{ audio: Buffer; engine: SpeechEngine }> {
  let edgeError: Error | null = null;
  const skipEdge = edgeCoolingDown();
  for (let attempt = 0; attempt < 3 && !skipEdge; attempt++) {
    try {
      const audio = await edgeVoiceOnce(text, voice);
      noteEdgeSuccess();
      return { audio, engine: "edge" };
    } catch (error) {
      edgeError = error instanceof Error ? error : new Error("Edge TTS failed");
      dropJaVoice(voice);
      if (attempt < 2) await sleep(500 * (attempt + 1));
    }
  }
  if (edgeError) noteEdgeFailure();
  const tried = ["Microsoft Edge"];
  if (process.env.OPENAI_API_KEY) {
    tried.push("OpenAI");
    try {
      return { audio: await openAiSpeak(text, "Read this Japanese dialogue naturally."), engine: "openai" };
    } catch (error) {
      console.error("OpenAI speech failed", error);
    }
  }
  if (googleTtsKey()) {
    tried.push("Google Cloud");
    try {
      return { audio: await googleCloudSpeak(text, "ja"), engine: "google" };
    } catch (error) {
      console.error("Google Cloud speech failed", error);
    }
  }
  tried.push("Google Translate");
  try {
    return { audio: await gttsSpeak(text, "ja"), engine: "gtts" };
  } catch (error) {
    console.error("Google Translate speech failed", error);
  }
  const edgeDetail = edgeError?.message.includes("empty") ? " Edge returned an empty clip." : "";
  throw new Error(`No speech engine could read this line.${edgeDetail} Tried ${tried.join(", ")}.`);
}

async function openAiSpeak(text: string, instructions?: string): Promise<Buffer> {
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
      ...(instructions ? { instructions } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 400) throw new Error("OpenAI TTS returned an empty clip");
  return audio;
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
