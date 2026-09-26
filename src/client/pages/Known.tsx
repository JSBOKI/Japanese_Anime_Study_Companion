import { useEffect, useState } from "react";
import { api } from "../api";
import type { KnownWord } from "../../shared/types";

export function KnownPage() {
  const [words, setWords] = useState<KnownWord[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<KnownWord[]>("/api/known").then(setWords).catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  async function forget(lemma: string) {
    await api("/api/known", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lemma }),
    });
    load();
  }

  const shown = (words || []).filter((word) => {
    const q = filter.trim();
    if (!q) return true;
    return word.lemma.includes(q) || (word.reading || "").includes(q);
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Known words</h1>
        <p>Words you mark as known are left out of future lessons. Cards you have already reviewed stay in the deck.</p>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      <label>
        Filter
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="電車" />
      </label>
      {words && words.length === 0 ? <p className="hint">No known words yet. Mark them from a lesson.</p> : null}
      <ul className="known-list">
        {shown.map((word) => (
          <li key={word.lemma}>
            <span lang="ja">{word.lemma}</span>
            <small lang="ja">{word.reading}</small>
            <button className="btn" type="button" onClick={() => forget(word.lemma)}>
              Put back
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
