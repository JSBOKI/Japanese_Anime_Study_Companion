export type CatalogWork = {
  cardId: number;
  personId: number | null;
  title: string;
  titleKana: string | null;
  author: string;
  orthography: string | null;
  sourceUrl: string;
  textUrl: string | null;
  xhtmlUrl: string | null;
};

export type RecommendedWork = CatalogWork & {
  difficulty: string;
  lengthLabel: string;
  summary: string;
  /** Shown on the shelf as a suggested place to begin. */
  startHere?: boolean;
};

function card(url: string): string {
  return url;
}

/**
 * New-kana public-domain editions, easiest first.
 * Card ids were checked against the Aozora extended catalog.
 */
export const RECOMMENDED: RecommendedWork[] = [
  {
    cardId: 637,
    personId: 121,
    title: "手袋を買いに",
    titleKana: "てぶくろをかいに",
    author: "新美南吉",
    orthography: "新字新仮名",
    difficulty: "N4",
    lengthLabel: "Very short",
    summary: "A mother fox sends her child to town to buy gloves. The easiest book on this shelf.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000121/card637.html",
    textUrl: "https://www.aozora.gr.jp/cards/000121/files/637_ruby_4095.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000121/files/637_13341.html",
  },
  {
    cardId: 628,
    personId: 121,
    title: "ごん狐",
    titleKana: "ごんぎつね",
    author: "新美南吉",
    orthography: "新字新仮名",
    difficulty: "N3",
    lengthLabel: "Short",
    summary: "Gon the fox tries to make up for a prank, and the villager never understands in time. A school story.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000121/card628.html",
    textUrl: "https://www.aozora.gr.jp/cards/000121/files/628_ruby_649.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000121/files/628_14895.html",
  },
  {
    cardId: 43754,
    personId: 81,
    title: "注文の多い料理店",
    titleKana: "ちゅうもんのおおいりょうりてん",
    author: "宮沢賢治",
    orthography: "新字新仮名",
    difficulty: "N3",
    lengthLabel: "Short",
    summary: "Two hunters walk into a restaurant whose rules get stranger with every door. A children's story with a sharp joke.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000081/card43754.html",
    textUrl: "https://www.aozora.gr.jp/cards/000081/files/43754_ruby_17594.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000081/files/43754_17659.html",
  },
  {
    cardId: 92,
    personId: 879,
    title: "蜘蛛の糸",
    titleKana: "くものいと",
    author: "芥川竜之介",
    orthography: "新字新仮名",
    difficulty: "N3",
    lengthLabel: "Very short",
    summary: "The Buddha lowers a spider's thread into hell for one sinner. A few pages.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000879/card92.html",
    textUrl: "https://www.aozora.gr.jp/cards/000879/files/92_ruby_164.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000879/files/92_14545.html",
  },
  {
    cardId: 1567,
    personId: 35,
    title: "走れメロス",
    titleKana: "はしれメロス",
    author: "太宰治",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Short",
    summary: "Suggested starting point. Melos runs back to the city before his friend is executed. Direct sentences and a famous ending.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000035/card1567.html",
    textUrl: "https://www.aozora.gr.jp/cards/000035/files/1567_ruby_4948.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000035/files/1567_14913.html",
    startHere: true,
  },
  {
    cardId: 799,
    personId: 148,
    title: "夢十夜",
    titleKana: "ゆめじゅうや",
    author: "夏目漱石",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Ten short pieces",
    summary: "Suggested starting point if you want short pieces. Ten dreams. The first night is the one people quote.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000148/card799.html",
    textUrl: "https://www.aozora.gr.jp/cards/000148/files/799_ruby_6024.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000148/files/799_14972.html",
    startHere: true,
  },
  {
    cardId: 127,
    personId: 879,
    title: "羅生門",
    titleKana: "らしょうもん",
    author: "芥川竜之介",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Short",
    summary: "A servant waits under Rashomon gate and meets a woman stripping corpses. Short, but the sentences are dense.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000879/card127.html",
    textUrl: "https://www.aozora.gr.jp/cards/000879/files/127_ruby_150.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000879/files/127_15260.html",
  },
  {
    cardId: 42,
    personId: 879,
    title: "鼻",
    titleKana: "はな",
    author: "芥川竜之介",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Short",
    summary: "A priest cannot leave his famous long nose alone. Short comic prose, still N2 in the vocabulary.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000879/card42.html",
    textUrl: "https://www.aozora.gr.jp/cards/000879/files/42_ruby_154.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000879/files/42_15228.html",
  },
  {
    cardId: 57228,
    personId: 1779,
    title: "怪人二十面相",
    titleKana: "かいじんにじゅうめんそう",
    author: "江戸川乱歩",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Long",
    summary: "The Boy Detectives chase the thief of twenty faces. A long mystery in plain story Japanese.",
    sourceUrl: "https://www.aozora.gr.jp/cards/001779/card57228.html",
    textUrl: "https://www.aozora.gr.jp/cards/001779/files/57228_ruby_58697.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/001779/files/57228_58735.html",
  },
  {
    cardId: 752,
    personId: 148,
    title: "坊っちゃん",
    titleKana: "ぼっちゃん",
    author: "夏目漱石",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Novel",
    summary: "A blunt young teacher is posted to a country school. Spoken, funny, and long.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000148/card752.html",
    textUrl: "https://www.aozora.gr.jp/cards/000148/files/752_ruby_2438.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000148/files/752_14964.html",
  },
  {
    cardId: 456,
    personId: 81,
    title: "銀河鉄道の夜",
    titleKana: "ぎんがてつどうのよる",
    author: "宮沢賢治",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Novella",
    summary: "Giovanni rides a night train through the stars with Campanella. The grammar is not the hard part; the images are.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000081/card456.html",
    textUrl: "https://www.aozora.gr.jp/cards/000081/files/456_ruby_145.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000081/files/456_15050.html",
  },
  {
    cardId: 773,
    personId: 148,
    title: "こころ",
    titleKana: "こころ",
    author: "夏目漱石",
    orthography: "新字新仮名",
    difficulty: "N2",
    lengthLabel: "Novel",
    summary: "A student remembers his friend, called Sensei, and the confession that follows. Long and psychological.",
    sourceUrl: card("https://www.aozora.gr.jp/cards/000148/card773.html"),
    textUrl: "https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000148/files/773_14560.html",
  },
  {
    cardId: 424,
    personId: 74,
    title: "檸檬",
    titleKana: "れもん",
    author: "梶井基次郎",
    orthography: "新字新仮名",
    difficulty: "N1",
    lengthLabel: "Short",
    summary: "A sick young man carries a lemon through Kyoto. Short, but the sentences are modernist and the hardest one here.",
    sourceUrl: "https://www.aozora.gr.jp/cards/000074/card424.html",
    textUrl: "https://www.aozora.gr.jp/cards/000074/files/424_ruby_19825.zip",
    xhtmlUrl: "https://www.aozora.gr.jp/cards/000074/files/424_19826.html",
  },
];

