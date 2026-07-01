# Octopus Finance — Arquitectura y Decisiones

> Documento vivo para que cualquier sesión (o Codex) entienda **qué es la app, qué se hizo, por qué, y qué falta**.
> Última actualización mayor: 2026-06-30.

## Qué es
App de finanzas **personales + empresa** de Pancho (Octopus Media) y Javiera. **2 usuarios**. Stack: React + Vite + wouter (hash routing) + React Query + Tailwind/shadcn, servida por un Express (`server/index.ts`) desde Railway (proyecto `wonderful-perfection`, servicio `octopus-finance`, auto-deploy al pushear a `main`). Datos en **Firestore** (`firebase/firestore/lite`, proyecto `my-cash-flow-bcb24`). El server inyecta la config Firebase en `window.__APP_CONFIG__` (default hardcodeado en `server/index.ts` + override por env de Railway).

## Estado actual (sólido)
- **Identidad de cuentas** con `cardAccountId` (la tarjeta), separado de `accountId` (la cuenta que paga).
- **Asesor y Flujo de Caja usan el MISMO motor** (`buildCashObligations`) → mismos números, sin doble-conteo.
- **Resumen desinflado**: alertas y caja reales (ver más abajo).
- **Seguridad cerrada**: login obligatorio + reglas Firestore que solo permiten a los 2 dueños.

## Los 4 arcos de trabajo (qué + por qué)

### 1. Migración de identidad (cardAccountId)
Antes todo se matcheaba por el TEXTO `creditCardName` (frágil: el banco imprime su nombre distinto, había typos, colisiones). Se agregó `cardAccountId` a Transaction/CommitmentTemplate/Instance/ImportedMovement + helper `client/src/domain/account-identity.ts` (`accountIdentityKey`, `resolveCardAccount` = cardAccountId → last4 único → nombre; null si ambiguo; `bankCode` canónico con "chile" al final para no confundir Santander/Scotiabank Chile). Conciliación (`domain/reconciliation.ts`) y `finance.ts` matchean por identidad estructural, nombre solo como último respaldo. Writers emiten `cardAccountId` vía **chokepoint** en `lib/firestore.ts` (`withCardAccountId`/`applyCardAccountIdSync`: undefined=no tocar, null/""=limpiar, id truthy=respetar, null+creditCardName=resolver). Backfill + relink histórico aplicados (scripts en `scripts/bank-bot/`, todos con dry-run + `--apply` + backup/manifest). **NO se rellenó `accountId` bancario histórico** a propósito (ese campo SÍ entra en `dedupeKey`/`matchKey` → sería una migración de clave con riesgo de duplicados; `cardAccountId` NO entra en esas huellas → seguro).

### 2. Plan 1 — "A pagar" sin doble-conteo
Regla mental (de Pancho, correcta): **una suscripción pagada con tarjeta NO es salida de caja individual; la salida de caja es el PAGO de la tarjeta.** `client/src/domain/cash-obligations.ts buildCashObligations`: obligaciones de caja = compromisos NO-tarjeta + pago REAL de cada tarjeta del ciclo (`pendienteReal` de `buildCardDebt`), excluyendo subs de tarjeta y placeholders. Devuelve `byMonth` (3 meses, por ambiente, con `cardBreakdown`+`cashBreakdown`+`overdue`). Cableado en `buildAdvisorFacts` (asesor) y, vía `buildCashFlowFinancialTransactions`, en Flujo de Caja (que antes estaba CIEGO: proyectaba `subtype=planned` transactions = 0). UI: `CashSummaryCard` (tabs de mes, (i) desplegable en Gastos del mes y Tarjetas, chips por ambiente, sello "vencido"). Concepto clave de Pancho: "lo que debo" = lo del MES (la cuota/facturado del ciclo), **no** el saldo total; el saldo total/cupo va sin prioridad (Centro de Deuda).

### 3. Auditoría + desinflar el Resumen
El Resumen usaba lógica vieja y mostraba números inflados. Corregido reusando el motor real:
- "movimientos sin cuenta" 87→7 (solo bancarios ejecutados del mes sin `accountId`; TC tienen `cardAccountId`).
- "cobros vencidos" 9→0 (`getClientPaymentReferenceDate` = expectedDate??dueDate??issueDate + `getTodayLocalDateKey` local).
- "Deuda TC" → `buildCardDebt` (cartola real − pagos + dólares) = $5.415.430, igual que Centro de Deuda.
- "Octopus queda negativo después de IVA" era **falsa alarma** (usaba flujo acumulado). Ahora usa **caja real de Empresa** (`getAvailableCashBalance(accounts,"business")`) − IVA. Para eso se re-taguearon las cuentas de Octopus a `workspace=business` (antes "shared", inconsistente).

