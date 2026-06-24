import { normalizeImportText } from "@/domain/bank-imports";
import type { ColumnMapping } from "./types";

export const normalizeText = normalizeImportText;

export const PDF_COLUMN_HEADERS = {
  date: "Fecha",
  description: "Descripción",
  amount: "Monto ($)",
  installments: "Cuotas",
} as const;

export function scoreHeaderCell(value: string) {
  const normalized = normalizeText(value);

  if (!normalized) return 0;
  if (normalized.includes("fecha")) return 3;
  if (normalized.includes("descripcion")) return 3;
  if (normalized.includes("monto")) return 3;
  if (normalized.includes("cuota")) return 2;
  if (normalized.includes("categoria")) return 1;
  return 0;
}

export function splitCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^["']|["']$/g, ""));
}

export function parseDateValue(value: string) {
  const raw = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[1].padStart(2, "0")}`;
  }

  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    return `${dashMatch[3]}-${dashMatch[2].padStart(2, "0")}-${dashMatch[1].padStart(2, "0")}`;
  }

  return "";
}

export function parseAmountValue(value: string) {
  const raw = value.trim();

  if (/^\d+\s*\/\s*\d+$/.test(raw)) {
    return NaN;
  }

  const normalized = value
    .replace(/\s/g, "")
    .replace(/\$/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, ".");

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : NaN;
}

export function parseInstallmentsValue(value: string) {
  const raw = value.trim();

  if (!raw) {
    return { label: "-", count: null as number | null };
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return { label: raw, count: null as number | null };
  }

  return {
    label: `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}`,
    count: Number.parseInt(match[2], 10),
  };
}

export function extractDueDate(lines: string[], delimiter: string): string | null {
  for (const line of lines) {
    const cells = splitCsvLine(line, delimiter);
    for (let i = 0; i < cells.length - 1; i++) {
      if (normalizeText(cells[i]).includes("pagar hasta")) {
        const dateStr = parseDateValue(cells[i + 1].trim());
        if (dateStr) return dateStr;
      }
    }
  }
  return null;
}

export function isLikelyCreditCardImport(headers: string[], lines: string[]) {
  const normalizedHeaders = headers.map((header) => normalizeText(header));
  const normalizedText = normalizeText(lines.slice(0, 20).join(" "));

  return (
    normalizedHeaders.some((header) => header.includes("cuota")) ||
    normalizedHeaders.some((header) => header.includes("tipo de tarjeta")) ||
    normalizedText.includes("pagar hasta") ||
    normalizedText.includes("movimientos facturados") ||
    normalizedText.includes("movimientos no facturados") ||
    normalizedText.includes("tipo de tarjeta")
  );
}

function scoreAmountColumn(header: string, rows: Record<string, string>[]) {
  const normalizedHeader = normalizeText(header);
  let score = 0;

  if (
    normalizedHeader.includes("monto") ||
    normalizedHeader.includes("amount") ||
    normalizedHeader.includes("importe") ||
    normalizedHeader.includes("valor")
  ) {
    score += 8;
  }

  if (
    normalizedHeader.includes("cuota") ||
    normalizedHeader.includes("installment")
  ) {
    score -= 8;
  }

  const sampleRows = rows.slice(0, 30);
  for (const row of sampleRows) {
    const value = (row[header] ?? "").trim();
    if (!value) continue;

    if (/^\d+\s*\/\s*\d+$/.test(value)) {
      score -= 4;
      continue;
    }

    const parsed = parseAmountValue(value);
    if (!Number.isNaN(parsed)) {
      score += 3;
      if (Math.abs(parsed) >= 1000) score += 2;
      if (/[-$.,]/.test(value)) score += 1;
    }
  }

  return score;
}

function scoreInstallmentsColumn(header: string, rows: Record<string, string>[]) {
  const normalizedHeader = normalizeText(header);
  let score = 0;

  if (
    normalizedHeader.includes("cuota") ||
    normalizedHeader.includes("installment")
  ) {
    score += 8;
  }

  const sampleRows = rows.slice(0, 30);
  for (const row of sampleRows) {
    const value = (row[header] ?? "").trim();
    if (!value) continue;

    if (/^\d+\s*\/\s*\d+$/.test(value)) {
      score += 4;
      continue;
    }

    if (!Number.isNaN(parseAmountValue(value))) {
      score -= 1;
    }
  }

  return score;
}

export function inferMapping(headers: string[], rows: Record<string, string>[]): ColumnMapping {
  const match = (patterns: string[]) =>
    headers.find((header) => patterns.some((pattern) => normalizeText(header).includes(pattern))) ?? headers[0] ?? "";

  const amountHeader = headers
    .map((header) => ({ header, score: scoreAmountColumn(header, rows) }))
    .sort((left, right) => right.score - left.score)[0]?.header ?? "";

  const installmentsHeader = headers
    .map((header) => ({ header, score: scoreInstallmentsColumn(header, rows) }))
    .sort((left, right) => right.score - left.score)[0]?.header ?? "";

  return {
    date: match(["fecha", "date"]),
    description: match(["descripcion", "descripción", "detalle", "glosa", "nombre", "description"]),
    amount: amountHeader,
    installments: installmentsHeader,
  };
}

export function detectHeaderRowIndex(lines: string[], delimiter: string) {
  let bestIndex = 0;
  let bestScore = -1;

  lines.forEach((line, index) => {
    const score = splitCsvLine(line, delimiter).reduce((sum, cell) => sum + scoreHeaderCell(cell), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}