export function recommendedByCard(cardId: number): RecommendedWork | null {
  return RECOMMENDED.find((work) => work.cardId === cardId) || null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function orthoScore(value: string | null): number {
  if (value === "新字新仮名") return 3;
  if (value === "新字旧仮名") return 2;
  if (value === "旧字新仮名") return 1;
  return 0;
}

export function lengthLabelFor(charCount: number): string {
  if (charCount < 4000) return "Very short";
  if (charCount < 15000) return "Short";
  if (charCount < 40000) return "Novella";
  return "Novel";
}

function fold(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

export function searchCatalog(csv: string, query: string, limit = 20): CatalogWork[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const idCol = col("作品ID");
  const titleCol = col("作品名");
  const kanaCol = col("作品名読み");
  const orthoCol = col("文字遣い種別");
  const copyCol = col("作品著作権フラグ");
  const personCol = col("人物ID");
  const seiCol = col("姓");
  const meiCol = col("名");
  const roleCol = col("役割フラグ");
  const cardCol = col("図書カードURL");
  const textCol = col("テキストファイルURL");
  const htmlCol = col("XHTML/HTMLファイルURL");
  if (idCol < 0 || titleCol < 0) return [];
  const best = new Map<number, CatalogWork>();
  for (const row of rows.slice(1)) {
    if ((row[copyCol] || "") !== "なし") continue;
    if ((row[roleCol] || "") !== "著者") continue;
    const cardId = Number(row[idCol]);
    if (!Number.isInteger(cardId) || cardId <= 0) continue;
    const title = (row[titleCol] || "").trim();
    const titleKana = (row[kanaCol] || "").trim() || null;
    const author = `${row[seiCol] || ""}${row[meiCol] || ""}`.trim();
    const hay = fold(`${title} ${titleKana || ""} ${author}`);
    if (!hay.includes(needle)) continue;
    const textUrl = (row[textCol] || "").trim() || null;
    const xhtmlUrl = (row[htmlCol] || "").trim() || null;
    if (!textUrl && !xhtmlUrl) continue;
    const work: CatalogWork = {
      cardId,
      personId: Number(row[personCol]) || null,
      title,
      titleKana,
      author: author || "著者不明",
      orthography: (row[orthoCol] || "").trim() || null,
      sourceUrl: (row[cardCol] || "").trim() || `https://www.aozora.gr.jp/cards/`,
      textUrl,
      xhtmlUrl,
    };
    const current = best.get(cardId);
    if (!current || orthoScore(work.orthography) > orthoScore(current.orthography)) best.set(cardId, work);
  }
  return [...best.values()]
    .sort((a, b) => orthoScore(b.orthography) - orthoScore(a.orthography) || a.title.length - b.title.length)
    .slice(0, limit);
}

export function findInCatalog(csv: string, cardId: number): CatalogWork | null {
  const rows = parseCsv(csv);
  if (!rows.length) return null;
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const idCol = col("作品ID");
  let best: CatalogWork | null = null;
  for (const row of rows.slice(1)) {
    if (Number(row[idCol]) !== cardId) continue;
    if ((row[col("作品著作権フラグ")] || "") !== "なし") continue;
    if ((row[col("役割フラグ")] || "") !== "著者") continue;
    const work: CatalogWork = {
      cardId,
      personId: Number(row[col("人物ID")]) || null,
      title: (row[col("作品名")] || "").trim(),
      titleKana: (row[col("作品名読み")] || "").trim() || null,
      author: `${row[col("姓")] || ""}${row[col("名")] || ""}`.trim() || "著者不明",
      orthography: (row[col("文字遣い種別")] || "").trim() || null,
      sourceUrl: (row[col("図書カードURL")] || "").trim(),
      textUrl: (row[col("テキストファイルURL")] || "").trim() || null,
      xhtmlUrl: (row[col("XHTML/HTMLファイルURL")] || "").trim() || null,
    };
    if (!best || orthoScore(work.orthography) > orthoScore(best.orthography)) best = work;
  }
  return best;
}
