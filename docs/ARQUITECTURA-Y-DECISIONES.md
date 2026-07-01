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
   - **Cartola sin duplicados:** que la plata entre sola y bien, sin duplicados que revisar a mano. Dedup actual = `buildMovementDedupeKey` (sourceKey[accountId??creditCardName??bankName??sourceType]+date+direction+amount+description). Falla cuando accountId no se resuelve al importar (sourceKey inestable) o el banco cambia el texto.
   - **Orden verificado por Codex (2026-06-30) + reglas de seguridad:**
     1. **F4-diagnóstico** primero: por qué accountId llega vacío + medir duplicados reales (sin fuzzy aún).
     2. **F1** selector de subcategoría en importador + persistir itemId al convertir.
     3. **F2** `MovementRule.itemId?` (aditivo, schemaless; revisar tipos/validadores/export-import/UI de reglas) + `suggestedItemId` + aprende al aceptar/corregir.
     4. **F3** catch-up IA (después de que itemId esté soportado end-to-end): backup+dry-run+manifest {movementId, categoría, item, confianza, modelo/version}, idempotente, NO pisa itemId existente, umbral de confianza (bajo → sin item), nunca sugiere item fuera de la categoría fija.
     5. **F4-hardening**: estabilizar sourceKey (resolver accountId siempre) ANTES; fuzzy solo como "posible duplicado" con señales fuertes, NO auto-descarte (riesgo de falsos positivos: 2 compras iguales el mismo día, cuotas, comisiones).
     - **Prioridad del motor único:** regla manual con itemId > IA/lote > sugerencia por keyword > vacío. La categoría fija manda.
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

---

## Estado al cierre de sesión (2026-07-01) — cómo retomar

### En producción (deployado)
- **Seguridad** (login + reglas Firestore), **Resumen unificado**, **MEDIOS** (deuda real + modelo IVA neto + fechas TZ-safe + USD_CLP centralizado), **DATOS** (limpieza de 15 movimientos + Consulta Javi→dentist, es data, ya visible), **F1** (subcategoría en el importador), **F2 paso 1** (base auto-sugerencia).
- **Fix post-cierre (2026-07-01):** los cobros semilla `recurring-seed-*-2026-06` tenían expectedDate mal en 2026-07-05 → duplicaban el ingreso de julio ($8.26M→$4.13M). Se BORRARON los 9 de junio (decisión de Pancho: "junio ya se gastó, empezar limpios"), backup en `_manifest-del-june-*.json`. Julio = $4.130.000 (9 cobros). Label "Gastos del mes"→"Movimientos del mes". OJO: el generador de proyecciones recurrentes crea cobros con expectedDate mal fechado — revisar cuando se toque ese generador (para que agosto no vuelva a duplicar).
- Última verificación: P0 de integridad = 0; 0 duplicados de transacciones activos; ingreso julio $4.13M.

