/**
 * Prueba de scraping en vivo de Edwards con Playwright (login automatico + lectura).
 * Headed (visible) porque el banco bloquea headless con 403.
 * Lee la clave del Keychain. NO escribe en Firestore: solo imprime lo que leyo.
 *
 * Correr:  npx tsx scripts/bank-bot/edwards-scrape.ts
 */

import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const RUT = "17.041.822-0"; // no es secreto
const PROFILE_DIR = path.join(os.homedir(), ".octopus-finance-bot", "edwards-profile");

function keychainPassword(service: string): string {
  return execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8" }).trim();
}

async function main() {
  const password = keychainPassword("octopus-finance-edwards");
  console.log("Clave leida del Keychain (oculta). Abriendo navegador visible...");

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "es-CL",
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    // Camino humano (el directo da 403)
    await page.goto("https://www.bancoedwards.cl", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('a:has-text("Banco en Línea"), a:has-text("Banco en Linea")').first().click({ timeout: 30000 });

    // Login
    await page.waitForURL(/login\.portales\.bancochile\.cl/, { timeout: 60000 });
    await page.getByRole("textbox", { name: /rut/i }).fill(RUT, { timeout: 30000 });
    await page.locator('input[type="password"]').first().fill(password, { timeout: 30000 });
    await page.getByRole("button", { name: /ingresar/i }).click({ timeout: 30000 });

    // Esperar el home
    console.log("Login enviado. Esperando el home...");
    await page.waitForURL(/portalpersonas\.bancochile\.cl/, { timeout: 90000 });
    console.log("✅ LOGIN AUTOMATICO OK — llego al home sin intervencion.");

    // Navegar DENTRO del SPA (sin recargar, para no perder la sesion)
    await page.waitForTimeout(3000);
    await page.evaluate(() => { window.location.hash = "#/tarjeta-credito/consultar/saldos"; }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    // esperar a que el SPA pinte la tabla
    try {
      await page.waitForFunction(() => document.querySelectorAll("table tr").length > 1, { timeout: 25000 });
    } catch {
      console.log("(no aparecio tabla en 25s; sigo con lo que haya)");
    }
    await page.waitForTimeout(3000);

    const rows = await page.$$eval("table tr", (trs) =>
      trs
        .map((tr) => Array.from(tr.querySelectorAll("td,th")).map((c) => (c.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean).join(" | "))
        .filter((s) => s.length > 3)
        .slice(0, 20),
    );

    console.log(`\n✅ SCRAPING — ${rows.length} filas leidas de la tarjeta (no facturados):`);
    rows.forEach((r) => console.log("  " + r));

    if (rows.length === 0) {
      console.log("\n--- DIAGNOSTICO (0 filas) ---");
      console.log("URL:", page.url());
      const txt = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " / ").slice(0, 600));
      console.log("Texto:", txt);
      await page.screenshot({ path: "/tmp/edwards-card.png" });
      console.log("Captura: /tmp/edwards-card.png");
    }
  } catch (err) {
    console.error("\n❌ FALLO:", (err as Error).message);
    try {
      await page.screenshot({ path: "/tmp/edwards-scrape-fail.png" });
      console.error("Captura del fallo: /tmp/edwards-scrape-fail.png");
      console.error("URL al fallar:", page.url());
    } catch {}
  } finally {
    await page.waitForTimeout(2000);
    await ctx.close();
  }
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
