import { normalizeText } from "./csv-core";
import type { BankParser, BankParserInput } from "./types";

function buildSourceText(input: BankParserInput) {
  return normalizeText([
    input.fileName,
    input.headers.join(" "),
    input.lines.slice(0, 8).join(" "),
  ].join(" "));
}

export const itauParser: BankParser = {
  id: "itau",
  label: "Itau",
  sourceName: "Cartola Itau",
  bankName: "Itau",
  canHandle: (input) => buildSourceText(input).includes("itau"),
};
