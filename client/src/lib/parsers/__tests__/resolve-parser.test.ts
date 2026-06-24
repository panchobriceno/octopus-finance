import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { detectHeaderRowIndex, splitCsvLine } from "../csv-core";
import { resolveParser } from "../index";
import type { AccountType } from "../types";

function readFixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function parserInput(
  fixtureName: string,
  options: { fileName?: string; accountType?: AccountType } = {},
) {
  const lines = readFixture(fixtureName)
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, ""))
    .filter(Boolean);
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headerRowIndex = detectHeaderRowIndex(lines, delimiter);
  const headers = splitCsvLine(lines[headerRowIndex], delimiter);

  return {
    fileName: options.fileName ?? fixtureName,
    headers,
    lines,
    accountType: options.accountType ?? "bank",
    sourceKind: "csv" as const,
  };
}

describe("resolveParser", () => {
  it("detects Santander by filename, headers and body", () => {
    expect(resolveParser(parserInput("santander-filename.csv")).id).toBe("santander");
    expect(resolveParser(parserInput("santander-headers.csv", { fileName: "movimientos.csv" })).id).toBe("santander");
    expect(resolveParser(parserInput("santander-body.csv", { fileName: "movimientos.csv" })).id).toBe("santander");
  });

  it("detects Edwards, Banco de Chile and Itau exports", () => {
    expect(resolveParser(parserInput("edwards.csv")).id).toBe("edwards");
    expect(resolveParser(parserInput("edwards-bancodechile.csv")).id).toBe("edwards");
    expect(resolveParser(parserInput("itau.csv")).id).toBe("itau");
  });

  it("keeps credit-card as the explicit account-type winner", () => {
    expect(resolveParser(parserInput("santander-filename.csv", { accountType: "credit" })).id).toBe("credit-card");
  });

  it("does not misclassify a known bank export as credit-card just because it has installments", () => {
    expect(resolveParser(parserInput("ambiguous-cuotas-bank.csv")).id).toBe("edwards");
  });

  it("detects credit-card exports from cuotas or pagar hasta signals", () => {
    expect(resolveParser(parserInput("credit-card-cuotas.csv")).id).toBe("credit-card");
    expect(resolveParser(parserInput("credit-card-pagar-hasta.csv")).id).toBe("credit-card");
  });

  it("falls back to generic-bank when there are no known signals", () => {
    expect(resolveParser(parserInput("no-signals.csv")).id).toBe("generic-bank");
  });

  it("does not apply csv credit-card heuristics to pdf input unless account type is credit", () => {
    const input = {
      fileName: "estado.pdf",
      headers: ["Fecha", "Descripcion", "Monto", "Cuotas"],
      lines: ["Pagar hasta,15/07/2026", "Movimientos facturados"],
      accountType: "bank" as const,
      sourceKind: "pdf" as const,
    };

    expect(resolveParser(input).id).toBe("generic-bank");
    expect(resolveParser({ ...input, accountType: "credit" }).id).toBe("credit-card");
  });
});
