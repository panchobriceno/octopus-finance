import { describe, expect, it } from "vitest";
import type { MovementRule } from "@shared/schema";
import { extractRuleKeywords, findRuleByKeyword, normalizeRuleText, tokenizeRuleText } from "../rule-keywords";

describe("normalizeRuleText", () => {
  it("saca acentos, baja a minúsculas y deja solo [a-z0-9]", () => {
    expect(normalizeRuleText("Farmacía SAN-José 2024")).toBe("farmacia san jose 2024");
    expect(normalizeRuleText("UBER *EATS")).toBe("uber eats");
  });
});

describe("tokenizeRuleText (paridad con generate-rules)", () => {
  it("descarta tokens < 4, stopwords y solo-dígitos", () => {
    expect(tokenizeRuleText("PAGO uber eats 123 sa")).toEqual(["uber", "eats"]); // pago=stop, 123=dígitos, sa=stop/<4
  });
  it("conserva tokens con dígitos si no son solo-dígitos", () => {
    expect(tokenizeRuleText("banco24 movimiento")).toContain("banco24");
  });
});

describe("extractRuleKeywords (UI, más estricto)", () => {
  it("descarta tokens con dígitos y ordena más-largo primero", () => {
    expect(extractRuleKeywords("MERCADOPAGO metricool ab12")).toEqual(["mercadopago", "metricool"]);
  });
  it("deduplica", () => {
    expect(extractRuleKeywords("netflix NETFLIX netflix")).toEqual(["netflix"]);
  });
  it("descarta tokens larguísimos (>24, tipo referencia)", () => {
    const long = "a".repeat(30);
    expect(extractRuleKeywords(`compra ${long} netflix`)).toEqual(["netflix"]);
  });
  it("sin tokens utilizables → []", () => {
    expect(extractRuleKeywords("pago 123 sa")).toEqual([]);
  });
});

describe("findRuleByKeyword (dedupe alineado al matcher)", () => {
  const rule = (p: Partial<MovementRule>): MovementRule => ({
    id: "r", name: "r", keywords: ["uber"], category: "Comida", itemId: null,
    workspace: "family", movementType: "expense", paymentMethod: "credit_card",
    accountId: null, creditCardName: null, cardAccountId: null, amountDirection: "expense",
    priority: 5, isActive: true, notes: null, createdAt: "", updatedAt: "", ...p,
  });

  it("encuentra por keyword normalizada + dirección compatible", () => {
    expect(findRuleByKeyword([rule({})], "UBER", "expense")?.id).toBe("r");
  });
  it("amountDirection 'any' de la regla cubre cualquier dirección", () => {
    expect(findRuleByKeyword([rule({ amountDirection: "any" })], "uber", "income")?.id).toBe("r");
  });
  it("no matchea si la dirección es opuesta y ninguna es 'any'", () => {
    expect(findRuleByKeyword([rule({ amountDirection: "expense" })], "uber", "income")).toBeNull();
  });
  it("ignora reglas inactivas y keywords distintas", () => {
    expect(findRuleByKeyword([rule({ isActive: false })], "uber", "expense")).toBeNull();
    expect(findRuleByKeyword([rule({ keywords: ["netflix"] })], "uber", "expense")).toBeNull();
  });
});
