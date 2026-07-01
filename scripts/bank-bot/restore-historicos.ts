/**
 * Revierte una corrida de categorize-historicos.ts desde su backup.
 * Restaura category/workspace/itemId al valor previo de cada transacción.
 *
 *   npx tsx scripts/bank-bot/restore-historicos.ts _backup-historicos-<ts>.json
 */
import fs from "node:fs";
import path from "node:path";
import { doc, writeBatch, type Firestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";

const CHUNK = 400;
type Row = { id: string; category: string; workspace: string | null; itemId: string | null };

async function commitChunked(db: Firestore, rows: Row[]) {
  for (let off = 0; off < rows.length; off += CHUNK) {
    const b = writeBatch(db);
    for (const r of rows.slice(off, off + CHUNK)) {
      b.update(doc(db, "transactions", r.id), { category: r.category, workspace: r.workspace, itemId: r.itemId, updatedAt: new Date().toISOString() });
    }
    await b.commit();
  }
}

(async () => {
  const arg = process.argv[2];
  if (!arg) { console.error("Uso: restore-historicos.ts <_backup-historicos-*.json>"); process.exit(1); }
  const file = path.isAbsolute(arg) ? arg : path.join(process.cwd(), "scripts", "bank-bot", arg);
  if (!fs.existsSync(file)) { console.error(`No existe el backup: ${file}`); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
  if (!Array.isArray(rows) || rows.length === 0) { console.error("Backup vacío o inválido."); process.exit(1); }

  const db = await getAuthedDb();
  await commitChunked(db, rows);
  console.log(`✅ Restauradas ${rows.length} transacciones a su estado previo (desde ${path.basename(file)}).`);
})().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
