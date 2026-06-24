# Revision exhaustiva de logicas por seccion - Octopus Finance

Fecha: 2026-06-23

## Resumen

La app tiene una base funcional, pero las reglas financieras estan distribuidas entre pantallas. Esto hace que distintas secciones respondan preguntas parecidas con criterios distintos. La optimizacion mas importante no es visual: es crear un nucleo de dominio unico para clasificar movimientos, calcular impactos, validar inputs y decidir estados.

Reglas que deben tener una sola fuente de verdad:

- Que significa `paid`, `pending`, `planned`, `actual` y `cancelled`.
- Como impacta una transaccion en caja, P&L, deuda TC, presupuesto y cuentas.
- Como se modela una transferencia entre cuentas.
- Como se modela una compra con tarjeta, sus cuotas y el pago de la tarjeta.
- Como se calcula ingreso cliente: neto, IVA, bruto, pagado, devengado y proyectado.
- Como se decide workspace: `business`, `family`, `dentist`, `shared`.
- Cual es el saldo inicial de mes: cuentas reales, saldo manual mensual o carry-forward.

## 0. Modelo compartido y persistencia

### Logica actual

- `client/src/lib/finance.ts` clasifica impactos de transacciones, virtualiza ingresos cliente, crea proyecciones de IVA y cuotas.
- `client/src/lib/firestore.ts` lee colecciones completas y escribe documentos sin validacion estricta.
- `shared/schema.ts` tiene interfaces y Zod, pero los schemas son permisivos y el cliente escribe con `Record<string, any>`.
- Algunas migraciones/fixes ocurren durante lectura, por ejemplo `fixRecurringBudgetTransactionLabels()` en `getTransactions()`.

### Riesgos

- Las pantallas pueden guardar datos validos para TypeScript pero invalidos para el negocio.
- Firestore queda como "bolsa de documentos" sin garantia de invariantes.
- Los calculos cambian segun la pantalla que se abra.
- Lecturas completas de colecciones no escalan.
- Batches como `generateMonthlyRecurringTransactions()` y `regularizeClientPayments()` pueden superar limite Firestore de 500 writes.

### Optimizacion recomendada

Crear carpeta de dominio:

- `client/src/domain/money.ts`: parseo, redondeo CLP, IVA, limites.
- `client/src/domain/transactions.ts`: normalize, classify, impacts, status rules.
- `client/src/domain/accounts.ts`: ledger por cuenta, transferencias, saldos calculados.
- `client/src/domain/client-payments.ts`: pipeline de estados y settlement.
- `client/src/domain/budgets.ts`: presupuesto efectivo, recurrencia, matching por categoria/item.
- `client/src/domain/credit-cards.ts`: compra TC, pago TC, cuotas, deuda, fechas de vencimiento.
- `client/src/domain/monthly-close.ts`: snapshot mensual.
- `client/src/domain/imports.ts`: parser/dedupe puro.

Mover Zod a schemas estrictos:

- `amount: z.number().finite().positive()` donde corresponda.
- enums reales para `type`, `subtype`, `status`, `workspace`, `movementType`, `paymentMethod`.
- fechas `YYYY-MM-DD` validadas.
- strings con trim y max length.

## 1. Resumen / Movimientos (`overview.tsx`)

### Logica actual

- Usa `combineFinancialTransactions()` para mezclar transacciones reales, ingresos cliente virtuales, IVA proyectado y cuotas proyectadas.
- Calcula KPI de balance como `totalIncome - totalExpenses`.
- Calcula caja por workspace con `summarizeWorkspaceTransactions()`.
- Usa saldo inicial desde cuentas no-savings (`accounts.currentBalance`) para el card de apertura.
- Permite crear transacciones, pagos TC, transferencias internas, edicion masiva, pago de pendientes y delete.
- Limita tabla a 50 transacciones visibles.

### Riesgos

