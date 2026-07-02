# Octopus Finance — Auditoría de Lógica de Negocio (2026-07)

> Auditoría de correctitud financiera, consistencia entre pantallas, fricción operativa,
> integridad de datos y casos borde. Contra la operación mensual real, no en abstracto.
> **Método:** 5 exploraciones paralelas por área + verificación línea a línea de cada hallazgo
> en el código real + 1 consulta de solo-lectura a Firestore (patrón `_q*`).
> **No se re-reporta** lo ya conocido en `PENDIENTES.md`, `ARQUITECTURA-Y-DECISIONES.md`
> ni `AUDITORIA-BRECHAS-PRODUCTO.md` (follow-ups IVA, sourceKey inestable, zod de MovementRule,
> labels de capa, uso cruzado, etc.).
> Fecha: 2026-07-01. Los 117 tests pasan.

---

## Resumen ejecutivo

La app está técnicamente sana en su núcleo: el motor canónico (`buildCashObligations` + `buildCardDebt`) no doble-cuenta, los tests cubren los bordes principales, y las pantallas están bien defendidas contra mes-sin-datos (cero crashes/NaN encontrados). Los problemas graves están en los **costados** del motor, no en el motor. Los 3 que más importan:

1. **Los cobros de clientes y los abonos de cartola no se conocen entre sí** → el ingreso se cuenta doble de forma estructural (es la causa raíz del bug de julio $8.26M que se parchó borrando datos; la trampa sigue armada para agosto).
2. **El Flujo de Caja y el Asesor calculan "hoy" en UTC** → de las 20:00 a medianoche (hora Chile), la app cree que ya es mañana: tarjetas "vencidas" un día antes, cobros fechados en el mes equivocado si se marcan de noche.
3. **Borrar cosas deja fantasmas silenciosos**: borrar una transacción convertida deja el movimiento importado apuntando a la nada; borrar una cuenta-tarjeta infla la deuda del Centro de Deuda (los pagos dejan de netearse); borrar categoría/item desarma presupuestos sin aviso. Y Salud de Datos no ve nada de esto.

---

## 🔴 Números que mienten o datos que se corrompen

### R1. Cobros de clientes ↔ abonos de cartola: sin vínculo → ingreso doble estructural

**Qué pasa.** Cada `ClientPayment` no-cancelado genera una transacción sintética de ingreso (`clientPaymentToIncomeTransaction`, [client/src/lib/finance.ts:362-391](../client/src/lib/finance.ts)) que entra tanto al universo del Flujo de Caja (`buildCashFlowFinancialTransactions`) como al legacy de Resumen/P&L (`combineFinancialTransactions`). Cuando el cliente paga de verdad, el abono llega a la cuenta Edwards, se importa por cartola y se convierte en una transacción income **real** — sin `sourceClientPaymentId`, así que el filtro anti-doble-conteo (`isGeneratedFromClientPayment`, finance.ts:135-137) no la ve. Resultado: el mismo cobro cuenta dos veces (sintética + importada).

Nada en el sistema puede unirlas solo:
- `domain/reconciliation.ts` y `domain/bank-imports.ts` **no conocen los clientPayments** (verificado: cero referencias).
- El abono bancario es **bruto** (con IVA: $690.200 = $580.000 × 1,19) y la transacción de cobro es **neta** ($580.000) → el match por monto exacto es imposible por diseño.
- Encima, el abono convertido entra bruto a un flujo que se modela en neto → también rompe el modelo IVA.

**Estado en datos reales (verificado 2026-07-01, solo lectura):** hoy no hay duplicados activos — porque los 9 cobros de junio se **borraron a mano** en el fix post-cierre, y los 8 abonos de junio (Chile Aires, Instituto Cardiovascular, etc.) quedaron como income importado. Pero julio tiene 9 cobros `projected` por $4.13M: cuando los clientes paguen y se importe la cartola de julio, la proyección (y el real, si se marca el cobro como pagado) se vuelve a duplicar. El "fix" de junio fue borrar síntomas; la causa sigue.

