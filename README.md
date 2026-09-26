# Yomu

Yomu builds Japanese reading lessons from the shows you watch. Give it a series and a subtitle file for an episode. It turns the dialogue into vocabulary, grammar notes, flashcards, and an MP3 you can listen to on the train.

It is a single-user app. Leave it open on your own machine, or set `APP_PASSWORD` before anyone else can reach it.

## Run it

You need Node.js 20 or newer and `ffmpeg` (the dialogue drill stitches MP3 clips together).

```bash
npm install
npm start
```

Open http://localhost:3000.

The first start downloads a public Japanese-English dictionary (JMdict common words), KANJIDIC, and JLPT word lists into `data/dict/`. That needs network access once. After that, the files stay on disk.

### Try the sample

`sample/episode-01-morning-platform.ja.srt` and `sample/episode-02-after-work.ja.srt` are short original scenes. `sample/episode-03-late-office.ja.srt` is a longer original office scene, written for an N2 reading: several hundred characters in a row, with N2 and N1 words and spoken contractions. None of them are lines from a broadcast show.

1. Choose **Add a series** and enter a title, or choose **Try the sample scene** on the home page.
2. On the series page, upload `sample/episode-01-morning-platform.ja.srt`.
3. Open the lesson. You get new words with readings and JLPT tags, grammar that actually shows up in the lines, and the dialogue with furigana and tap-for-meaning.
4. Open **Review** and grade a card.
5. On the lesson page, wait for the dialogue drill. Play it in the browser or download the MP3.

Upload episode 2 after episode 1 and the second lesson will not teach the same words and grammar again as if they were new.

## Level

The default is **N2**. Open **Level** from the chip in the header, or from the level button on a lesson.

- **N5–N1** chooses which vocabulary and grammar are taught. Words and patterns easier than that band are left out of the lesson, the flashcards, and the audio drills. Cards you already reviewed stay in the database; they simply stop appearing in Review while your level is above them.
- **Scene** groups the subtitles into a contiguous stretch of a few hundred characters. **Longer** keeps going, aiming past about nine hundred characters when the episode has that much dialogue.
- **Furigana** can follow the level (readings only on kanji harder than your band), cover every kanji, or stay off. Tap a word either way.
- At **N3, N2, and N1**, English on the passage stays hidden until you tap **English**. N5 and N4 leave it open.

Changing the level does not rewrite lessons by itself. On the lesson, choose **Rebuild this lesson** when the banner says the reading was built at another level. On the Level page, **Rebuild every lesson** does the same for each uploaded subtitle, in episode order. Review history on the cards is kept. The dialogue MP3 is generated again.