### 4. Seguridad (crítico)
Estaba SIN seguridad: cliente escribía a Firestore directo, sin login, sin `firestore.rules` → base abierta. Cerrado por fases: (F2) login Firebase Auth (`components/auth-gate.tsx`, gate en `App.tsx`); (F3/F3b) scripts migrados a sesión autenticada vía `scripts/bank-bot/_db.ts getAuthedDb()` (la SA firma un custom token → el client SDK inicia sesión → conserva la API client + pasa las reglas); (F4) `firestore.rules` default-deny solo para los 2 UIDs. **Bug encontrado clave:** la API key de Firebase en `server/index.ts` (default hardcodeado) + en Railway estaba **vencida** → Firestore la toleraba pero Auth la rechazaba (rompía el login). Se reemplazó por la vigente (la apiKey web es pública).

## Decisiones clave (con el porqué)
- **`cardAccountId` separado de `accountId`** (no reusar accountId para tarjetas): en un pago de tarjeta, `accountId` = cuenta que paga, `cardAccountId` = tarjeta pagada. Mezclarlos rompía saldos/conciliación (lo cazó Codex).
- **Relink solo de `cardAccountId`, no de `accountId`**: cardAccountId no entra en dedupeKey/matchKey → sin riesgo de duplicados. accountId sí → postergado a fase futura con dry-run de colisiones.
- **Un motor por propósito**: `buildCashObligations` (caja del mes, asesor+flujo), `buildCardDebt` (deuda por cartola, por last4), P&L económico aparte. No mezclar `combineFinancialTransactions` legacy en superficies de caja.
- **Método de pago vive en la PLANTILLA del compromiso** (paymentMethod+creditCardName+cardAccountId); las instancias mensuales lo heredan (`commitments.ts:94-98`). Set once → hereda. Editable en el form de Automatización.
- **Suscripciones default a T.C 7232** (decisión de Pancho); ítems de tarjeta NO se marcan pagados individualmente (se pagan al pagar la tarjeta / se concilian con la cartola).
- **Seguridad: custom token, no password ni Admin API rewrite**: la SA firma el token, el client conserva su API. Reglas atadas a UID fijo (no `request.auth != null`, porque si el signup queda abierto cualquiera pasaría).
- **Cuentas de Octopus = workspace `business`** (antes "shared"): para que la alerta de caja de Octopus use la caja real.

## Datos / config de referencia
- **Proyecto Firebase:** `my-cash-flow-bcb24`. **UIDs:** francisco@octopusmedia.cl=`AKgiLAeRImfeGKg1N18MxmgV28q2` · javiera@octopusmedia.cl=`PRFhKlsOrfgqNnupSv0771UzhH03`.
- **Service Account (Admin):** `~/.claude-secrets/my-cash-flow-firebase-admin.json` (chmod 600, fuera del repo). `firebase-admin` instalado; imports modulares (`firebase-admin/app`, `firebase-admin/auth`, `firebase-admin/firestore`).
- **API key web vigente:** termina en `...uYNWCpx4` (pública). La vieja `...I_cY2skA` estaba vencida.
- **Railway:** CLI disponible; `railway variables --set` para env. `VITE_FIREBASE_API_KEY` ya actualizada allí.
- **Reglas:** `firestore.rules` en el repo; deploy MANUAL (pegar en consola Firebase). No hay firebase CLI configurado.
- **Workspaces (ambientes):** `business` (Empresa/Octopus), `family` (personal Pancho+Javi), `dentist` (consulta Javi), `shared` (en desuso tras mover OM a business).
- **USD_CLP = 960** (tipo de cambio referencial para deuda en dólares). Fuente única: exportado desde `@/domain/debt`; lo consumen `debt.tsx`, `credit-cards-panel.tsx` y `overview.tsx`.

## Convenciones de scripts (`scripts/bank-bot/`)
- Los que corren con reglas cerradas usan `const db = await getAuthedDb()` (de `_db.ts`). El pipeline diario (`run-daily.sh`) y auditorías ya migrados.
- Todo script que ESCRIBE: dry-run por defecto + `--apply` + backup/manifest + guard de projectId. Nunca escribir sin dry-run.
- `_probe-*` / `_q*` / `_smoke*` / `_verify*` = throwaway (diagnóstico), no commitear.
- One-off ya aplicados (backfill, relink, tag, fix-*, retag-om-business, etc.): no re-correr.

