import { normalizeText } from "./csv-core";
import type { BankParser, BankParserInput } from "./types";

function buildSourceText(input: BankParserInput) {
  return normalizeText([
    input.fileName,
    input.headers.join(" "),
    input.lines.slice(0, 8).join(" "),
  ].join(" "));
}

export const edwardsParser: BankParser = {
  id: "edwards",
  label: "Banco Edwards / Banco de Chile",
  sourceName: "Cartola Banco Edwards",
  bankName: "Banco Edwards",
  canHandle: (input) => {
    const text = buildSourceText(input);
    return (
      text.includes("edwards") ||
      text.includes("banco de chile") ||
      text.includes("bancodechile") ||
      text.includes("banco chile")
    );
  },
};
