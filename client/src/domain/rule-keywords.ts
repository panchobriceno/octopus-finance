/**
 * Extracción de keywords para reglas de categorización (F2 paso 4: aprender desde el wizard).
 *
 * `tokenizeRuleText` conserva EXACTO el criterio de `generate-rules.ts` (para no cambiar el
 * comportamiento del generador histórico). `extractRuleKeywords` es una capa más estricta para el
 * aprendizaje desde UNA fila: evita IDs/códigos (sin dígitos, largo acotado) y ordena
 * alfa-puras/más-largas primero, así el default es el token más representativo del comercio.
 */
import type { MovementRule } from "@shared/schema";

export const RULE_STOPWORDS = new Set([
  "pago", "pagos", "compra", "compras", "comp", "nacional", "internacional", "transf", "transferencia",
  "de", "del", "la", "el", "con", "por", "en", "linea", "automatico", "automatica", "tarjeta", "credito",
  "cuenta", "spa", "ltda", "limitada", "limit", "plan", "mantencion", "sociedad", "monto", "cancelado",
  "traspaso", "deuda", "cargo", "abono", "com", "mp", "payu", "pat", "servicio", "uso", "marc", "asistido",
  "tasa", "int", "santiago", "condes", "las", "plaza", "mall", "trebo", "pcs", "inc", "centro", "chile",
  "sa", "eirl", "dl", "admin", "mensual", "corriente", "corr", "pap",
]);

/** Normaliza texto a minúsculas sin acentos, con solo [a-z0-9] separados por espacio. */
export function normalizeRuleText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens candidatos, criterio EXACTO de generate-rules.ts: len ≥ 4, no stopword, no solo-dígitos. */
export function tokenizeRuleText(value: string): string[] {
  return normalizeRuleText(value)
    .split(" ")
    .filter((w) => w.length >= 4 && !RULE_STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Keywords para el aprendizaje desde una fila: subconjunto más limpio de `tokenizeRuleText`
 * (sin dígitos, largo 4–24), deduplicado, ordenado alfa-puras/más-largas primero.
 */
export function extractRuleKeywords(name: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const tok of tokenizeRuleText(name)) {
    if (tok.length > 24) continue;
    if (/\d/.test(tok)) continue; // sin dígitos → evita fragmentos de ID/referencia
    if (seen.has(tok)) continue;
    seen.add(tok);
    candidates.push(tok);
  }
  return candidates.sort((a, b) => b.length - a.length);
}

/**
 * Busca una regla activa que colisione funcionalmente con (keyword, amountDirection). El motor
 * (`movementRuleScore`) solo filtra por keyword-en-texto + amountDirection (no por movementType ni
 * paymentMethod), así que el dedupe se alinea a eso: misma keyword + dirección compatible ("any"
 * cubre ambas). Devuelve la primera coincidencia o null.
 */
export function findRuleByKeyword(
  rules: MovementRule[],
  keyword: string,
  amountDirection: string,
): MovementRule | null {
  const kw = normalizeRuleText(keyword);
  if (!kw) return null;
  return (
    rules.find((rule) => {
      if (rule.isActive === false) return false;
      const hasKeyword = (rule.keywords ?? []).some((k) => normalizeRuleText(k) === kw);
      if (!hasKeyword) return false;
      const dir = rule.amountDirection ?? "any";
      return dir === "any" || amountDirection === "any" || dir === amountDirection;
    }) ?? null
  );
}
