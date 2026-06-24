import type { BankParser } from "./types";

export const genericBankParser: BankParser = {
  id: "generic-bank",
  label: "Banco generico",
  sourceName: "Cartola bancaria",
  bankName: null,
  canHandle: () => true,
};
