import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  detectHeaderRowIndex,
  extractDueDate,
  inferMapping,
  normalizeText,
  parseAmountValue,
  parseDateValue,
  parseInstallmentsValue,
  splitCsvLine,
} from "../csv-core";

function fixtureLines(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
}

describe("csv-core", () => {
  it("normalizes supported date formats", () => {
    expect(parseDateValue("23/06/2026")).toBe("2026-06-23");
    expect(parseDateValue("3/6/2026")).toBe("2026-06-03");
    expect(parseDateValue("2026-06-23")).toBe("2026-06-23");
    expect(parseDateValue("23-06-2026")).toBe("2026-06-23");
    expect(parseDateValue("")).toBe("");
  });

  it("normalizes diacritics and repeated whitespace for matching", () => {
    expect(normalizeText("  Descripción   con   espacios  ")).toBe("descripcion con espacios");
  });

  it("parses CLP-like amounts without confusing installments as amounts", () => {
    expect(parseAmountValue("1.234.567")).toBe(1234567);
    expect(parseAmountValue("-45.000")).toBe(-45000);
    expect(parseAmountValue("$89.990")).toBe(89990);
    expect(Number.isNaN(parseAmountValue("1/3"))).toBe(true);
  });

  it("normalizes installments", () => {
    expect(parseInstallmentsValue("3/12")).toEqual({ label: "03/12", count: 12 });
    expect(parseInstallmentsValue("")).toEqual({ label: "-", count: null });
    expect(parseInstallmentsValue("-")).toEqual({ label: "-", count: null });
  });

  it("splits quoted csv cells", () => {
    expect(splitCsvLine('23/06/2026,"Compra, local",-45000', ",")).toEqual([
      "23/06/2026",
      "Compra, local",
      "-45000",
    ]);
  });

  it("finds headers below bank metadata and extracts due date", () => {
    const santanderLines = fixtureLines("santander-body.csv");
    const creditLines = fixtureLines("credit-card-pagar-hasta.csv");

    expect(detectHeaderRowIndex(santanderLines, ",")).toBe(2);
    expect(extractDueDate(creditLines, ",")).toBe("2026-07-15");
  });

  it("infers amount and installments columns by header and sample values", () => {
    const headers = ["Detalle", "Cuotas", "Fecha Movimiento", "Cargo / Abono"];
    const rows = [
      {
        Detalle: "Credito de consumo",
        Cuotas: "3/36",
        "Fecha Movimiento": "23/06/2026",
        "Cargo / Abono": "-180.000",
      },
      {
        Detalle: "Deposito nomina",
        Cuotas: "-",
        "Fecha Movimiento": "22/06/2026",
        "Cargo / Abono": "850.000",
      },
    ];

    expect(inferMapping(headers, rows)).toMatchObject({
      date: "Fecha Movimiento",
      description: "Detalle",
      amount: "Cargo / Abono",
      installments: "Cuotas",
    });
  });
});
