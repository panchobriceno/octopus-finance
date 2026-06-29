/**
 * Captura del EECC (estado de cuenta) de la tarjeta de credito Santander desde Office Banking.
 * Office Banking no deja bajar el PDF limpio (cae con nombre UUID en un temp y no se encuentra).
 * Este script abre un Chromium VISIBLE: vos te logueas y vas a Tarjetas -> Estado de cuenta ->
 * "Ver" en EECC nacional e internacional. El script CAZA las descargas / respuestas PDF y las
 * guarda con nombre claro en ~/octopus-finance-bot/santander-eecc/.
 *
 * No escribe en Firestore. Solo baja PDFs (el parser se hace despues, offline).
 *
 * Correr (en background): npx tsx scripts/bank-bot/santander-eecc.ts
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Download, type Response } from "playwright";

const OUT = path.join(os.homedir(), "octopus-finance-bot", "santander-eecc");
const PROFILE = path.join(os.homedir(), ".octopus-finance-bot", "santander-profile");
const MAX_MS = 10 * 60 * 1000; // 10 min para login + 2FA + navegacion
const TARGET = 2;              // EECC nacional + internacional
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1400, height: 950 },
    locale: "es-CL",
  });

  let got = 0;
  const seen = new Set<string>();
  const save = (buf: Buffer, hint: string) => {
    const key = `${buf.length}`;
    if (seen.has(key)) return; // evita guardar el mismo PDF dos veces (download + response)
    seen.add(key);
    const f = path.join(OUT, `eecc-${stamp()}-${hint}.pdf`);
    fs.writeFileSync(f, buf);
    got++;
    console.log(`CAPTURADO (${got}/${TARGET}): ${f} (${(buf.length / 1024).toFixed(0)} KB)`);
  };

  const onDownload = async (d: Download) => {
    try {
      const tmp = await d.path();
      if (tmp) save(fs.readFileSync(tmp), (d.suggestedFilename() || "download").replace(/[^a-z0-9.]+/gi, "_").slice(0, 40));
    } catch (e: any) { console.error("download err:", e?.message ?? e); }
  };
  const onResponse = async (r: Response) => {
    try {
      const ct = (r.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("application/pdf") || r.url().toLowerCase().endsWith(".pdf")) {
        const buf = await r.body();
        if (buf && buf.length > 1000) save(buf, "resp");
      }
    } catch { /* algunas respuestas no exponen body */ }
  };

  ctx.on("page", (p) => { p.on("download", onDownload); p.on("response", onResponse); });
  for (const p of ctx.pages()) { p.on("download", onDownload); p.on("response", onResponse); }
  ctx.on("download" as any, onDownload);

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://empresas.officebanking.cl/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.error("goto:", e?.message));

  console.log("\n================ INSTRUCCIONES ================");
  console.log("1. Logueate en la ventana de Chrome que se abrio (Office Banking empresa).");
  console.log("2. Anda a: Tarjetas -> Estado de cuenta.");
  console.log("3. Apreta 'Ver' en el EECC NACIONAL y en el INTERNACIONAL.");
  console.log("El script guarda los PDF solo en ~/octopus-finance-bot/santander-eecc/");
  console.log(`Se cierra solo al capturar ${TARGET} PDFs o tras 10 minutos.`);
  console.log("==============================================\n");

  const t0 = Date.now();
  while (got < TARGET && Date.now() - t0 < MAX_MS) await page.waitForTimeout(3000);

  console.log(`\nFin. PDFs capturados: ${got}. Carpeta: ${OUT}`);
  if (got === 0) { try { await page.screenshot({ path: "/tmp/santander-eecc.png" }); console.log("Sin capturas; screenshot en /tmp/santander-eecc.png | URL:", page.url()); } catch {} }
  await ctx.close();
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
