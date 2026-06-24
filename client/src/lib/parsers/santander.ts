import { normalizeText } from "./csv-core";
import type { BankParser, BankParserInput } from "./types";

function buildSourceText(input: BankParserInput) {
  return normalizeText([
    input.fileName,
    input.headers.join(" "),
    input.lines.slice(0, 8).join(" "),
  ].join(" "));
}

export const santanderParser: BankParser = {
  id: "santander",
  label: "Santander",
  sourceName: "Cartola Santander",
  bankName: "Santander",
  canHandle: (input) => buildSourceText(input).includes("santander"),
};