## Pendientes
- **MEDIOS: ✅ HECHO (2026-06-30).** (#1) `buildCardDebt` agrupa por clave canónica `bankCode:last4` del ACCOUNT + neteo por `cardAccountId`. (#2) Panel de Tarjetas muestra la deuda REAL (`buildCardDebt`), casada por identidad, total deduplicado por `cardKey`; sin cartola/ambiguo → "—". `USD_CLP` centralizado en `@/domain/debt`. (#3) Modelo IVA "neto + aparte": el flujo va en NETO, el IVA nunca se resta (se quitó `buildVatProjectionTransactions` de `buildCashFlowFinancialTransactions`, mataba el doble-descuento), semanal usa `netAmount`, tarjeta "IVA a separar", fechas TZ-safe con `toLocalIsoDate`.
- **Follow-ups del modelo IVA (decisión de Pancho pendiente):**
  - **Simetría de proyección:** Flujo de Caja ya es neto puro, pero la PROYECCIÓN mensual de Resumen/P&L (`combineFinancialTransactions` → `projectedEndingBalance`) todavía resta el IVA como `plannedExpense`. El saldo REAL de Resumen ya lo excluye (isExecutedTransaction filtra planned). Definir si la proyección mensual también deja de restar IVA (toca `combineFinancialTransactions`, blast radius overview+pnl+monthly-balances).
  - **Opening neto estricto:** el semanal parte del saldo bancario real (bruto). Si se quiere "caja usable neta" estricta, el opening de business/all debería descontar el IVA a separar. Diferido.
- **DATOS a limpiar:** 10 categorías duplicadas (items referencian `categoryId`, cuidado al deduplicar); 3 transferencias incompletas (sin origen/destino); 8 tx ejecutadas sin cuenta; 1 pago de tarjeta sin `cardAccountId`.
- **F5 (seguridad, opcional):** proteger endpoints IA (`/api/extract-pdf`, `/api/extract-receipt`, `/api/advisor`) con token Firebase + UID + rate limit (hoy sin auth → riesgo de costo, no de datos porque la base ya está cerrada).
- **Saldo Cuenta Corriente OM en $0** (real o desactualizado): si Octopus tiene caja, actualizarlo en Cuentas para que la alerta sea fiel.

## Roadmap acordado (2026-06-30, dirección de Pancho)
Orden de bloques fuertes. **No abrir frentes nuevos en paralelo.**
1. **DATOS (en curso ahora):** limpiar categorías duplicadas + transferencias incompletas. Baja ruido antes de construir métrica nueva.
2. **Captura diaria + cartola sin duplicados** (el próximo bloque fuerte tras DATOS). Alcance decidido 2026-06-30:
   - **Subcategoría (item) en la captura — decisión de Pancho: COMPLETO.** Hoy el importador solo captura ámbito + categoría, NO subcategoría; la captura manual (quick-expense) sí. Resultado: 1% de los gastos tiene itemId (0% de los 243 importados). Como los presupuestos se llevan a nivel item, el "sobrante/faltante" por subcategoría está ciego. Plan (el MOTOR de sugerencia es uno solo, sirve para ambos sentidos):
     - (a) selector de subcategoría en el importador (import-data.tsx).
     - (b) **motor de auto-sugerencia de item** por comercio + categoría (IA/reglas, que aprende). Es el corazón del bloque.
     - (c) **puesta al día de los ~247 históricos = automática por IA, Pancho SOLO acepta el lote** (NO revisa uno a uno). La categoría ya está puesta → la IA solo elige el item dentro de esa categoría; alta cobertura esperable. Se corre como script asistido por IA (patrón categorize-ai de bank-bot) con dry-run → Pancho aprueba → apply con backup/manifest. Lo que la IA no logre con confianza queda sin item (no se inventa).
   - **Cartola sin duplicados:** que la plata entre sola y bien, sin duplicados que revisar a mano.
   - Antes de tocar código: diagnóstico read-only + plan verificado con Codex.
3. **Sobrante/faltante consolidado.**
4. **"Mes Financiero"** (recién después de 2 y 3).
- Los 2 follow-ups de IVA (simetría de proyección Resumen/P&L + opening neto estricto) quedan **estacionados como decisión fina, NO como bloqueo**.

## Gotchas
- La apiKey web NO es secreto (viaja en el bundle); la seguridad son Auth + reglas.
- El server NO lee `.env.local` → usa el default hardcodeado de `server/index.ts` (por eso el bug de la key). En prod manda el env de Railway.
- Cloud Chrome (browser agent) mintió reportando pasos no hechos → SIEMPRE verificar en disco / Admin SDK lo que reporta.
- Reglas cerradas: cualquier script con config pública SIN auth rompe → usar `getAuthedDb`.
- Firestore Lite adjunta el token si Auth está en la MISMA app + hay signIn.
- `MarkdownRenderer` de otros proyectos OM no soporta tablas/blockquotes (no aplica acá, pero es patrón OM).
- Reiniciar el dev server: matar TODO en el puerto (`lsof -ti :PORT | xargs kill -9`) antes de arrancar (EADDRINUSE si queda el viejo). El server NO recarga `.env`/`server/index.ts` sin reinicio.