**Dónde:** [finance.ts:362-391](../client/src/lib/finance.ts), [cash-obligations.ts:216-237](../client/src/domain/cash-obligations.ts), [domain/reconciliation.ts](../client/src/domain/reconciliation.ts) (ausencia de clientPayments).

**Fix propuesto (mediano):** un paso de conciliación cobro↔abono: al importar/convertir un movimiento income, buscar `ClientPayment` con `totalAmount` (bruto) ≈ monto y fecha cercana → proponer "este abono es el cobro de X": convertir seteando `sourceClientPaymentId` + marcar el cobro `paid` en el mismo acto. Con eso el filtro existente (`isGeneratedFromClientPayment`) hace el resto y el ingreso queda contado UNA vez, en neto. Pasar el diseño por Codex antes de tocar (toca conversión + client-payments).

### R2. "Hoy" calculado en UTC en el Flujo de Caja, el Asesor y al marcar cobros

**Qué pasa.** `new Date().toISOString().slice(0,10)` devuelve la fecha UTC. En Chile (UTC-4), entre las 20:00 y medianoche eso es **el día siguiente**. Ese `asOf` alimenta `buildCardDebt` (qué pagos netear) y `buildCashObligations` (qué mes imputa cada obligación, flag `vencido`).

**Escenarios concretos:**
- 30 de junio, 21:00: el Flujo de Caja imputa las obligaciones como si fuera 1 de julio — una tarjeta que vence el 30 aparece "vencida" y el mes del bucket se corre.
- Pancho marca un cobro como pagado a las 22:00 del 30 de junio → `paymentDate: "2026-07-01"` → el ingreso se va a julio en P&L y cierre, la misma noche en que está cerrando junio.

**Dónde (verificado):**
- [client/src/pages/cash-flow.tsx:191](../client/src/pages/cash-flow.tsx) — `const asOf = new Date().toISOString().slice(0, 10);` (el comentario de la línea 190 dice que copia el patrón del asesor a propósito).
- [client/src/lib/advisor.ts:21](../client/src/lib/advisor.ts) — `const today = () => new Date().toISOString().slice(0, 10);`
- `client/src/pages/client-payments.tsx:334,414,429,437,487,524` — `paymentDate` al marcar pagado.
- `client/src/pages/monthly-automation.tsx:105,143,154,418` — fechas/`paidAt` de compromisos y comparación de "vencido".
- `client/src/domain/commitments.ts:296` — default de `today` en `buildCommitmentDashboard`.
- `client/src/components/finance/quick-expense-capture.tsx:63` — fecha default del gasto rápido.

Lo irónico: el helper correcto **ya existe** (`getTodayLocalDateKey`, [finance.ts:114-118](../client/src/lib/finance.ts)) y `debt.tsx`/`credit-cards-panel.tsx` ya lo hacen bien con su `todayLocal()`.

**Fix (chico):** sweep de esos call-sites reemplazando por `getTodayLocalDateKey()`. Cero riesgo, alto retorno.

### R3. Borrar una transacción convertida deja el movimiento importado apuntando a la nada

**Qué pasa.** `deleteTransaction` y `bulkDeleteTransactions` ([firestore.ts:466-468 y 498-505](../client/src/lib/firestore.ts)) borran el doc y listo. Si esa transacción venía de una conversión de cartola, el `ImportedMovement` queda `converted` con `matchedTransactionId` → transacción inexistente. No aparece en la bandeja (filtra por status), no lo ve Salud de Datos (el audit no lee `importedMovements`, ver R5), y el batch ya quedó `completed`. El gasto desaparece de los números y la cartola queda "conciliada" contra un fantasma.

El patrón correcto **ya existe**: `resolveDuplicateTransaction` ([firestore.ts:475-496](../client/src/lib/firestore.ts)) revierte el movimiento a `discarded` antes de borrar — pero solo se usa desde el flujo "resolver duplicado" del asesor.

**Fix (chico/mediano):** extraer esa reversión a un helper y llamarla desde `deleteTransaction`/`bulkDeleteTransactions`.

### R4. Deuda de tarjeta inflada silenciosamente si se borra (o se rompe) la cuenta-tarjeta

