const SHELL = "yomu-shell-v1";
const OFFLINE = "yomu-offline-v1";
const KEY = "yomu-offline-episodes";

export type OfflineEpisode = {
  id: number;
  number: number;
  title: string | null;
  seriesTitle: string;
  savedAt: string;
};

export function listOffline(): OfflineEpisode[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as OfflineEpisode[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isOfflineSaved(id: number): boolean {
  return listOffline().some((item) => item.id === id);
}

function remember(item: OfflineEpisode): void {
  const rest = listOffline().filter((entry) => entry.id !== item.id);
  localStorage.setItem(KEY, JSON.stringify([item, ...rest]));
}

export async function saveEpisodeOffline(item: Omit<OfflineEpisode, "savedAt">): Promise<void> {
  if (!("caches" in window)) {
    throw new Error("This browser cannot keep lessons for offline listening.");
  }
  const offline = await caches.open(OFFLINE);
  const urls = [
    `/api/episodes/${item.id}`,
    `/api/episodes/${item.id}/audio/dialogue`,
    `/api/episodes/${item.id}/audio/vocab`,
  ];
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Wait until the audio is ready, then save." : "Could not save that episode.");
    }
    await offline.put(url, response);
  }
  const shell = await caches.open(SHELL);
  await shell.add("/").catch(() => undefined);
  await shell.add("/manifest.webmanifest").catch(() => undefined);
  const resources = performance.getEntriesByType("resource");
  await Promise.all(
    resources.map(async (entry) => {
      const url = new URL(entry.name);
      if (url.origin !== location.origin) return;
      if (!url.pathname.startsWith("/assets/") && !url.pathname.startsWith("/icons/")) return;
      await shell.add(url.pathname).catch(() => undefined);
    }),
  );
  remember({ ...item, savedAt: new Date().toISOString() });
}
