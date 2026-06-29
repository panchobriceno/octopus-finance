# ARCHITECTURE.md — Referencia detallada de Octopus Finance

> Este es el "manual de la casa" técnico: cómo funciona cada cosa de la app. Está pensado para que
> un asistente de IA pueda responder dudas **sin tener que releer el código cada vez**, y como
> referencia profunda cuando el `CLAUDE.md` (que es la guía corta de cómo trabajar) no alcanza.
>
> Existe un gemelo de este documento en lenguaje de negocio para el dueño (Google Doc
> "Manual Octopus Finance", copia local en `docs/MANUAL_OCTOPUS_FINANCE.md`). **Si el código cambia,
> actualizar ambos.**
>
> Fuente: lectura completa de `client/src/lib/`, `client/src/domain/`, `client/src/pages/`,
> `shared/schema.ts` (junio 2026).

## Glosario de campos y enums (la "gramática" de los datos)

Todo en la app gira alrededor del objeto **Transaction**. Casi cada cálculo primero normaliza la transacción
(rellena defaults) y luego le pregunta "¿cómo impactás la caja / la deuda / el ingreso?".

### Transaction
- **`type`** `income | expense` — clasificación legacy/contable. Se mantiene por compatibilidad.
- **`movementType`** `income | expense | transfer | credit_card_payment` — la clasificación **real** que usan los cálculos.
  - `transfer` = movimiento entre dos workspaces/cuentas (sale de uno, entra al otro).
  - `credit_card_payment` = pago de la deuda de una TC desde la caja. Nunca es income.
- **`paymentMethod`** `cash | bank_account | credit_card` — determina si impacta la caja **ahora** (`cash`/`bank_account`) o **después** (`credit_card` = genera deuda).
- **`status`** `pending | paid | cancelled`.
  - `pending` = aún no liquidado (compra en TC sin pagar, cheque por cobrar).
  - `cancelled` = excluido de TODOS los cálculos.
- **`subtype`** `actual | planned`.
  - `actual` = ocurrió de verdad (registro manual o importado).
  - `planned` = proyección a futuro (presupuesto, cuota futura, IVA proyectado).
- **`workspace`** `business | family | dentist` (+ `shared` opcional). Aísla todo por contexto.
- **`installmentCount`** `null | número` — cantidad de cuotas si es compra en TC.
- **Campos de transferencia:** `destinationWorkspace`, `destinationAccountId` (preferir el ID; el workspace de texto es legacy).
- **Campos de linaje (auto-generación):** si están presentes, la transacción fue **generada automáticamente** por otro registro:
  - `sourceClientPaymentId` → nació de un ClientPayment. **Se excluye de income/expense brutos** para no doble-contar.
  - `sourceCommitmentInstanceId` / `sourceCommitmentTemplateId` → nació de pagar un compromiso recurrente.
  - `importBatchId` / `importBatchLabel` / `importedAt` → nació de convertir un movimiento importado.
- **`itemId`** → subcategoría (Item). La categoría "real" sale de `item.categoryId`.

### ClientPayment (ingresos de clientes)
- **`status`** flujo estricto: `projected → receivable → invoiced → paid` (o `cancelled`).
- **Montos:** `netAmount + vatAmount = totalAmount` (la auditoría flaggea si no cuadra). IVA chileno = 19% del neto.
- **Fechas:** `issueDate`, `dueDate`, `expectedDate`, `paymentDate`. La "fecha de referencia" para timing se elige en `getClientPaymentReferenceDate`: si está `paid` → `paymentDate`; si no → `expectedDate ?? dueDate ?? issueDate`.

### Otros enums
- **Account.type** `checking | savings | credit_card`.
- **CommitmentTemplate.amountMode** `fixed | variable`; `frequency` siempre `monthly` por ahora.
- **CommitmentInstance.status** `pending | paid | skipped`.
- **ImportedMovement.status** `pending → converted | reconciled | discarded | duplicate`.
- **ImportBatch.status** `reviewing → partially_converted | completed | closed`.

## Lógica de negocio fina (`client/src/lib/finance.ts` salvo nota)

La regla mental: **dos funciones lo gobiernan todo** — `normalizeTransaction` (rellena defaults) y
`getTransactionCashFlowImpact` (traduce cualquier movimiento a "+X / -X / 0 sobre la caja del workspace").

