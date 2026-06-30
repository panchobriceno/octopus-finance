/**
 * Scraper de la CUENTA CORRIENTE Edwards (movimientos) con Playwright.
 * Edwards: login automatico (RUT+clave del Keychain, sin 2FA), HEADED (headless da 403).
 * Esta version es SOLO LECTURA: navega, lee la tabla de movimientos y la imprime. No escribe
 * en Firestore (eso se suma cuando confirmemos que la navegacion del SPA es estable).
 *
 * Correr (con vos mirando): npx tsx scripts/bank-bot/edwards-cuenta.ts
 */
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright";

const RUT = "17.041.822-0";
const PROFILE_DIR = path.join(os.homedir(), ".octopus-finance-bot", "edwards-profile");
const CC_HASH = "#/movimientos/cuenta/saldos-movimientos";

function keychain(service: string): string {
  return execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8" }).trim();
}

async function dumpRows(page: Page, label: string) {
  const rows = await page.$$eval("table tr", (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td,th")).map((c) => (c.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean).join(" | "))
      .filter((s) => s.length > 3).slice(0, 40),
  ).catch(() => [] as string[]);
  console.log(`\n[${label}] filas en tablas: ${rows.length}`);
  rows.forEach((r) => console.log("  " + r));
  return rows;
}

async function main() {
  const password = keychain("octopus-finance-edwards");
  console.log("Clave leida del Keychain. Abriendo navegador visible...");
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1320, height: 920 }, locale: "es-CL" });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    // Login (camino humano; el directo da 403)
    await page.goto("https://www.bancoedwards.cl", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('a:has-text("Banco en Línea"), a:has-text("Banco en Linea")').first().click({ timeout: 30000 });
    await page.waitForURL(/login\.portales\.bancochile\.cl/, { timeout: 60000 });
    await page.getByRole("textbox", { name: /rut/i }).fill(RUT, { timeout: 30000 });
    await page.locator('input[type="password"]').first().fill(password, { timeout: 30000 });
    await page.getByRole("button", { name: /ingresar/i }).click({ timeout: 30000 });
    await page.waitForURL(/portalpersonas\.bancochile\.cl/, { timeout: 90000 });
    console.log("✅ Login OK. Navegando a cuenta corriente...");
    await page.waitForTimeout(3000);

    // Navegar DENTRO del SPA (sin recargar, para no perder la sesion)
    await page.evaluate((h) => { window.location.hash = h; }, CC_HASH).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    console.log("URL actual:", page.url());

    // Selector de cuenta (radios Angular Material): elegir la primera cuenta corriente.
    const radios = await page.$$('mat-radio-button, input[type="radio"]');
    console.log(`Radios de cuenta encontrados: ${radios.length}`);
    if (radios.length) {
      try { await radios[0].click({ timeout: 5000 }); console.log("Click en primera cuenta."); }
      catch { await page.evaluate(() => { const r = document.querySelector('input[type="radio"]') as HTMLInputElement | null; if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } }); console.log("Set checked via JS."); }
      await page.waitForTimeout(3000);
    }
    // Algun boton de "Buscar"/"Ver"/"Consultar"
    for (const txt of ["Buscar", "Consultar", "Ver movimientos", "Ver"]) {
      const b = page.locator(`button:has-text("${txt}")`).first();
      if (await b.count().catch(() => 0)) { try { await b.click({ timeout: 4000 }); console.log(`Click en "${txt}".`); await page.waitForTimeout(3000); break; } catch { /* sigue */ } }
    }

    await page.waitForFunction(() => document.querySelectorAll("table tr").length > 1, { timeout: 20000 }).catch(() => console.log("(no aparecio tabla en 20s)"));
    const rows = await dumpRows(page, "CUENTA CORRIENTE");

    if (rows.length === 0) {
      console.log("\n--- DIAGNOSTICO (0 filas) ---");
      console.log("URL:", page.url());
      console.log("Texto visible:", await page.evaluate(() => document.body.innerText.replace(/\n+/g, " / ").slice(0, 800)));
      await page.screenshot({ path: "/tmp/edwards-cuenta.png", fullPage: true });
      console.log("Captura: /tmp/edwards-cuenta.png");
    }
    console.log("\nDejo el navegador abierto 40s para que mires/me digas qué ves...");
    await page.waitForTimeout(40000);
  } catch (err) {
    console.error("\n❌ FALLO:", (err as Error).message);
    try { await page.screenshot({ path: "/tmp/edwards-cuenta-fail.png", fullPage: true }); console.error("Captura: /tmp/edwards-cuenta-fail.png | URL:", page.url()); } catch { /* ignore */ }
    await page.waitForTimeout(20000);
  } finally {
    await ctx.close();
  }
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