1. Balance principal mezcla conceptos.
   - `balance = totalIncome - totalExpenses` es resultado economico, no caja.
   - En la misma pantalla se muestran `cashFlow`, deuda TC, apertura mensual y caja sin IVA.
   - Optimizar nombre: separar `Resultado del mes`, `Caja disponible`, `Deuda TC`, `Forecast`.

2. Transferencia entre cuentas esta mal modelada.
   - `handleCreateInternalMovement()` guarda `destinationWorkspace: destinationLabel`.
   - `finance.ts` espera que `destinationWorkspace` sea un workspace (`business`, `family`, `dentist`) para sumar transferencias.
   - `accounts.tsx` intenta matchear transferencias entrantes con `tx.destinationWorkspace === account.name`, pero se guarda `accountDisplayName(account)` (`name - bank`).
   - Resultado probable: descuenta del origen, pero no suma confiablemente al destino.

3. Validacion de monto insuficiente.
   - Create/edit usan `parseFloat(formData.amount)`.
   - Confirmar pago usa `Number(payDialog.amount || payDialog.tx.amount)`.
   - Falta `Number.isFinite`, `> 0`, limites y mensajes por campo.

4. Compras TC tienen una regla UI, no una regla de dominio.
   - La UI fuerza compras TC nuevas a `pending`.
   - `finance.ts` considera compras TC `pending` como ejecutadas.
   - Pero la proyeccion de cuotas exige `status === "paid"`.

5. Filtro por cuenta elimina transacciones virtuales de clientes.
   - `filteredFinancialTransactions` filtra por `accountId`.
   - Los ingresos cliente virtuales no tienen accountId; si se filtra por cuenta, desaparecen.

### Optimizacion recomendada

- Dividir `Resumen` y `Movimientos`.
- Agregar `destinationAccountId` al schema de transacciones.
- Crear `createTransfer({ sourceAccountId, destinationAccountId, amount })` en dominio.
- Crear `validateTransactionDraft()` y usarlo en create/edit/pay.
- Renombrar KPI segun base: caja, devengado, forecast.
- No limitar silenciosamente a 50; mostrar paginacion o indicador claro.

## 2. Flujo de Caja (`cash-flow.tsx`)

### Logica actual

- Usa `buildMonthlySummaries()` para mensual.
- Usa `buildDailyProjectionData()` para grafico diario.
- Usa una tabla semanal propia:
  - apertura = suma de `accounts.currentBalance`.
  - ingresos cliente = pagos `receivable/projected/invoiced`.
  - gastos planificados = transacciones planned pending no credit card.
  - tarjetas pendientes = compras TC pending por fecha de compra.

### Riesgos

1. Dos fuentes de saldo inicial.
   - Mensual usa `useOpeningBalance(selectedMonth)`.
   - Semanal usa `totalAccountsBalance` desde cuentas.
   - Resumen usa otra suma de cuentas.
   - Esto puede dar tres respuestas distintas para "saldo inicial".

2. Tarjetas se restan por fecha de compra, no por fecha de pago.
   - En caja, una compra TC no deberia bajar banco hasta vencimiento/pago.
   - La tabla semanal resta `pendingCreditCard` dentro de la semana de compra.

3. Ingreso cliente semanal usa bruto.
   - `amount: payment.totalAmount`.
   - Otros calculos de negocio usan neto e IVA separado.
   - Es valido si se mira cash-in bruto, pero debe mostrar IVA comprometido como salida futura.

4. `totalAccountsBalance` incluye todas las cuentas.
   - No filtra savings ni credit_card.
   - Si una tarjeta esta como cuenta, puede contaminar caja.

### Optimizacion recomendada

- Definir `CashBasis`:
  - `bank_cash`: solo bancos/caja.
  - `operational_cash`: bancos menos IVA comprometido.
  - `forecast_cash`: bancos + cobros esperados - pagos esperados.
- Crear `buildCashForecast({ accounts, transactions, clientPayments, creditCardStatements })`.
- Para TC, usar fecha de vencimiento o pago esperado, no fecha de compra.
- Mostrar bruto/neto/IVA como columnas separadas.

