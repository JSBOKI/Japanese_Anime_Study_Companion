# Yomu

Yomu builds Japanese reading lessons from the shows you watch. Give it a series and a subtitle file for an episode. It turns the dialogue into vocabulary, grammar notes, flashcards, and an MP3 you can listen to on the train.

It is a single-user app. There is no account system.

## Run it

You need Node.js 20 or newer and `ffmpeg` (the dialogue drill stitches MP3 clips together).

```bash
npm install
npm start
```

Open http://localhost:3000.

The first start downloads a public Japanese-English dictionary (JMdict common words), KANJIDIC, and JLPT word lists into `data/dict/`. That needs network access once. After that, the files stay on disk.

### Try the sample

`sample/episode-01-morning-platform.ja.srt` and `sample/episode-02-after-work.ja.srt` are original dialogue, not lines from a broadcast show.

1. Choose **Add a series** and enter a title, or choose **Try the sample scene** on the home page.
2. On the series page, upload `sample/episode-01-morning-platform.ja.srt`.
3. Open the lesson. You get new words with readings and JLPT tags, grammar that actually shows up in the lines, and the dialogue with furigana and tap-for-meaning.
4. Open **Review** and grade a card.
5. On the lesson page, wait for the dialogue drill. Play it in the browser or download the MP3.

Upload episode 2 after episode 1 and the second lesson will not teach the same words and grammar again as if they were new.

You can also upload `.ass`, `.ssa`, `.vtt`, or a `.zip` of those files. Shift-JIS subtitles are decoded automatically. A number in the filename (`episode 01`, `E02`, `第3話`) chooses the episode.

## What works with no API keys

| Piece | Without keys |
| --- | --- |
| AniList search (title, episode count, cover) | Yes. The AniList API is public. |
| Manual series entry for live-action TV | Yes. |
| Subtitle upload | Yes. |
| Word readings, dictionary forms, English glosses | Yes. Kuromoji plus JMdict. |
| Kanji meanings on vocabulary | Yes. KANJIDIC. |
| JLPT tags | Yes, from public JLPT lists. |
| Grammar notes | Yes. Built-in explanations for patterns that appear in the episode. |
| Line English | A word-by-word gloss. A natural translation needs an LLM key. |
| Flashcards and FSRS review | Yes. Progress is stored in SQLite. |
| Anki export | Yes. CSV and `.apkg`. |
| Dialogue and vocabulary MP3s, and per-line playback | Yes. Microsoft Edge neural voices, no key. Needs network at playback-generation time, and `ffmpeg`. |
| Jimaku subtitle search | No. Needs `JIMAKU_API_KEY`. |

## Optional environment variables

Copy `.env.example` to `.env`.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default `3000`. |
| `HOST` | Bind address. Default `0.0.0.0`. |
| `DATA_DIR` | Database, dictionary cache, and MP3s. Default `./data`. |
| `LLM_PROVIDER` | `none`, `openai`, or `anthropic`. Unset: a present API key turns that provider on. `none` keeps the built-in lessons even if a key exists. |
| `OPENAI_API_KEY` | OpenAI key for translations and, if selected, speech. |
| `OPENAI_MODEL` | Chat model. Default `gpt-4o-mini`. |
| `ANTHROPIC_API_KEY` | Anthropic key for translations. |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-4-5`. |
| `TTS_PROVIDER` | `edge` (default), `openai`, or `voicevox`. |
| `TTS_VOICE_JA` | Edge Japanese voice. Default `ja-JP-NanamiNeural`. |
| `TTS_VOICE_EN` | Edge English voice. Default `en-US-JennyNeural`. |
| `OPENAI_TTS_MODEL` | Default `gpt-4o-mini-tts`. |
| `OPENAI_TTS_VOICE` | Default `nova`. |
| `VOICEVOX_URL` | Default `http://127.0.0.1:50021`. |
| `VOICEVOX_SPEAKER` | Default `2` (四国めたん on a normal VOICEVOX install). English lines still use Edge. |
| `JIMAKU_API_KEY` | Personal key from [jimaku.cc](https://jimaku.cc). Sent as the `Authorization` header. |

With an LLM configured, each lesson adds a natural English line under the dialogue and one short note on how each grammar point shows up in that episode. The built-in explanation stays either way. If the model call fails, the dictionary lesson is kept.

## Tests

```bash
npm test
```

## Deploying later

One Node process serves the API and the built page.

```bash
npm install --include=dev
npm run build
NODE_ENV=production npm start
```

`npm install` on its own is enough when `NODE_ENV` is not `production`. A host that installs with `NODE_ENV=production` skips the Vite build tools, so include dev dependencies for the build step. `tsx` is a normal dependency because the server runs TypeScript directly.

The host needs:

- Node.js 20+
- `ffmpeg` on `PATH`
- A persistent disk mounted at `DATA_DIR` (SQLite database, generated MP3s, dictionary cache)
- Outbound HTTPS for the first dictionary download, AniList, and Edge TTS
- Optional API keys, as above

Put a reverse proxy in front if it is reachable from the internet. There is no login. Do not expose it publicly without something else in front of it.

There is no bundled copyrighted subtitle. Users supply their own files, or fetch them from Jimaku with their own key.

## Sources

- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) (CC BY-SA 4.0)
- JLPT word lists from [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)
- [AniList](https://anilist.co) GraphQL API
- [Kuromoji](https://github.com/takuyaa/kuromoji.js) for segmentation and readings
- [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) for review scheduling
- Microsoft Edge neural voices through `msedge-tts`
