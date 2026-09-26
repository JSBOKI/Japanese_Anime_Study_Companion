const KANJI = /[\u4e00-\u9fff]/;
const KATAKANA = /[\u30a1-\u30fa]/;

export function kataToHira(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function hasKanji(text: string): boolean {
  return KANJI.test(text);
}

export function hasKatakana(text: string): boolean {
  return KATAKANA.test(text);
}

export function isKanaWord(text: string): boolean {
  return /^[\u3040-\u30ffー]+$/.test(text);
}

export function kanjiChars(text: string): string[] {
  return [...text].filter((ch) => KANJI.test(ch));
}

export function xmlEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}