## 3. Estado de Resultados (`pnl.tsx`)

### Logica actual

- Combina transacciones reales y virtuales.
- Agrupa por mes y categoria.
- Usa `getTransactionIncomeImpact()` y `getTransactionExpenseImpact()`.
- Separa real vs planned por `isExecutedTransaction()` e `isPlannedTransaction()`.

### Riesgos

1. Presupuesto aparece solo si existen transacciones planned.
   - Si un presupuesto existe pero no se genero compromiso, P&L no lo muestra.

2. P&L depende de categoria string.
   - Si se renombra categoria, historico puede quedar fragmentado.

3. Workspace con transferencias no entra bien.
   - P&L filtra por `normalizeTransaction(tx).workspace === workspace`, no por `affectsWorkspace()`.
   - Para P&L esta bien excluir transferencias, pero hay que hacerlo explicitamente por regla, no por accidente.

4. Concepto de gasto TC.
   - P&L incluye compra TC como gasto economico, correcto.
   - Flujo de caja no deberia hacerlo igual; hoy algunas secciones mezclan esos criterios.

### Optimizacion recomendada

- Crear `buildPnlModel({ transactions, clientPayments, budgets, basis })`.
- Permitir `basis = actual | planned | actual_vs_budget`.
- Agrupar por `categoryId/itemId` cuando exista, con fallback a nombre.
- No depender de compromisos generados para mostrar presupuesto.

## 4. Ingresos Clientes (`client-payments.tsx`)

### Logica actual

- Estados: `projected -> receivable -> invoiced -> paid` y `cancelled`.
- Calcula IVA con `Math.round(net * 0.19)`.
- Si se marca como `paid`, abre draft para elegir cuenta y crea/sincroniza transaccion de settlement.
- Summary suma neto/IVA/bruto de todos los no cancelados.
- Filtro mensual usa `dueDate`.

### Riesgos

1. No hay maquina de estados.
   - UI permite saltar entre cualquier estado.
   - `paid -> receivable` borra transacciones vinculadas.
   - `cancelled -> paid` es posible sin decision explicita.

2. Filtro mensual incompleto.
   - Usa `dueDate`.
   - Pagos reales deberian poder filtrarse por `paymentDate`.
   - Servicios podrian filtrarse por `serviceMonth`.

3. Summary mezcla forecast y real.
   - `totalNet/totalVat/totalGross` suma todo no cancelado.
   - Para cierre real se necesita `paidNet/paidVat/paidGross`.

4. IVA y montos invalidos.
   - Falta validacion finite/positivo.
   - Marcar pagado convierte NaN a `0`.

5. Cuenta default hardcodeada.
   - `findDefaultSantanderOmAccount()` busca "santander om".
   - Deberia ser preferencia configurable.

6. Regularizacion puede fallar en volumen.
   - `regularizeClientPayments()` usa un batch unico.
   - Si hay mas de 500 writes, Firestore falla.

### Optimizacion recomendada

- Crear `clientPaymentStateMachine`.
- Separar acciones: `facturar`, `marcar pagado`, `anular`, `reabrir`.
- Confirmar acciones destructivas: revertir pagado, anular pagado.
- Crear `createSettlementTransaction(payment, accountId)` con validacion.
- Configurar cuenta default por workspace/cliente, no por nombre.
- Distinguir filtros: `periodo servicio`, `vencimiento`, `fecha pago`.

## 5. Presupuesto (`budget.tsx`)

### Logica actual

- Presupuesto por `categoryGroup`, que puede ser nombre de categoria o `item:<id>`.
- Busca presupuesto exacto del mes; si no, trae historico anterior como efectivo.
- Calcula ejecutado por transacciones actual del mes.
- Calcula comprometido por transacciones planned pending.
- Genera compromisos recurrentes desde presupuestos del mes anterior.
- Mantiene `Ingreso Javi` en localStorage.