### Normalización y clasificación
- **`normalizeTransaction(tx)`** — defaults: workspace `business`, subtype `actual`, status `paid`, movementType derivado de `type`, paymentMethod `bank_account`. Todo cálculo usa transacciones normalizadas.
- **`isExecutedTransaction(tx)`** — "ocurrió de verdad" si `subtype ≠ planned` y `status ≠ cancelled`, **O** es compra en TC `pending` (la compra es real aunque no se haya pagado).
- **`isPlannedTransaction(tx)`** — `subtype = planned` y `status ≠ cancelled`.
- **`affectsWorkspace(tx, ws)`** — true si `ws = "all"`, o `tx.workspace = ws`, o `tx.destinationWorkspace = ws`.

### Impactos (el corazón)
- **`getTransactionCashFlowImpact(tx, ws)`**:
  - `transfer`: en `all` → 0 (se cancela); si origen = ws → `-amount`; si destino = ws → `+amount`.
  - `income` → `+amount`.
  - `credit_card_payment` → `-amount` (sale plata de caja).
  - `expense`: si `paymentMethod = credit_card` → **0** (no toca caja todavía); si no → `-amount`.
- **`getTransactionIncomeImpact` / `getTransactionExpenseImpact`** — suman income/expense reales, **excluyendo** los generados desde ClientPayment (`sourceClientPaymentId`) y los fuera del workspace.
- **`getTransactionCreditCardDebtImpact(tx, ws, accounts)`** — compra en TC → `+amount` (deuda sube); `credit_card_payment` → `-amount` (deuda baja). Si hay `accounts`, matchea la TC por nombre normalizado para asignar workspace; si no, cae al workspace de la transacción.

### Cuotas de tarjeta
- **`splitInstallments(amount, count)`** — `base = floor(amount/count)`, el **residuo va en la última cuota**. Ej: 100.000 en 3 → `[33.333, 33.333, 33.334]`.
- **`buildCreditCardInstallmentProjectionTransactions(txs)`** — toma las compras reales en TC (`expense + credit_card + actual + paid + installmentCount ≥ 1`) y genera una transacción **planned/pending** por cada cuota: id `${txId}-installment-${n}`, categoría fija `"Cuota Tarjeta"`, `movementType = credit_card_payment`, `paymentMethod = bank_account`, fecha = original + n meses. Así las cuotas bajan el cash flow proyectado de los meses futuros.

### Ingresos de cliente → transacciones
- **`clientPaymentToIncomeTransaction(payment)`** — `cancelled` → null. Genera income por el **neto** (no el total), workspace fijo `business`, categoría `"Ingresos Clientes"`, con `sourceClientPaymentId`. Si está `paid` → `actual/paid` en `paymentDate`; si no → `planned/pending` en la fecha de referencia.
- **`buildVatProjectionTransactions(payments)`** — por cada pago `paid`, acumula el IVA por mes y crea una transacción planned `"IVA por pagar"` con fecha = **día 20 del mes siguiente** (obligación fiscal proyectada que baja la caja).
- **`summarizeClientPaymentsByMonth(payments)`** — agrupa por mes en `{net, vat, gross, paidNet, paidVat, paidGross}` (esperado vs efectivamente cobrado).

### Agregación mensual y proyección diaria
- **`buildMonthlySummaries(txs, openingBalances, ws)`** — por mes: parte del `openingBalance`, suma impactos. `realEndingBalance = opening + realIncome - realExpenses`; `projectedEndingBalance = realEndingBalance + plannedIncome - plannedExpenses`. Marca `hasRealData` / `hasPlannedData` (de ahí los badges "Real / Solo proyección / Mixto").
- **`buildDailyProjectionData(...)`** — balance día a día del mes. En el mes actual, los días **futuros** dejan `realBalance = null` (no se sabe) y solo proyectan. De acá sale la línea sólida (ejecutado) vs punteada (proyectado) del gráfico de Cash Flow.

### Saldos mensuales (`client/src/lib/monthly-balances.ts`)
- Mapa `monthKey → saldo inicial` cacheado + persistido en Firestore, con broadcast por evento `octopus-monthly-balance-updated` (sincroniza pestañas).
- **`autoCarryForwardOpeningBalance(monthKey)`** — si el mes no tiene saldo inicial, lo infiere del `realEndingBalance` del mes anterior (recursivo hacia atrás, con guardia anti-ciclos). Se dispara al arrancar la app (`App.tsx` useEffect).
- Incluye migración legacy `localStorage → Firestore` (one-time).