**Qué pasa.** En `buildCardDebt`, el neteo de pagos prioriza `cardAccountId`:

```ts
// debt.ts:105-107
const payL4 = n.cardAccountId
  ? digits(accById.get(n.cardAccountId)?.accountNumber).slice(-4)   // cuenta borrada → ""
  : paymentCardLast4(t.creditCardName, accounts);
```

Si la cuenta referenciada ya no existe, `payL4` queda `""`, nunca calza con el last4 de la cartola, y **el pago desaparece del neteo**: `pendienteReal` muestra que debes plata que ya pagaste. Como `cardAccountId` es truthy, ni siquiera cae al fallback por nombre que sí habría funcionado. `resolveCardAccount` (account-identity.ts:44-48) tiene el guard correcto, pero `debt.ts` no lo reutiliza.

**Dónde:** [client/src/domain/debt.ts:102-114](../client/src/domain/debt.ts).
**Fix (chico):** si `accById.get(n.cardAccountId)` es `undefined`, caer al fallback por `creditCardName`.

### R5. Borrados crudos sin guard + Salud de Datos ciega al pipeline de importación

**Qué pasa.** `deleteCategory` ([firestore.ts:544-546](../client/src/lib/firestore.ts)) y `deleteItem` ([firestore.ts:629-631](../client/src/lib/firestore.ts)) borran sin chequear uso:

- Borrar una categoría desarma presupuestos que matchean **por nombre** (`budget.categoryGroup`), deja items huérfanos, y una regla de movimiento que siga apuntando a ese nombre **recrea la categoría borrada** en la próxima conversión (`ensureCategoryExists`, firestore.ts:2747) — la categoría "muerta" revive sin workspace/tipo curado.
- Borrar un item deja `transaction.itemId` huérfano → en Presupuesto la transacción cae a "Sin Agrupadora" y el ejecutado por categoría se distorsiona sin aviso (budget.tsx:225-236 degrada silenciosamente).
- El diálogo de confirmación es genérico ("no se puede deshacer"), no dice cuántas cosas referencian lo que estás por borrar. Contraste: `deleteAccount` sí avisa el impacto, y `deleteClientPayment` sí hace cascada correcta (borra las settlement tx en el mismo batch).

Y el radar que debería cazar las consecuencias no mira: `FinanceAuditInput` ([finance-audit.ts:34-44](../client/src/domain/finance-audit.ts)) **no recibe** `importedMovements`, `importBatches`, `commitmentTemplates/Instances` ni `movementRules`. Los huérfanos de R3, los batches abandonados en `reviewing`, o una regla apuntando a item/cuenta borrada, no generan ningún issue en Salud de Datos. (Lo que sí cubre: categoría histórica inexistente en transacciones, `itemId` huérfano en transacciones y budgets — severidades baja/media.)

**Fix:** (a) chico — antes de borrar categoría/item, contar referencias y mostrarlas en el diálogo (la maquinaria `mergeDuplicateCategories`/`buildBrokenReferencesPlan` ya existe para reasignar); (b) mediano — extender `FinanceAuditInput` con las colecciones del pipeline y 3-4 chequeos (converted huérfano, batch `reviewing` viejo, regla con referencias rotas).

### R6. Reversas de tarjeta: infladas por las dos puntas del parser

El clasificador de cartola de tarjeta ([client/src/lib/parsers/credit-cards.ts:16-40](../client/src/lib/parsers/credit-cards.ts), `detectMovementType`) falla en ambas direcciones:

**(a) Abono sin cargo pareado → se importa como GASTO.** Un movimiento positivo (abono/crédito a favor) solo se clasifica `"reversal"` si encuentra su cargo negativo por el mismo monto dentro de ±7 días **en el mismo archivo**. Si el abono llega solo — reversa de una compra del mes anterior, nota de crédito del banco — cae a `"purchase"` y `getCreditPreviewType` (líneas 42-44) lo convierte en `"expense"`: **el abono suma como gasto** en vez de restar. El test `credit-cards.test.ts:19-21` codifica este comportamiento a propósito, o sea el hueco es conocido por el código pero invisible para el usuario. El "$414 abono internacional" pendiente es una instancia de este mecanismo.

