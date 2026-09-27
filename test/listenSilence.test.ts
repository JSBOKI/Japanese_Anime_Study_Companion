import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { silenceTightenFilter } from "../src/server/listenPlan.ts";

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`));
    });
  });
}

function duration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const seconds = Number(out.trim());
      if (code === 0 && Number.isFinite(seconds)) resolve(seconds);
      else reject(new Error("Could not read audio length"));
    });
  });
}

test("a long quiet stretch is shortened and speech is not left at the end of the clip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yomu-silence-"));
  try {
    const lead = path.join(dir, "lead.mp3");
    const tone = path.join(dir, "tone.mp3");
    const gap = path.join(dir, "gap.mp3");
    const joined = path.join(dir, "joined.mp3");
    const tight = path.join(dir, "tight.mp3");
    const encode = ["-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k"];
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000:d=3", ...encode, lead]);
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:d=0.45", ...encode, tone]);
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000:d=4", ...encode, gap]);
    const list = path.join(dir, "list.txt");
    await fs.writeFile(list, `file '${lead}'\nfile '${tone}'\nfile '${gap}'\nfile '${tone}'\n`);
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", joined, "-af", silenceTightenFilter(), ...encode, tight]);
    const seconds = await duration(tight);
    assert.ok(seconds < 4, `tightened audio was still ${seconds}s`);
    assert.ok(seconds > 1, `tightened audio was only ${seconds}s`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the service worker lets iPhone range requests reach the server", async () => {
  const source = await fs.readFile(new URL("../src/client/public/sw.js", import.meta.url), "utf8");
  assert.match(source, /request\.headers\.get\("range"\)/);
  assert.match(source, /navigator\.onLine\) return/);
});
