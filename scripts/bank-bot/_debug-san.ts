import { execFileSync } from "node:child_process";
import { parseSantanderTransfer, parseSantanderPayment } from "./parse-email";
const raw = execFileSync("python3", ["scripts/bank-bot/read_gmail_santander.py", "extract", "30"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const emails = JSON.parse(raw || "[]") as { kind: string; subject: string; body: string }[];
for (const e of emails) {
  const hasRecibido = /ha recibido una transferencia/i.test(e.body.replace(/\s+/g, " "));
  const hasRealizado = /ha realizado una transferencia/i.test(e.body.replace(/\s+/g, " "));
  const seed = e.kind === "payment" ? parseSantanderPayment(e.body) : parseSantanderTransfer(e.body);
  console.log(`kind=${e.kind} recibido=${hasRecibido} realizado=${hasRealizado} => dir=${seed?.direction} | ${seed?.description} $${seed?.amount}`);
}