**(b) Abono CON cargo pareado → se descarta el abono pero la compra se importa igual.** La rama `"reversal"` solo evalúa filas con `rawAmount > 0`; la compra original (negativa) siempre cae a `"purchase"`. En el wizard, las filas `reversal` se excluyen del envío ([import-data.tsx:421-423 y ~930](../client/src/pages/import-data.tsx), verificado), pero **la compra que esa reversa cancela se importa como gasto real**: compra de $45.000 reversada 2 días después → el abono se descarta bien, y los $45.000 quedan igual como gasto del mes y deuda de tarjeta. El test solo verifica la fila positiva, nunca qué pasa con la negativa pareada.

**Mitigación actual:** el wizard permite corregir el tipo de fila a mano antes de confirmar (import-data.tsx:856-864) — si te das cuenta.

**Fix (mediano):** cuando el detector encuentra el par que se cancela, marcar **ambas** filas como `"reversal"`; y para el abono sin pareja, un tercer estado "abono — revisar" que fuerce decisión humana en vez de asumir compra.

---

## 🟡 Fricción o confusión operativa

### Y1. Falso verde en Cierre Mensual cuando una cartola nunca se importó

El checklist de conciliación solo considera cuentas **con** movimientos importados en el mes:

```ts
// monthly-close.tsx:324-327
const reconciliationIssues = reconciliationSummaries.filter((summary) =>
  summary.importedCount > 0 &&
  (summary.unresolvedCount > 0 || Math.abs(summary.difference) > 1),
);
```

Si te olvidaste de subir la cartola del Santander, esa cuenta simplemente no cuenta como problema → "Conciliación: ✓" en verde. El paso más olvidable del ritual mensual (bajar e importar TODAS las cartolas) es exactamente el que el cierre no vigila.
**Fix (chico):** ítem de checklist "Cartolas del mes": por cada cuenta/tarjeta activa, warning si no hay ningún `ImportedMovement` del mes.

### Y2. Tarjeta sin cartola: el "a pagar" del mes queda corto en silencio

`buildCashObligations` genera el aviso correcto ("Sin estado de cuenta cargado: X — no puedo calcular su pago", [cash-obligations.ts:128-135](../client/src/domain/cash-obligations.ts)), pero ese warning muere en el camino: llega a `cardWarnings` en los facts del asesor ([advisor.ts:157](../client/src/lib/advisor.ts)) que solo ve la IA en el prompt — **ningún componente de UI lo renderiza** (verificado: cero consumidores de `cardWarnings` en client/src). El Flujo de Caja ni siquiera lo recibe. Si falta la cartola de una tarjeta, su pago simplemente no existe en el "a pagar" y nada te lo dice de forma determinista.
**Fix (chico):** mostrar los warnings en `CashSummaryCard` (Flujo) y como alerta fija en el Asesor.

### Y3. La deuda internacional (USD) está en el Resumen pero no en el "a pagar"

El Resumen suma la deuda en dólares: `pendienteReal + round(deudaInternacionalUsd × USD_CLP)` ([overview.tsx:1694-1697](../client/src/pages/overview.tsx)). Pero en `buildCashObligations` el `amount` de cada pago de tarjeta es solo `pendienteReal` en CLP — `deudaUsd` viaja como metadata informativa ([cash-obligations.ts:120-124](../client/src/domain/cash-obligations.ts)). El Asesor y el Flujo proyectan un pago de tarjeta **menor** al que el Resumen llama deuda. Con deuda USD activa (los 3 traspasos internacionales pendientes lo sugieren), "lo que debo" y "lo que voy a pagar" divergen sin explicación.
**Fix (chico/decisión):** decidir si el pago del mes incluye la deuda USD convertida; si sí, sumarla al `amount`; si no, rotular en el Resumen que la cifra incluye dólares que el flujo no proyecta.

### Y4. Presupuesto cuenta gastos que Análisis y Cierre excluyen

