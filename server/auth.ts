/**
 * F5 — protección de los endpoints de IA (queman ANTHROPIC_API_KEY).
 *
 * requireAuth: verifica el ID token de Firebase (Authorization: Bearer <token>) con firebase-admin
 * (init solo con projectId, sin service account — verifyIdToken usa las claves públicas de Google)
 * y exige que el uid esté en la allowlist. Modelo de amenaza: nadie SIN cuenta autorizada puede
 * gastar créditos. El signup de Firebase podría estar abierto, así que verificar "una cuenta" NO
 * alcanza — la allowlist ata el acceso al dueño (override por env ALLOWED_FIREBASE_UIDS).
 *
 * rateLimit: limiter fijo en memoria (sin dependencia externa; escala 1 usuario). Pre-auth por IP
 * (frena floods antes de verificar JWT) + post-auth por uid.
 */
import type { Request, Response, NextFunction } from "express";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId =
  process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "my-cash-flow-bcb24";
if (!getApps().length) initializeApp({ projectId });

// Dueño (francisco@octopusmedia.cl). Los uids no son secretos. Override/ampliar con env.
const OWNER_UID = "AKgiLAeRImfeGKg1N18MxmgV28q2";
const ALLOWED_UIDS = new Set(
  (process.env.ALLOWED_FIREBASE_UIDS || OWNER_UID).split(",").map((s) => s.trim()).filter(Boolean),
);

export interface AuthedRequest extends Request {
  user?: { uid: string; email?: string };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "No autorizado." });
  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!ALLOWED_UIDS.has(decoded.uid)) {
      // Red de seguridad: si un token VÁLIDO no está en la allowlist, dejar el uid en el log del
      // server (no en la respuesta) para poder agregarlo a ALLOWED_FIREBASE_UIDS si es legítimo.
      console.warn(`[auth] uid fuera de la allowlist: ${decoded.uid} (${decoded.email ?? "sin email"})`);
      return res.status(403).json({ error: "Cuenta no autorizada." });
    }
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

/** Limiter fijo en memoria. keyOf define el eje (IP pre-auth, uid post-auth). */
function makeLimiter(windowMs: number, limit: number, keyOf: (req: AuthedRequest) => string) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const now = Date.now();
    // Poda barata (probabilística) para no crecer sin límite ante rotación de IPs, sin barrer en cada request.
    if (hits.size > 10_000 && Math.random() < 0.02) hits.forEach((v, k) => { if (now > v.reset) hits.delete(k); });
    const key = keyOf(req) || "unknown";
    const e = hits.get(key);
    if (!e || now > e.reset) { hits.set(key, { count: 1, reset: now + windowMs }); return next(); }
    if (e.count >= limit) return res.status(429).json({ error: "Demasiadas solicitudes. Probá en unos minutos." });
    e.count++;
    next();
  };
}

const WINDOW = 15 * 60 * 1000; // 15 min
export const preAuthIpLimiter = makeLimiter(WINDOW, 100, (req) => req.ip ?? "unknown");
export const aiLimiter = makeLimiter(WINDOW, 30, (req) => req.user?.uid ?? req.ip ?? "unknown");