### Riesgos

1. Loop de render vivo.
   - Efecto de sincronizacion de inputs devuelve objetos nuevos aunque no cambien.

2. Ejecutado incluye cancelados.
   - `periodTransactions` no filtra `status !== "cancelled"`.

3. Matching por categoria/item es fragil.
   - Si una transaccion tiene `itemId`, se agrupa por categoria, excepto cuando hay budget de item visible.
   - Esto cambia el resultado segun si la fila esta visible o no.

4. Recurrencia solo mira mes anterior.
   - Si marzo tenia recurrente y abril no se genero, mayo no lo toma.
   - Deberia usar ultimo presupuesto recurrente efectivo.

5. Generacion recurrente crea transacciones, no budgets.
   - "Presupuesto" y "compromiso" quedan mezclados.

6. Batch unico sin guard.
   - `generateMonthlyRecurringTransactions()` usa un `writeBatch` unico.

7. Ingreso familiar local.
   - `familyIncomeJavi` vive en localStorage.
   - `monthly-close` no lo usa, por lo que cierre y presupuesto divergen.

### Optimizacion recomendada

- Separar entidades:
  - `BudgetLine`: plan mensual.
  - `Commitment`: obligacion/pago esperado generado desde recurrencia.
  - `Actual`: movimiento ejecutado.
- `buildBudgetModel({ budgets, transactions, categories, items, month, workspace })`.
- `getEffectiveBudgetLine()` por categoria/item estable, no segun visibilidad.
- Recurrencia desde ultimo presupuesto recurrente efectivo.
- Persistir ingreso familiar mensual en Firestore.
- Arreglar loop y DOM invalido con DnD fuera de `tbody`.

## 6. Cierre Mensual (`monthly-close.tsx`)

### Logica actual

- Calcula presupuesto business/family con funcion propia.
- Calcula actual por transacciones ejecutadas.
- Usa `summarizeClientPaymentsByMonth()`.
- Calcula remanente empresa y saldo familiar.

### Riesgos

1. Usa logica de budget distinta a `budget.tsx`.
   - No considera `item:<id>` igual.
   - Usa fallback de categorias familiares hardcodeado.

2. "Real" usa `businessIncome.net`.
   - `net` incluye todos los pagos no cancelados, no solo pagados.
   - Para cierre real deberia usar `paidNet`.

3. No usa ingreso familiar local.
   - `budget.tsx` usa `familyIncomeJavi`.
   - `monthly-close.tsx` usa solo transacciones de ingreso familiar.

4. No hay cierre persistido.
   - No guarda snapshot, estado cerrado, diferencias, notas o aprobacion.

### Optimizacion recomendada

- Crear `MonthlyCloseSnapshot`.
- Permitir modo `cash` y modo `accrual`.
- Reusar `buildBudgetModel()` y `buildClientPaymentSummary()`.
- Guardar cierre con totals, diferencias y fecha de cierre.
- Agregar checklist: importaciones completas, ingresos conciliados, tarjetas conciliadas, presupuesto revisado.

## 7. Panel de Tarjetas (`credit-cards-panel.tsx`)

### Logica actual

- Tarjetas vienen de localStorage y transacciones.
- Config de cuenta default viene de Firestore `credit_card_settings`.
- Deuda = compras TC ejecutadas - pagos TC.
- Cuotas futuras se generan virtualmente desde compras con `installmentCount`.
- Se puede eliminar import batch y borrar cuotas futuras.

### Riesgos

1. Dos fuentes para tarjetas.
   - `settings.tsx` guarda nombres en localStorage.
   - `credit_card_settings` guarda cuenta default en Firestore.
   - Esto puede dejar tarjetas en una fuente y no en la otra.

2. Cuotas futuras solo nacen de compras TC `paid`.
   - Importacion y UI guardan compras TC como `pending`.
   - Resultado: cuotas futuras pueden no aparecer.