`budget.tsx` usa un predicado propio ([budget.tsx:328-343](../client/src/pages/budget.tsx)): `subtype==='actual' && status!=='cancelled' && movementType==='expense'` — **sin** `isExecutedTransaction`. Un gasto no-tarjeta con `status:"pending"` cuenta como ejecutado en Presupuesto pero no existe en Análisis de gastos ni en Cierre Mensual (que sí usan el canónico, verificado línea a línea en monthly-close.tsx:241-268). Mismo mes, dos totales.
**Fix (chico):** usar `isExecutedTransaction` + `getTransactionExpenseImpact` en `periodTransactions`.

### Y5. El Resumen mezcla capas sin rotular: dos "gastos" y dos "deudas TC" distintos conviven

Instancias concretas de la brecha P0 ya conocida (labels de capa), ahora con líneas:
- **Gasto económico vs caja:** `dashboardCurrentMonthExpenses` (overview.tsx:2589-2592, cuenta la compra TC el día de la compra) convive con `realExpenses` de `buildMonthlySummaries` (caja: la compra TC no existe hasta que se paga la tarjeta). Una compra de $50.000 en tarjeta mueve una tarjeta del dashboard y la otra no.
- **Dos deudas TC:** "Deuda tarjetas" del header usa `buildCardDebt` + USD (overview.tsx:1694-1697, cartola real) y "Deuda tarjetas empresa" usa `getTransactionCreditCardDebtImpact` (overview.tsx:2140, suma de transacciones). Solo coinciden si cada cargo está capturado como transacción. El sub-label "Compras TC menos pagos de tarjeta" ayuda, pero nada explica por qué los dos números difieren.
- Además, Flujo de Caja vs Análisis responden preguntas distintas (pago vs compra) para "gastos del mes" sin decirlo.

**Fix:** es el P0 de labels del roadmap de producto — este hallazgo aporta la lista exacta de superficies a rotular.

### Y6. No hay "deshacer" para conversión ni conciliación

Una vez `converted`/`reconciled`, no existe mutación que devuelva un movimiento a `pending` (verificado: `rollbackImportBatch` filtra explícitamente `status in ["pending","duplicate"]`, firestore.ts:1896-1901). El único camino es borrar la transacción desde Transacciones… que es exactamente el R3. Equivocarse al convertir es caro.
**Fix (mediano):** `revertConvertedMovement(movementId)` transaccional (borra/cancela la tx vinculada + movimiento a `pending`), como acción secundaria en la bandeja.

### Y7. Cuotas proyectadas legacy: doble resta en la proyección cuando llega el pago real

`buildCreditCardInstallmentProjectionTransactions` ([finance.ts:321-360](../client/src/lib/finance.ts)) genera cuotas `planned` para toda compra TC pagada, y `combineFinancialTransactions` las suma al universo de Resumen/P&L/monthly-balances. Cuando el pago real de la tarjeta se registra (executed), la cuota sintética del mismo cargo sigue viva como `plannedExpense` del mismo mes → `projectedEndingBalance` resta el pago dos veces (real + proyección). El motor nuevo del Flujo ya excluyó estas cuotas por esta razón exacta (comentario en cash-obligations.ts:212-214); el legacy nunca recibió ese fix. Misma familia que el follow-up IVA estacionado — conviene resolverlos juntos cuando se migre el legacy.

### Y8. Reversas/abonos de tarjeta no tienen modelo

Más allá del caso de importación (R6), el modelo de datos no tiene forma de representar una reversa: la importación fuerza `Math.abs(amount)` y todo movimiento es `income` o `expense` ([bank-imports.ts:240,314](../client/src/domain/bank-imports.ts)). Un abono en la tarjeta no tiene cómo **reducir la deuda del ciclo** (en `buildCardDebt` solo netean los `credit_card_payment`). Cada reversa futura va a requerir edición manual.
**Fix (mediano/decisión):** aceptar el workaround manual documentándolo, o modelar `refund` (p.ej. income con `cardAccountId` que reste en `buildCardDebt`).

