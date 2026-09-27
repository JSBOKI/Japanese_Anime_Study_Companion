import assert from "node:assert/strict";
import test from "node:test";
import iconv from "iconv-lite";
import { decodeAozora, parseAozoraText, parseRuby, speechCues, xhtmlToAozora } from "../src/server/aozoraParse.ts";

const SAMPLE = `
こころ
夏目漱石

-------------------------------------------------------
【テキスト中に現れる記号について】
※［＃「てへん＋劣」、第3水準1-84-77］
-------------------------------------------------------

［＃２字下げ］上　先生と私［＃「上　先生と私」は大見出し］

［＃５字下げ］一［＃「一」は中見出し］

　私《わたくし》はその人を常に先生と呼んでいた。一人｜麦藁帽《むぎわらぼう》を被っていた。
　二《に》、三日《さんち》を費やした。［＃改ページ］
　私は行った。［＃「私に」は底本では「私は」］次だ。

［＃５字下げ］二［＃「二」は中見出し］

　次の段だ。

底本：「こころ」集英社
入力：だれか
`;

test("ruby zip markup keeps furigana, drops notes, and splits Kokoro-style headings", () => {
  const chapters = parseAozoraText(SAMPLE);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].partTitle, "上 先生と私");
  assert.equal(chapters[0].title, "一");
  assert.equal(chapters[1].title, "二");
  assert.equal(chapters[1].partTitle, "上 先生と私");
  const first = chapters[0].paragraphs[0];
  assert.equal(first.text.startsWith("私はその人を常に先生と呼んでいた。"), true);
  assert.equal(first.speak.includes("わたくしはその人"), true);
  assert.equal(first.speak.includes("むぎわらぼう"), true);
  assert.equal(first.text.includes("麦藁帽"), true);
  assert.equal(first.speak.includes("私"), false);
  const second = chapters[0].paragraphs[1];
  assert.equal(second.speak.includes("に、さんち"), true);
  assert.equal(second.text.includes("改ページ"), false);
  assert.equal(chapters[0].paragraphs[2].text, "私は行った。次だ。");
  const blob = JSON.stringify(chapters);
  assert.equal(blob.includes("底本"), false);
  assert.equal(blob.includes("記号について"), false);
  assert.equal(blob.includes("てへん"), false);
});

test("a pipe is optional when the ruby covers the kanji run in front of it", () => {
  const parsed = parseRuby("頭文字《かしらもじ》は使わない。");
  assert.equal(parsed.text, "頭文字は使わない。");
  assert.equal(parsed.speak, "かしらもじは使わない。");
});

test("a work with no headings is split into reading-sized parts", () => {
  const paragraph = `${"あ".repeat(400)}。`;
  const short = "い。";
  const text = [paragraph, paragraph, paragraph, paragraph, paragraph, short].join("\n");
  const chapters = parseAozoraText(text);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "その1");
  assert.equal(chapters[0].paragraphs.length, 6);
});

test("longer unheaded text becomes more than one part", () => {
  const paragraph = `${"あ".repeat(500)}。`;
  const text = Array.from({ length: 8 }, () => paragraph).join("\n");
  const chapters = parseAozoraText(text);
  assert.ok(chapters.length >= 2);
  assert.equal(chapters[0].title, "その1");
  assert.equal(chapters[1].title, "その2");
});

test("block headings and Shift_JIS bytes decode", () => {
  const chapters = parseAozoraText("［＃大見出し］第一夜［＃大見出し終わり］\n\nある晩の事である。");
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "第一夜");
  assert.equal(chapters[0].paragraphs[0].text, "ある晩の事である。");
  const encoded = iconv.encode("私《わたくし》", "cp932");
  assert.equal(decodeAozora(encoded), "私《わたくし》");
});

test("speech cues use the furigana reading and split on sentences", () => {
  const chapters = parseAozoraText("［＃中見出し］一［＃中見出し終わり］\n\n私《わたくし》は行った。先生も行った。");
  const cues = speechCues(chapters[0].paragraphs);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].speak, "わたくしは行った。");
  assert.equal(cues[0].text, "私は行った。");
  assert.equal(cues[1].text, "先生も行った。");
});

test("XHTML ruby and headings become the same chapters", () => {
  const html = `
    <div class="main_text">
      <h3 class="o-midashi"><a class="midashi_anchor" id="m">上　先生と私</a></h3>
      <h4 class="naka-midashi"><a id="n">一</a></h4>
      <p>　<ruby><rb>私</rb><rp>（</rp><rt>わたくし</rt><rp>）</rp></ruby>はその人を常に先生と呼んでいた。</p>
      <span class="notes">［＃「私に」は底本では「私は」］</span>
    </div>
    <div class="bibliographical_information"><p>底本：こころ</p></div>
  `;
  const chapters = parseAozoraText(xhtmlToAozora(html));
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].partTitle, "上 先生と私");
  assert.equal(chapters[0].title, "一");
  assert.equal(chapters[0].paragraphs[0].speak.startsWith("わたくしはその人"), true);
  assert.equal(JSON.stringify(chapters).includes("底本"), false);
});
