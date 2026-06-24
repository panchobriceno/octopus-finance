import type { BankParser, BankParserInput } from "./types";
import { creditCardParser } from "./credit-cards";
import { edwardsParser } from "./edwards";
import { genericBankParser } from "./generic-bank";
import { itauParser } from "./itau";
import { santanderParser } from "./santander";

const PARSERS: BankParser[] = [
  creditCardParser,
  santanderParser,
  edwardsParser,
  itauParser,
  genericBankParser,
];

function isBankParser(parser: BankParser) {
  return parser.id !== "credit-card" && parser.id !== "generic-bank";
}

export function resolveParser(input: BankParserInput) {
  if (input.accountType === "credit") {
    return creditCardParser;
  }

  return (
    PARSERS.find((parser) => isBankParser(parser) && parser.canHandle(input)) ??
    (creditCardParser.canHandle(input) ? creditCardParser : genericBankParser)
  );
}

export { PARSERS };