### Y9. "Aprender regla" es un ícono opcional que hay que acordarse de apretar

Si corregís la categoría de un movimiento y apretás "Convertir" sin notar el ✨ ([bank-movements.tsx:1008-1036](../client/src/pages/bank-movements.tsx)), la corrección no se aprende y el mismo comercio vuelve a llegar mal el próximo mes. El criterio `corrected` ya está calculado.
**Fix (chico):** al convertir un movimiento corregido, ofrecer el `LearnRuleDialog` como paso intermedio con "no, gracias" de un clic.

### Y10. Compromiso pagado con tarjeta queda `status:"paid"` al instante

`buildTransactionFromCommitmentPayment` fuerza `status:"paid"` sin mirar el método de pago ([commitments.ts:139](../client/src/domain/commitments.ts)), mientras la conversión de cartola distingue compra-TC → `pending` (bank-imports.ts:308-309). Hoy no rompe cifras (`isExecutedTransaction` trata ambos igual), pero es el único writer que modela distinto una compra a crédito — bomba de tiempo para cualquier superficie futura que filtre por `pending && credit_card`.
**Fix (chico):** replicar el criterio de bank-imports.

### Y11. Un compromiso `transfer` contaría como obligación de caja real (latente)

`buildCashObligations` nunca lee `c.movementType` ([cash-obligations.ts:100-111](../client/src/domain/cash-obligations.ts)): un `CommitmentInstance` con `movementType: "transfer"` (que el schema permite, [shared/schema.ts:810,837](../shared/schema.ts)) entraría íntegro al "a pagar" consolidado del Asesor y el Flujo, violando el invariante "las transferencias no crean resultado". **Verificado contra datos reales: hoy no hay ningún caso** (40 templates y 120 instancias, todos `expense`) — es riesgo latente que se activa el día que se modele un traspaso recurrente (p.ej. "aporte mensual a familia") como compromiso.
**Fix (chico):** rama explícita para `transfer` en el bucle de compromisos (excluir del consolidado o modelar las dos patas).

### Y12. Compromisos `pending` viejos se acumulan sin narrativa

Los generadores de instancias recurrentes solo evitan duplicar el mes que generan (`templateId + monthKey`, [commitments.ts:109-122](../client/src/domain/commitments.ts); mismo patrón en firestore.ts:741-795) — nunca miran si los `pending` de meses anteriores siguen sin resolver. Que lo vencido se arrastre al mes actual es correcto por diseño (invariante "lo vencido no desaparece"), pero un compromiso que en realidad **se pagó y nadie marcó** queda como zombi inflando el "a pagar" mes tras mes, sin ningún aviso de "tienes N compromisos vencidos de meses anteriores sin resolver". Conecta con la brecha de narrativa de arrastre ya conocida (P2), pero este es el ángulo de higiene: distinguir "vencido real" de "olvidé marcarlo".
**Fix (chico):** contador/aviso de pendientes vencidos >1 mes en Automatización y en el checklist de cierre.

---

## 🟢 Mejoras que ahorrarían tiempo o evitarían sustos menores

