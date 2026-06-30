/**
 * Radar de suscripciones: agrupa los compromisos recurrentes de software/streaming para ver
 * el gasto mensual/anual y detectar solapamientos (ej. Claude + ChatGPT = doble IA). Puro.
 */
import type { CommitmentTemplate } from "@shared/schema";

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Categorías que consideramos "suscripción" (normalizadas; incluye variante con/sin typo de Adobe).
const SUB_CATEGORIES = new Set([
  "software empresa",
  "digital",
  "magnific",
  "adobe creative cloud",
  "adobe creative cloude",
]);

export type SubTipo = "IA" | "Streaming" | "Apple" | "Diseño" | "Otro";

/** Tipo por keywords del nombre. Prioridad: IA → Apple → Streaming → Diseño → Otro.
 * (Apple gana sobre Streaming a propósito: agrupa Apple One/TV/iCloud juntos para ver el sprawl.) */
export function subTipo(name: unknown): SubTipo {
  const n = norm(name);
  if (/\b(claude|chatgpt|chat gpt|gpt|gemini|copilot|anthropic|perplexity)\b/.test(n)) return "IA";
  if (/apple/.test(n)) return "Apple";
  if (/netflix|disney|prime|youtube|hbo|max\b|star\b|spotify|paramount/.test(n)) return "Streaming";
  if (/adobe|magnific|canva|figma|freepik|midjourney/.test(n)) return "Diseño";
  return "Otro";
}

export type Subscription = { name: string; amount: number; category: string; workspace: string; tipo: SubTipo };
export type SubsOverlap = { tipo: SubTipo; items: Subscription[]; sum: number };
export type SubsResult = {
  items: Subscription[];
  totalMes: number;
  totalAnual: number;
  byWorkspace: { workspace: string; monto: number }[];
  overlaps: SubsOverlap[];
};

export function buildSubscriptions(templates: CommitmentTemplate[]): SubsResult {
  const items: Subscription[] = templates
    .filter(
      (t) =>
        t.isActive !== false &&
        (t.movementType ?? "expense") === "expense" &&
        SUB_CATEGORIES.has(norm(t.category)),
    )
    .map((t) => ({
      name: t.name,
      amount: Number(t.amount) || 0,
      category: t.category,
      workspace: t.workspace || "family",
      tipo: subTipo(t.name),
    }))
    .sort((a, b) => b.amount - a.amount);

  const totalMes = items.reduce((s, x) => s + x.amount, 0);

  const wsMap = new Map<string, number>();
  for (const x of items) wsMap.set(x.workspace, (wsMap.get(x.workspace) || 0) + x.amount);
  const byWorkspace = Array.from(wsMap.entries())
    .map(([workspace, monto]) => ({ workspace, monto }))
    .sort((a, b) => b.monto - a.monto);

  const tipoMap = new Map<SubTipo, Subscription[]>();
  for (const x of items) {
    const arr = tipoMap.get(x.tipo) ?? [];
    arr.push(x);
    tipoMap.set(x.tipo, arr);
  }
  const overlaps: SubsOverlap[] = Array.from(tipoMap.entries())
    .filter(([tipo, arr]) => tipo !== "Otro" && arr.length >= 2)
    .map(([tipo, arr]) => ({ tipo, items: arr, sum: arr.reduce((s, x) => s + x.amount, 0) }))
    .sort((a, b) => b.sum - a.sum);

  return { items, totalMes, totalAnual: totalMes * 12, byWorkspace, overlaps };
}
