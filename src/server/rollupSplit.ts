export const ROLLUP_MAX_SECONDS = 30 * 60;
export const ROLLUP_MAX_BYTES = 12 * 1024 * 1024;

export type RollupClip = {
  id: string;
  seconds: number;
  bytes: number;
};

export type RollupSlice = {
  id: string;
  start: number;
  end: number;
  seconds: number;
  bytes: number;
  whole: boolean;
};

export type RollupPartPlan = {
  slices: RollupSlice[];
  seconds: number;
  bytes: number;
};

export function splitRollup(
  clips: RollupClip[],
  limits: { maxSeconds: number; maxBytes: number } = { maxSeconds: ROLLUP_MAX_SECONDS, maxBytes: ROLLUP_MAX_BYTES },
): RollupPartPlan[] {
  const slices = clips.flatMap((clip) => sliceClip(clip, limits));
  const parts: RollupPartPlan[] = [];
  let current: RollupSlice[] = [];
  let seconds = 0;
  let bytes = 0;
  const flush = () => {
    if (!current.length) return;
    parts.push({ slices: current, seconds, bytes });
    current = [];
    seconds = 0;
    bytes = 0;
  };
  for (const slice of slices) {
    const over = seconds + slice.seconds > limits.maxSeconds + 0.05 || bytes + slice.bytes > limits.maxBytes;
    if (current.length && over) flush();
    current.push(slice);
    seconds += slice.seconds;
    bytes += slice.bytes;
  }
  flush();
  return parts;
}

function sliceClip(clip: RollupClip, limits: { maxSeconds: number; maxBytes: number }): RollupSlice[] {
  const seconds = Math.max(0, clip.seconds);
  const bytes = Math.max(0, clip.bytes);
  if (seconds === 0 && bytes === 0) return [];
  const timeParts = seconds > 0 ? Math.ceil(seconds / limits.maxSeconds) : 1;
  const byteParts = bytes > 0 ? Math.ceil(bytes / limits.maxBytes) : 1;
  const parts = Math.max(1, timeParts, byteParts);
  const slices: RollupSlice[] = [];
  for (let index = 0; index < parts; index++) {
    const start = (seconds * index) / parts;
    const end = (seconds * (index + 1)) / parts;
    const share = index === parts - 1 ? bytes - Math.floor(bytes / parts) * (parts - 1) : Math.floor(bytes / parts);
    slices.push({ id: clip.id, start, end, seconds: end - start, bytes: share, whole: parts === 1 });
  }
  return slices;
}