3. Borrar cuotas futuras borra compra base.
   - `handleBulkDeleteFuture()` transforma cuotas seleccionadas a source transaction ids.
   - Si seleccionas una cuota, borra la compra base completa.

4. Fecha de cuotas usa fecha de compra + meses.
   - No modela fecha de facturacion/vencimiento de cada tarjeta.

### Optimizacion recomendada

- Crear entidad `CreditCard`.
- Crear entidad `CreditCardStatement` con cierre/vencimiento.
- Compra TC debe generar schedule de cuotas por statement.
- Pago TC debe asociarse a statement y cuenta origen.
- Eliminar cuota futura deberia editar schedule o excluir cuota, no borrar compra base sin confirmacion fuerte.

## 8. Importar Datos (`import-data.tsx`)

### Logica actual

- Parser CSV/PDF vive dentro de la pagina.
- Detecta headers, fecha, monto, cuotas.
- Para tarjeta detecta compra, pago TC y reversa.
- Dedupe por `date__name__type__amount`.
- Guarda importBatchId/importedAt/importBatchLabel.
- Puede enriquecer pagos TC duplicados agregando `accountId`.

### Riesgos

1. Parser demasiado acoplado a UI.
   - 1500+ lineas de logica dentro de una pagina.
   - Dificil testear bancos/cartolas sin navegador.

2. Dedupe heuristico.
   - Rechaza duplicados exactos legitimos.
   - Deja pasar duplicados con nombre levemente distinto.

3. Row id por index.
   - Si se elimina/filtra/reordena, puede preservar estado incorrecto.

4. Signos de tarjeta dependen de heuristicas.
   - El signo no define ingreso/gasto para TC, lo cual es correcto, pero necesita tests por banco.

5. Importacion no usa transaccion Firestore atomica por batch completo.
   - Si parte falla, puede quedar importacion parcial.

### Optimizacion recomendada

- Extraer `imports/parser.ts`, `imports/dedupe.ts`, `imports/credit-card-detector.ts`.
- Crear fixtures de cartolas reales anonimizadas.
- Guardar `sourceFingerprint` por fila.
- Dedupe por fingerprint + similitud revisable.
- Crear pantalla de "revision de duplicados" antes de importar.
- Guardar entidad `ImportBatch` aparte de transacciones.

## 9. Cuentas (`accounts.tsx`)

### Logica actual

- `currentBalance` se usa como saldo base.
- Calcula saldo por cuenta sumando movimientos asociados.
- Transferencias entrantes se matchean por texto en `destinationWorkspace`.
- Permite crear/editar/eliminar cuentas.

### Riesgos

1. `currentBalance` tiene significado ambiguo.
   - UI lo llama saldo base/actual.
   - Otras pantallas lo usan como apertura o caja actual.
   - `accounts.tsx` le suma transacciones encima.

2. Transferencias entrantes no son confiables.
   - Usa texto, no ID.

3. O(accounts * transactions).
   - Para pocas filas da igual, pero es innecesario.

4. Delete sin referential guard.
   - Se puede borrar cuenta con transacciones asociadas.

### Optimizacion recomendada

- Renombrar campos:
  - `openingBalance` o `baseBalance`.
  - `asOfDate`.
  - `currentBalanceCalculated` derivado.
- Agregar `destinationAccountId`.
- Crear `buildAccountLedger(accounts, transactions)`.
- Bloquear delete si hay movimientos o pedir reasignacion.

## 10. Categorias (`categories.tsx`)

### Logica actual

- CRUD de categorias.
- Income siempre workspace business al crear.
- Expense puede ser business/family/dentist.
- Instalacion de sugeridas familiares por nombre.

### Riesgos

- No hay unicidad por `(workspace, type, normalizedName)`.
- Editar nombre puede fragmentar historico, porque transacciones guardan categoria por string.
- Delete puede dejar transacciones/items/budgets huerfanos.
- Income no puede tener workspace distinto de business.