No new environment variable controls this. The choice is stored in SQLite on the data volume. `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, already optional, replaces the built-in Japanese reading guide with a prose recap at the chosen level. Without a key, the guide is composed from the episode itself.

You can also upload `.ass`, `.ssa`, `.vtt`, or a `.zip` of those files. Shift-JIS subtitles are decoded automatically. A number in the filename (`episode 01`, `E02`, `第3話`) chooses the episode. On an iPhone, the file button opens Files and does not hide subtitles the picker does not recognize.

## On an iPhone

Yomu is a progressive web app. In Safari, open Share and choose **Add to Home Screen**. It installs with its own icon, opens full screen (no Safari toolbar), and pads itself clear of the notch and the home indicator.

From a lesson you can:

- Tap any word. The meaning sits in a sheet above the tab bar, so it stays on screen.
- Play a line or a drill. The lock screen shows the title, and playback continues with the screen locked where iOS allows it for an installed web app.
- Tap **Save for offline**. That stores the lesson and both MP3s on the phone. The home page lists them under **On this phone**, and they still open on the subway.

The service worker is registered in the production build (`npm run build`, or the Docker image). `npm start` in development does not install it.

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
| Daily NHK news, Japanese reading, and Japanese audio | Yes. The fetch and the first listen need network. |
| English news text | A matching NHK World-Japan article or its public summary, clearly labeled. A translation of the Japanese article needs an LLM key. If neither exists, the page says English is unavailable. |
| Automatic Japanese subtitles | Yes. Kitsunekko, no key. Jimaku is added when `JIMAKU_API_KEY` is set. |
| Manual Jimaku search | No. Needs `JIMAKU_API_KEY`. |
| Password gate | Off until `APP_PASSWORD` is set. |

## Optional environment variables

Copy `.env.example` to `.env`.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default `3000`. Render and other hosts set this; the server uses it. |
| `HOST` | Bind address. Default `0.0.0.0`. |
| `DATA_DIR` | Database, dictionary cache, and MP3s. Default `./data`. In Docker this is `/data`. |
| `APP_PASSWORD` | If set, every API route except health and sign-in asks for this password. The cookie lasts 180 days. If unset, the app stays open, which is what you want on localhost. |
| `COOKIE_SECURE` | Optional. `true` always marks the cookie Secure. `false` never does. Unset: Secure only when the request is HTTPS, including `X-Forwarded-Proto: https` from a reverse proxy. |
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
| `JIMAKU_API_KEY` | Optional. Personal key from [jimaku.cc](https://jimaku.cc), sent as the `Authorization` header. Automatic fetch works without it. |
| `NEWS_FETCH_HOUR` | Optional. Hour in Asia/Tokyo for the daily news fetch. Default `6`. Invalid values use 6. |
| `NEWS_RSS_URL` | Optional. Overrides the NHK main RSS URL. When the URL contains `cat0.xml`, category feeds are derived from it. Unset uses the public NHK feeds. |

## Daily news

The **News** tab loads a handful of current NHK stories, about five to eight a day. The server fetches them around 6:00 Asia/Tokyo, and also the first time you open News on a Tokyo day that has not been fetched yet. **Refresh** fetches again immediately. That day's list is the batch from the fetch, including stories NHK filed overnight. Stories are stored in the same SQLite file on the data disk, and about thirty days stay browsable. If NHK is down, the page says so and anything already saved stays put.

Open a story and use **JA / EN** at the top, or **Read JA**, **Read EN**, **Listen JA**, and **Listen EN**.

- Japanese reading uses your saved level (N2 unless you changed it): furigana on kanji above that level, tap-for-meaning, and grammar notes for N3–N1 patterns. At N3 and above, the English under the passage stays hidden until you tap it. **Add words to flashcards** puts new words on the same FSRS queue as episode lessons, and skips words you already have a card for.
- English is a real translation only when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set. With no key, Yomu looks for a matching NHK World-Japan English article and labels it as a separate English report, or as the public feed summary when the full page is missing. If nothing matches, English mode says that no English text is available. It does not invent a headline or a translation.
- Listening uses the same Edge voices as the dialogue drills (`ja-JP-NanamiNeural` and `en-US-JennyNeural` unless you changed them). The MP3 is created the first time you press play, then reused. Speed is 0.75x, 1x, or 1.25x. **Save for offline** keeps the story and the audio that exists.

No new variable is required. The current Render service keeps working with the env vars it already has.

With an LLM configured, each lesson adds a natural English line under the dialogue, one short note on how each grammar point shows up in that episode, and a Japanese prose recap of the scene at your level. The built-in explanation stays either way. If the model call fails, the dictionary lesson is kept, including the composed reading guide.

## Tests

```bash
npm test
```

## Deploying

One Node process serves the API and the built page. It listens on `PORT` (default 3000) and `HOST` (default `0.0.0.0`), and it trusts one reverse-proxy hop so HTTPS cookies work behind Render, Fly, or any proxy that sets `X-Forwarded-Proto`.

The process needs about 1 GB of RAM after the dictionaries load. A 512 MB instance will be killed on boot.

Set `APP_PASSWORD` to something long before the URL is public. Without it, anyone who can open the site can read and change the library.

There is no bundled copyrighted subtitle. On a series page, **Get subtitles automatically** downloads a Japanese set for that show: Jimaku when `JIMAKU_API_KEY` is set (matched by AniList id), and [Kitsunekko’s Japanese subtitle directory](https://kitsunekko.net/dirlist.php?dir=subtitles/japanese/) either way. A zip is unpacked in the app. Rar archives are skipped. A `.7z` pack is used only when the `7z` command is installed and no better zip is available. English and Chinese files are skipped, TV episode numbers are preferred, and one release group is kept when several are listed. Episodes that already have a subtitle are skipped. Lessons are built one episode at a time, in episode order, and the page shows how many are ready. Dialogue audio is still made when a lesson is opened, so a long series does not queue hundreds of speech jobs. You can still upload your own `.srt`, `.ass`, `.vtt`, or zip.

Dictionaries are downloaded while the Docker image builds and copied onto the data volume the first time the container starts. The volume must keep the SQLite file, generated MP3s, and those dictionaries across restarts.

### Docker on any host

```bash
docker build -t yomu .
docker volume create yomu-data
docker run -d --name yomu \
  -p 3000:3000 \
  -e APP_PASSWORD='choose-a-long-password' \
  -e DATA_DIR=/data \
  -v yomu-data:/data \
  yomu
```

The image includes `ffmpeg`. Outbound HTTPS is still required for AniList and for Edge TTS when a drill is generated. Open `http://localhost:3000`, sign in, and add the sample scene.

To build the page yourself without Docker:

```bash
npm install --include=dev
npm run build
NODE_ENV=production npm start
```

`npm install` on its own is enough when `NODE_ENV` is not `production`. A host that installs with `NODE_ENV=production` skips the Vite build tools, so include dev dependencies for the build step. `tsx` is a normal dependency because the server runs TypeScript directly.

### Render

`render.yaml` is a Docker web service with a 1 GB disk at `/data` and the health check at `/api/health`. The plan is Standard so the process has enough memory. Region is Singapore, the closest Render region to Tokyo.

1. Push this repo to GitHub.
2. In the Render dashboard, choose **New** → **Blueprint** and select the repo. Render reads `render.yaml`.
3. When it asks for `APP_PASSWORD`, paste a long password. That value is not committed.
4. Wait until the health check is green, then open the `onrender.com` URL on the iPhone, sign in, and use **Add to Home Screen**.

The disk keeps `yomu.db`, `dict/`, and `audio/` under `/data`. Deleting the service deletes the disk.

### Fly.io

`fly.toml` listens on port 3000, forces HTTPS, and mounts a volume at `/data`. The machine is 1 GB and stays running (`min_machines_running = 1`) so a drill is not cut off by a scale-to-zero stop. The primary region is `nrt` (Tokyo). Change `app` if that name is already taken.

```bash
fly apps create your-yomu-name
# edit fly.toml so app = "your-yomu-name"
fly volumes create yomu_data --region nrt --size 1
fly secrets set APP_PASSWORD='choose-a-long-password'
fly deploy
```

`fly deploy` builds the Dockerfile. The volume name `yomu_data` matches `fly.toml`. Open `https://your-yomu-name.fly.dev` from the phone.

## Sources

- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) (CC BY-SA 4.0)
- JLPT word lists from [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)
- [AniList](https://anilist.co) GraphQL API
- [Kuromoji](https://github.com/takuyaa/kuromoji.js) for segmentation and readings
- [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) for review scheduling
- Microsoft Edge neural voices through `msedge-tts`
- [NHK](https://www.nhk.or.jp/) public news RSS and article pages, and [NHK World-Japan](https://www3.nhk.or.jp/nhkworld/) English news, for the Daily news tab
