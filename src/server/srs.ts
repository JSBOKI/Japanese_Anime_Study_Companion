import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";

const scheduler = fsrs();

export type StoredCard = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export function emptyStoredCard(now = new Date()): StoredCard {
  return toStored(createEmptyCard(now));
}

export function toStored(card: Card): StoredCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

export function fromStored(row: StoredCard): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function reviewCard(card: Card, rating: number, now = new Date()): Card {
  if (rating < 1 || rating > 4) throw new Error("Rating must be 1 to 4");
  return scheduler.next(card, now, rating as Grade).card;
}

export function intervalLabels(card: Card, now = new Date()): { again: string; hard: string; good: string; easy: string } {
  const preview = scheduler.repeat(card, now);
  return {
    again: formatInterval(preview[Rating.Again].card.due, now),
    hard: formatInterval(preview[Rating.Hard].card.due, now),
    good: formatInterval(preview[Rating.Good].card.due, now),
    easy: formatInterval(preview[Rating.Easy].card.due, now),
  };
}

export function formatInterval(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  if (ms < 45_000) return "<1m";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = ms / 3_600_000;
  if (hours < 20) return `${Math.round(hours)}h`;
  const days = ms / 86_400_000;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30.44;
  if (months < 18) return `${Math.round(months)}mo`;
  return `${Math.round(days / 365)}y`;
}
