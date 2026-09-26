export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* response was not JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) return (await res.json()) as T;
  return undefined as T;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
