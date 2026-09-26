import { createRequire } from "node:module";
import path from "node:path";
import { kataToHira } from "./kana.ts";

const require = createRequire(import.meta.url);

type KuromojiToken = {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  conjugated_form: string;
  basic_form: string;
  reading?: string;
};

type Tokenizer = {
  tokenize(text: string): KuromojiToken[];
};

export type Token = {
  surface: string;
  lemma: string;
  reading: string;
  pos: string;
  detail: string;
  conjugation: string;
};

let tokenizer: Tokenizer | null = null;
let loading: Promise<void> | null = null;

export function loadTokenizer(): Promise<void> {
  if (tokenizer) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const kuromoji = require("kuromoji") as {
        builder: (opts: { dicPath: string }) => { build: (cb: (err: Error | null, tokenizer: Tokenizer) => void) => void };
      };
      const pkg = path.dirname(require.resolve("kuromoji/package.json"));
      kuromoji.builder({ dicPath: path.join(pkg, "dict") }).build((err, built) => {
        if (err) {
          loading = null;
          reject(err);
          return;
        }
        tokenizer = built;
        resolve();
      });
    });
  }
  return loading;
}

export function tokenize(text: string): Token[] {
  if (!tokenizer) throw new Error("Tokenizer is not ready");
  return tokenizer.tokenize(text).map((token) => {
    const surface = token.surface_form;
    const lemma = !token.basic_form || token.basic_form === "*" ? surface : token.basic_form;
    const readingSource = token.reading && token.reading !== "*" ? token.reading : surface;
    return {
      surface,
      lemma,
      reading: kataToHira(readingSource),
      pos: token.pos,
      detail: token.pos_detail_1 || "",
      conjugation: token.conjugated_form && token.conjugated_form !== "*" ? token.conjugated_form : "",
    };
  });
}