### Bloque CAPTURA — progreso (plan completo + orden más arriba en "Roadmap acordado")
- ✅ **F4-diagnóstico**: 0 duplicados activos; riesgo latente = accountId vacío al importar (sourceKey inestable). F4-hardening es preventivo, baja urgencia.
- ✅ **F1** (deployado): selector de subcategoría por fila en `import-data.tsx`; itemId viaja hasta `transaction.itemId`.
- ✅ **F2 paso 1** (COMMIT LOCAL `18276cf`, ver abajo): base de auto-sugerencia. `MovementRule.itemId?` (schema + zod + default), `applyMovementRule` con la regla como autoridad del item, helper único `applyBestMovementRule(movement, rules)` usado en el import batch, 4 tests. Sin cambio visible.
- ✅ **F2 paso 2** (deployado): **editor de reglas** (UI) en `data-health.tsx`. Lógica pura en `client/src/domain/movement-rules.ts` (resuelve nombre-categoría→id derivando type de movementType [income→income, resto→expense], `isRuleItemConsistent`/`sanitizeRuleItemId`, `parseRuleKeywords`), 19 tests. Componente `client/src/components/finance/movement-rules-editor.tsx`: lista+crear/editar/borrar, selector de subcategoría filtrado por categoría, reset de itemId al cambiar categoría/tipo/workspace. Validaciones: nombre+categoría obligatorios; regla activa exige ≥1 keyword (si no, muerta); guard tipo↔dirección contradictorios (si no, muerta); itemId inconsistente se **sanea a null** al guardar (no bloquea → reglas legacy editables), marcadas con ⚠ en la lista. Decisiones de alcance: workspace `shared` excluido (alinea con import); ruteo cuenta/tarjeta fuera de v1 (no se envía en update → se preserva el legacy). Plan pasado por Codex + revisor (P2 tipo↔dirección corregido).
- ⏭️ **F2 paso 3 (PRÓXIMA ACCIÓN)**: pre-relleno del preview del wizard usando `applyBestMovementRule`, **preservando correcciones humanas** (no re-aplicar reglas sobre campos ya tocados; trackear categoryTouched/itemTouched).
- **F2 paso 4**: aprendizaje en el wizard — al elegir/corregir subcategoría, ofrecer crear/actualizar regla con ese itemId. **Explícito, tú aceptas** (nunca silencioso; el falso positivo cuesta más con item). Keyword del comercio: reusar lógica de `generate-rules.ts` (normalizar, tokens ≥4, stopwords, excluir números/genéricos); dedupe por `keyword+amountDirection+movementType+paymentMethod`; `notes`="Aprendida desde wizard".
- **F2 paso 5**: agregar override `itemId` + selector de subcategoría en la bandeja (`bank-movements.tsx`, hoy `RowOverride` no tiene itemId) + aprendizaje ahí.
- Después de F2: **F3** (IA catch-up de los ~247 históricos, patrón `categorize-ai`, dry-run→aceptar lote→apply con backup) y **F4-hardening** (estabilizar sourceKey; fuzzy solo como "posible duplicado", no auto-descarte).

### Git al cierre
- `origin/main` = todo lo deployado. F2 paso 1 (`18276cf`) y paso 2 ya están en `origin/main`. Sin commits locales pendientes. Verificar con `git log origin/main..HEAD --oneline`.

### Estacionados (decisión fina, NO bloquean)
- Follow-ups IVA: (1) simetría de proyección en Resumen/P&L (`combineFinancialTransactions` aún resta IVA en `projectedEndingBalance`); (2) opening neto estricto en el semanal.
- 3 importaciones pendientes de categorizar en la bandeja.
- 1 cartola cosmética (7232 mayo: cupoUtilizado>cupoTotal).
- F5 seguridad: proteger endpoints IA (`/api/extract-pdf`, `/api/extract-receipt`, `/api/advisor`) con token + rate limit.
- **Validación de shape de `MovementRule` en la capa Firestore** (follow-up del revisor F2 paso 2): `createMovementRule`/`updateMovementRule` en `firestore.ts` hacen spread directo a `addDoc`/`updateDoc` sin pasar por `insertMovementRuleSchema` (ese zod es solo para las rutas Express legacy). Hoy no hay riesgo: el editor construye el shape correcto y es el único call-site UI. Pero es la única barrera contra un shape inválido si otro script escribe mal. Blindar validando con zod dentro de esas dos funciones. Bajo, no urgente.
- **Aviso de ruteo legacy en el editor de reglas** (P3 del revisor F2 paso 2): una regla legacy con `accountId`/`creditCardName`/`cardAccountId` editada + cambio de categoría cross-workspace mantiene el ruteo de cuenta fijo e invisible en el editor (`applyMovementRule` lo sigue forzando). No corrompe datos; puede rutear un movimiento a una cuenta heredada de otro ámbito. Fix: mostrar aviso read-only cuando la regla en edición trae esos campos. Bajo.

### Cómo retomar (pegar en la próxima sesión)
> "Retomamos octopus-finance. Lee `docs/ARQUITECTURA-Y-DECISIONES.md`, sección 'Estado al cierre de sesión (2026-07-01)'. Vamos con **F2 paso 2 (editor de reglas)**: construir la UI para crear/editar MovementRule con selector de subcategoría (item filtrado por su categoría), reusando los hooks `useCreateMovementRule`/`useUpdateMovementRule` ya existentes, validando consistencia item↔category. Primero pasa el plan por Codex, después implementá con dry-run/tests/revisor como siempre. Antes: `git log origin/main..HEAD` para ver que el commit local `18276cf` (F2 paso 1) siga ahí, y si no está deployado, subilo junto con el paso 2."