### Cuentas y reconciliación (`client/src/domain/`)
- **`getAccountBalanceBreakdowns(accounts, txs)`** (`domain/accounts.ts`) — por cuenta: `reconciledBalance = bankBalance + ledgerDelta` (suma de impactos ejecutados en esa cuenta). `difference = reconciled - bank`. Si ≠ 0 → falta registrar o hay error.
- **`getAvailableCashBalance` / `getOperatingCashBalance` / `getSavingsBalance`** — suman checking+savings / solo checking / solo savings (cuentas activas).
- **Conciliación** (`domain/reconciliation.ts`): `scoreReconciliationCandidate` puntúa monto (≤1 CLP exacto=38) + fecha (mismo día=26) + toca cuenta (+14) + tipos compatibles (+12) + similitud de texto (+8/+14). Umbral 45; ≥84 = "confident_match". Las TC no se concilian (no tienen cartola en este flujo).

### Importación de cartolas (`domain/bank-imports.ts`)
- **`buildMovementDedupeKey`** — huella única (fuente + fecha + dirección + monto×100 + descripción) para detectar duplicados dentro del lote.
- **`findBestMovementRule` / `applyMovementRule`** — reglas de auto-clasificación por keywords; `score = nº keywords × 20 + priority`. Suben `confidence` (cap 88).
- **`buildTransactionFromImportedMovement`** — compras en TC quedan `pending`; el resto `paid`.

### Automatización mensual (`domain/commitments.ts`)
- Plantilla (`CommitmentTemplate`) → instancias mensuales (`CommitmentInstance`).
- **`buildMissingCommitmentInstances`** — genera las que falten para el mes (status `pending`).
- **`findCommitmentMatches`** — auto-vincula transacciones a compromisos pendientes. Scoring: cuenta/TC exacta +20 c/u, keywords +25, monto exacto +25 (o similar dentro de tolerancia +20), fecha exacta +15 (decae con distancia). Umbral 25, asignación greedy.
- **`buildCommitmentDashboard`** — total/pending/paid/skipped/overdue + `coveragePct`.

### Auditoría y reparación (`domain/finance-audit.ts`, `domain/repair-plans.ts`)
- **`auditFinanceData`** — detecta 100+ problemas (categorías duplicadas, items huérfanos, montos/fechas inválidas, transferencias sin destino, neto+IVA≠total, pagos sin settlement, presupuestos a categorías inexistentes, diferencias de conciliación >1 CLP, etc.). Devuelve `issues[]` con `severity` (critical/high/medium/low).
- **`buildMergeDuplicateCategoriesPlan`** — consolida categorías duplicadas (reasigna items/transacciones/budgets/commitments/rules a la principal, borra duplicadas). Operación atómica.
- **`buildBrokenReferencesPlan`** — crea categorías faltantes y limpia referencias rotas.

## Capa de datos: hooks y Firestore

- **`client/src/lib/firestore.ts`** — todo el CRUD (Firestore Lite, sin persistencia offline → de ahí el patch anti-IndexedDB del build).
- **`client/src/lib/hooks.ts`** — **~75 hooks de React Query**. Convención: `useX()` = lectura (query), `useCreateX/useUpdateX/useDeleteX()` = escritura (mutation). En `onSuccess`, cada mutation hace `invalidateQueries` de su key (y de las relacionadas: ej. pagar un ClientPayment invalida `client-payments` **y** `transactions`; merge de categorías invalida 8 keys en cascada).
- Mutaciones complejas (convertir movimiento importado, pagar compromiso) usan `runTransaction` de Firestore para atomicidad.

### Colecciones Firestore (15)
`transactions`, `categories`, `items`, `budgets`, `accounts`, `credit_card_settings`, `clientPayments`, `clients`, `openingBalances`, `commitmentTemplates`, `commitmentInstances`, `monthlyCloseSnapshots`, `importBatches`, `importedMovements`, `movementRules` + el doc `preferences/dashboard`.

> Nota: el CLAUDE.md original lista 9 colecciones "core" de negocio; las otras 6 son del pipeline de importación, automatización y cierre. Las 15 son reales y están en uso.

### Capa server/Express — legacy
`server/routes.ts` + `server/storage.ts` (MemStorage en memoria) **no se usan en el flujo normal**: el cliente habla directo con Firestore. Las rutas `/api/*` sobreviven solo para extracción de PDFs/vouchers (Claude OCR) desde el wizard de importación. Para entender el flujo de datos del día a día, ignorar Express.

