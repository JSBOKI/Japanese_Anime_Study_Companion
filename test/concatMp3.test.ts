import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { concatMp3 } from "../src/server/newsAudio.ts";

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

test("joining more clips than one batch does not reuse an input as the output", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yomu-concat-test-"));
  try {
    const clips: string[] = [];
    for (let index = 0; index < 5; index++) {
      const file = path.join(dir, `clip-${index}.mp3`);
      await ffmpeg([
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
        "-t", "0.40",
        "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k",
        file,
      ]);
      clips.push(file);
    }
    const dest = path.join(dir, "joined.mp3");
    await concatMp3(clips, dest, 2);
    const seconds = await duration(dest);
    assert.ok(seconds > 1.5, `joined audio was ${seconds}s`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