- **G1. Cobros recurrentes: confirmar el mes de cobro.** El generador ([firestore.ts:935-982](../client/src/lib/firestore.ts)) fecha `expectedDate` con el `billingDay` **dentro del mismo `serviceMonth`**. Si la operación real es mes vencido (el servicio de junio se cobra en julio), toda proyección de cobros nace corrida un mes — consistente con el incidente de los seeds mal fechados. Es decisión de producto, no bug: definir con datos reales y ajustar el generador una sola vez. *(Verificado aparte: el overflow de fechas NO existe — los 3 generadores clampean el día vía string (día ≤28 en firestore.ts:958-959, `clampDay` en commitments.ts:54-57, `addMonthsToDate` en finance.ts:143-149); la nota "revisar el generador" del log de cierre queda respondida: el riesgo real es R1 + esta decisión de mes de cobro, no la aritmética de fechas.)*
- **G2. Pago el día exacto del cierre de cartola no se netea** (`String(t.date) > periodEnd` estricto, [debt.ts:111](../client/src/domain/debt.ts)) — un pago hecho el mismo día del cierre desaparece del neteo. Borde raro; decidir si el corte es inclusivo.
- **G3. Sobrepago de tarjeta invisible** (`pendienteReal = Math.max(0, …)`, [debt.ts:120](../client/src/domain/debt.ts)) — pagar de más deja el crédito a favor en $0 en vez de mostrarlo.
- **G4. Colisión de last4 en `buildCashObligations`** ([cash-obligations.ts:89-94](../client/src/domain/cash-obligations.ts)): el mapa `cardByLast4` no desambigua por banco como sí hace `buildCardDebt` — dos tarjetas de bancos distintos con el mismo last4 se pisarían (workspace/label del pago). Improbable, barato de alinear.
- **G5. Valores confusos en UI** (sin crash, verificado que no hay NaN/Infinity en ninguna pantalla): "999%" cuando hay gasto sin presupuesto (budget.tsx:1474); margen "0%" cuando hay gastos y cero ingresos (overview.tsx:1829-1836, 2604-2606); "-" ambiguo en Cierre para "sin presupuesto" (monthly-close.tsx:119); tarjetas "IVA cobrado" e "IVA proyectado" muestran el mismo número con etiquetas distintas (overview.tsx:2171/2186 — fiscalmente correcto, visualmente redundante).
- **G6. `deleteClient` deja `clientPayments.clientId` fantasma** (firestore.ts:1437-1439) — poner `clientId: null` al borrar.
- **G7. "Eliminar tarjeta" en Configuración es solo localStorage** (credit-cards.ts:1-26): es la lista de sugerencias del dropdown, no una entidad; no sincroniza entre Pancho y Javiera. Aclarar el copy.
- **G8. Tres cálculos de "ingresos del mes" en overview.tsx** (1733-1778 a mano vs 2585-2588 canónico): hoy coinciden, pero son fuentes independientes que pueden divergir tras cualquier migración. Consolidar cuando se toque el Resumen.
- **G9. KPIs "Deuda" y "Cuotas de este mes" lado a lado invitan a sumarse** (credit-cards-panel.tsx:781 y 787): la cuota del mes ya está incluida dentro del facturado de la deuda — quien lea las dos tarjetas puede duplicarla mentalmente. Nota "ya incluida en Deuda" resuelve. Además no existe campo de saldo total comprometido en cuotas futuras en `CardDebt` (solo se ve la cuota del ciclo).
- **G10. `buildQuickExpenseTransaction` no valida monto en el dominio** ([quick-expense.ts:87-121](../client/src/domain/quick-expense.ts)): el guard `amount > 0` vive solo en la UI (quick-expense-capture.tsx:316). Hoy no explotable; espejar el guard de `payCommitmentInstance` (firestore.ts:1478-1481) en el helper puro.

---

## Verificado OK (para no re-auditar)

- **Motor canónico sin doble-conteo:** `buildCashObligations` excluye subs de tarjeta y placeholders y agrega el pago real (test cash-obligations.test.ts:91-98); Flujo y Asesor comparten motor e inputs; IVA fuera del flujo (neto puro, test :142-156).
- **Direcciones/signos correctos** en `getTransactionCashFlowImpact` / `getTransactionCreditCardDebtImpact` / `getAccountBalanceBreakdowns` (compra TC no toca banco; pago TC sí; transferencias se cancelan en consolidado).
- **`USD_CLP` una sola fuente** (`domain/debt.ts:11`), sin duplicados hardcodeados.
- **Conversión de movimientos atómica** (`runTransaction` con re-lectura fresca + `sanitizeRuleItemId` → nunca persiste itemId huérfano por esta vía); `assertCompleteTransfer` valida transferencias antes de convertir; `payCommitmentInstance` bloquea doble pago; `applyRepairPlan` revalida frescura por chunk.
- **Dedupe de importación:** re-subir la misma cartola marca `duplicate`, no crea fantasmas; `closeImportBatch` bloquea cierre con pendientes (client+server); el período del batch sale de las fechas reales de las filas; batch a medio convertir no corrompe (falla por fila, estado real en Firestore).
- **Cierre mensual reversible** ("Reabrir mes" existe); `deleteClientPayment` cascada correcta; `deleteAccount` avisa el impacto en la UI.
- **Mes sin datos:** barrido completo de las 12 pantallas — cero NaN/Infinity/crash; reduces con inicial explícito, guards `> 0`, fallbacks completos. `pnl.tsx`, `budget.tsx`, `overview.tsx`, `cash-flow.tsx`, `debt.tsx`, `credit-cards-panel.tsx` y las 7 restantes, todas defendidas.
- **P&L, Análisis y Cierre convergen** (mismo predicado económico canónico); Deuda y Panel de Tarjetas convergen (mismo `buildCardDebt`+USD), salvo el caso tarjeta-ambigua que el Panel excluye del total con "—" (comportamiento deliberado).
- **Datos hoy:** 0 duplicados de ingresos activos; 8 abonos de junio correctamente como income importado; solo 1 clientPayment `paid`.