### Optimizacion recomendada

- Usar `categoryId` en transacciones y budgets, dejando `categoryNameSnapshot` opcional.
- Validar duplicados por workspace/tipo.
- Antes de delete, mostrar impactos y permitir merge/reassign.

## 11. Items (`items-manager.tsx`)

### Logica actual

- CRUD de subcategorias asociadas a categoria.
- Permite categoria null.
- Lista categorias sin filtrar por tipo.

### Riesgos

- Item puede quedar asociado a categoria income aunque presupuesto espera expense.
- Delete deja transacciones/budgets con `itemId` huerfano.
- `categoryMap` se recrea en cada render y es dependency de `useMemo`, por lo que `sortedItems` recalcula siempre.

### Optimizacion recomendada

- Filtrar categorias segun contexto.
- Validar unicidad por `(categoryId, normalizedName)`.
- Bloquear delete o pedir reasignacion.
- Memoizar `categoryMap`.

## 12. Configuracion (`settings.tsx`)

### Logica actual

- Branding/logo en localStorage.
- Tarjetas guardadas en localStorage.
- Atajos y estado operativo visual.

### Riesgos

- Logo y tarjetas no se sincronizan entre dispositivos.
- Tarjetas duplican fuente con `credit_card_settings`.
- Settings no es realmente admin persistente.

### Optimizacion recomendada

- Mover tarjetas a Firestore `creditCards`.
- Mantener `credit_card_settings` como configuracion de cada tarjeta o unir ambas.
- Logo como preference persistida por workspace, o dejar explicitamente "solo local".
- Separar `Centro de control` de `Configuracion del sistema`.

## 13. Workspace y ambitos

### Logica actual

- `finance.ts`: `business | family | dentist | all`.
- `accounts.tsx`: `business | family | shared`.
- `credit_card_settings`: `business | family | shared`.
- `budget.tsx` y `monthly-close.tsx`: solo `business | family`.
- `overview.tsx` etiqueta `dentist` como `Compartido` en algunos casos.

### Riesgos

- Consulta dentista existe en algunas pantallas pero no en presupuesto/cierre/cuentas.
- `shared` existe en cuentas/tarjetas pero no en finanzas.
- Filtros y summaries pueden omitir movimientos.

### Optimizacion recomendada

Definir enum unico:

- `business`
- `family`
- `dentist`
- `shared` solo si se define semantica de prorrateo/asignacion

Cada pantalla debe declarar si soporta todos o un subset.

## Prioridad de implementacion

### P0 - Corregir resultados incorrectos

1. Agregar `destinationAccountId` y migrar transferencias.
2. Arreglar loop de `budget.tsx`.
3. Alinear modelo TC: compras pending/paid y generacion de cuotas.
4. Corregir cierre mensual para usar `paidNet` cuando se muestre real.
5. Filtrar cancelados en presupuesto ejecutado.

### P1 - Crear nucleo de dominio

1. Validadores Zod estrictos y helpers de money/date.
2. `buildFinancialModel()` compartido.
3. `buildAccountLedger()`.
4. `buildBudgetModel()`.
5. `clientPaymentStateMachine`.

### P2 - Persistencia y escalabilidad

1. Repositorios typed por coleccion.
2. Chunking de batches.
3. `ImportBatch` como entidad.
4. Firestore rules y auth.
5. Paginacion o queries por mes/workspace.

### P3 - UX basada en logica clara

1. Resumen como decision surface.
2. Movimientos como workspace operativo.
3. Cierre mensual como checklist/snapshot.
4. Mobile: tablas criticas como lista.

## Orden sugerido de refactor

1. Escribir tests de `finance.ts` para comportamiento actual.
2. Agregar validators sin cambiar UI.
3. Arreglar transferencias con `destinationAccountId`.
4. Extraer modelo TC y corregir cuotas.
5. Extraer modelo de presupuesto/cierre.
6. Simplificar pantallas usando esos modelos.