### Arranque y routing
- `main.tsx` fuerza hash mode (`#/`) y montea `<App />`.
- `App.tsx`: `QueryClientProvider` → `Router` (wouter hash) → dispara `autoCarryForwardOpeningBalance` → layout sidebar + `<AppRouter>`. Globales: `CommandPalette` (⌘K), `GlobalImportWizard`, `QuickExpenseCapture` (⌘J).

## Las secciones (páginas) — qué hace cada una

Rutas hash en `client/src/pages/` (vía `wouter`):

| Ruta | Página | Qué resuelve |
|---|---|---|
| `/` | overview | Dashboard ejecutivo: "¿cuánta plata tengo y qué hago?". Caja disponible, neto tras deuda TC, IVA a separar, por cobrar, alertas, pulso por workspace, KPI cards arrastrables (preferencias en Firestore). |
| `/transactions` | transactions | Libro mayor: buscar/filtrar (mes, workspace, estado, categoría), editar, borrar en lote. Tope visual 200 filas. |
| `/cash-flow` | cash-flow | Proyección de caja diaria/semanal/mensual. Sólido=ejecutado, punteado=proyectado. Celdas semanales clickeables con detalle. Saldo inicial editable. |
| `/pnl` | pnl | Estado de resultados real vs presupuestado por categoría × mes, con varianza. |
| `/budget` | budget | Presupuesto mensual por categoría/item (recurrente, día del mes, drag-order). Cruza con ejecutado+comprometido. Maneja remanente empresa→familia + "ingreso Javi" (localStorage). |
| `/accounts` | accounts | Cuentas (saldo banco vs "según movimientos" vs diferencia). El saldo banco es input manual = verdad. |
| `/categories` | categories | Taxonomía income/expense. Income es workspace-agnóstico; expense se asigna a workspace. Set sugerido de familia. |
| `/items` | items-manager | Subcategorías colgadas de una categoría. |
| `/credit-cards` | credit-cards-panel | Deuda TC, compras del mes, pagos, **cuotas futuras proyectadas**, vinculación TC↔cuenta de pago. Solo lectura/gestión, no se "paga" desde acá. |
| `/client-payments` | client-payments | Facturación y cobros. IVA 19% automático. Marcar `paid` crea la transacción de ingreso (settlement). |
| `/reconciliation` | reconciliation | Aparear cartola importada vs registrado por cuenta+mes. Confirmar match, convertir, descartar, crear ajuste. |
| `/monthly-close` | monthly-close | Checklist de 7 ítems + snapshot congelable (presupuesto vs real). Cerrar bloquea; reabrir vuelve a datos vivos. |
| `/automation` | monthly-automation | Compromisos recurrentes: generar instancias del mes, conciliar (matching fuzzy), marcar pagado/omitido. |
| `/movements` | bank-movements | Bandeja de revisión de importados: clasificar, convertir (individual o "confiables ≥85%"), cerrar/rollback lote. |
| `/import` | (redirige a /movements + abre wizard) | Lanzador del wizard de importación. |
| `/data-health` | data-health | Auditoría de integridad + planes de reparación (merge categorías, fix referencias) con backup descargable. |
| `/settings` | settings | Branding (logo en localStorage), atajos, tarjetas guardadas. |

## Tres casos de flujo completos (para razonar rápido)

1. **Compra en TC en 12 cuotas** → se registra `expense/credit_card/pending`, no toca caja (`cashFlowImpact = 0`) pero sube deuda. Se proyectan 12 cuotas `planned/pending` en meses futuros. Al pagar, se registra un `credit_card_payment` que baja caja y deuda.
2. **Ingreso cliente con IVA** → al `invoiced` aparece income **planned** por el neto + IVA proyectado el día 20 del mes siguiente. Al `paid`, el income pasa a **real** en la fecha de pago.
3. **Transferencia business→family** → `-amount` en business, `+amount` en family, `0` en consolidado ("all").

## Cosas no obvias / gotchas
- **localStorage como verdad parcial:** "ingreso Javi" (budget), logo y lista de tarjetas (settings), ítems revisados de data-health, y saldo inicial editado viven en localStorage / eventos `window`, no siempre en Firestore. Ojo al documentar o migrar.
- **Linaje = no doble-contar:** transacciones con `sourceClientPaymentId` se excluyen de los totales brutos de income/expense a propósito.
- **Compras TC siempre `pending`** hasta el pago; la compra es "ejecutada" para reportes aunque esté pending (ver `isExecutedTransaction`).
- **El residuo de cuotas va en la última**, no se prorratea.
- **Firebase Lite a propósito** (sin offline) → no reintroducir `firebase/firestore` completo ni IndexedDB; el build los patchea.
