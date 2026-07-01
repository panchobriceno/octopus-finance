/**
 * fetch con el ID token de Firebase en el header (para los endpoints protegidos del server, F5).
 * Usa el token cacheado (getIdToken() se auto-refresca si está por vencer). Si el server igual
 * responde 401 (token vencido/rotado), reintenta UNA vez forzando refresh.
 */
import { auth } from "@/lib/firebase";

async function withAuthHeader(init: RequestInit, forceRefresh: boolean): Promise<RequestInit> {
  const token = await auth.currentUser?.getIdToken(forceRefresh);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, await withAuthHeader(init, false));
  if (res.status !== 401) return res;
  // 401 → token pudo vencer; un reintento con token fresco.
  return fetch(input, await withAuthHeader(init, true));
}