---

## Top 5 — si solo pudieras hacer 5 cosas

1. **Conciliación cobros ↔ abonos de cartola (R1).** Es el único hallazgo que ya te mintió una vez en producción y va a volver a mentir en agosto. Diseño por Codex primero. *(mediano)*
2. **Sweep de fechas locales (R2).** Reemplazar `toISOString().slice(0,10)` por `getTodayLocalDateKey()` en cash-flow, advisor, client-payments, monthly-automation, commitments y quick-expense. *(chico, cero riesgo)*
3. **`deleteTransaction` con reversión del movimiento importado (R3) + fallback de neteo en `debt.ts` (R4).** Los dos fantasmas silenciosos más baratos de matar. *(chico cada uno)*
4. **Cierre y Flujo honestos sobre lo que falta (Y1+Y2):** check "cartolas del mes" en el cierre + mostrar los `cardWarnings` en la UI. Convierte los dos silencios más peligrosos del ritual mensual en avisos. *(chico)*
5. **Unificar "gasto real" del Presupuesto (Y4)** con `isExecutedTransaction`, y de paso decidir la deuda USD en el "a pagar" (Y3). *(chico + decisión)*

## Orden de ataque propuesto

| # | Bloque | Hallazgos | Esfuerzo | Por qué en este orden |
|---|--------|-----------|----------|----------------------|
| 1 | Fechas locales | R2 | Chico | Cero riesgo, arregla mentiras nocturnas en 6 archivos de una pasada |
| 2 | Avisos del ritual | Y1, Y2, Y12 | Chico | Antes del próximo cierre de mes (julio) |
| 3 | Fantasmas de borrado | R3, R4 | Chico | Dos fixes puntuales con patrón ya existente en el repo |
| 4 | Consistencia barata | Y4, Y3, Y10, Y11 | Chico | Un predicado + una decisión + un status + un guard latente |
| 5 | Conciliación cobros↔abonos | R1 | Mediano | El grande; diseñar por Codex, idealmente antes de que lleguen los pagos de julio a la cartola |
| 6 | Guards de borrado + audit de imports | R5, Y6 | Mediano | Cierra la clase entera de huérfanos |
| 7 | Legacy combine (cuotas + IVA) | Y7 + follow-ups IVA estacionados | Mediano/Grande | Misma causa raíz; migrar Resumen/P&L al motor canónico de una vez |
| 8 | Abonos de tarjeta | R6, Y8 | Chico/Mediano | Tercer estado "revisar" en el parser + decidir modelo de reversas |
| 9 | Decisiones de producto | G1 (mes de cobro), Y5 (labels de capa) | Decisión | Confirmar con la operación real antes de codear |

> **Nota de método:** todo lo reportado fue verificado leyendo el código citado (archivo:línea) y, donde aplicaba, contra datos reales de Firestore en modo lectura. No se modificó código ni datos. Scripts de verificación throwaway (untracked, re-ejecutables): `scripts/bank-bot/_qaudit-ingresos-dobles.ts` y `scripts/bank-bot/_qaudit-commitments-transfer.ts`.
