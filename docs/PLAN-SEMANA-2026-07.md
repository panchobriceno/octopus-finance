# Octopus Finance — Plan Maestro de la Semana (2026-07)

> **Qué es este documento.** El plan de ataque para convertir los hallazgos de la auditoría
> (`docs/AUDITORIA-LOGICA-2026-07.md`) + la IA que vale la pena + las funcionalidades que faltan,
> en trabajo ejecutable por agentes a lo largo de la semana. Está escrito para que un agente lo abra,
> tome un frente, y sepa exactamente qué tocar, en qué rama, con quién NO chocar y cuándo terminó.
>
> **Cómo leerlo Pancho (no técnico):** cada frente dice en una línea qué mejora para vos y qué riesgo tiene.
> No necesitás entender el detalle técnico — el "tablero de estado" al final te dice en qué vamos.
>
> **Norte del producto (de la Biblia):** la app responde cada mes *"¿me alcanza, me sobra, o estoy
> tapando hoyos con la tarjeta?"*. Todo frente se justifica contra eso. Primero que los números no
> mientan, después que el ritual mensual sea claro, después la IA y las funcionalidades nuevas.
>
> Fecha de apertura: 2026-07-01. Repo: `octopus-finance-source` (github `panchobriceno/octopus-finance`).

---

## Decisiones de Pancho (2026-07-01) — mandato de esta sesión

1. **Ritmo:** todo de corrido en una sola sesión (horas, no días), pero **en orden**. El calendario día-a-día
   de la sección 3 se colapsa: se ejecuta secuencial por valor, sin pausas de días.
2. **Prioridad absoluta: que los números sean fieles.** Olas 1-3 son el mandato. **La Ola 4 (funcionalidades
   nuevas) queda estacionada** hasta que la confianza esté cerrada. No abrir Ola 4 hasta terminar 1-3.
3. **Modelo de aprobación:** lo que **mueve o muestra dinero** → Pancho aprueba el diff antes del push a prod.
   Lo que **no** (avisos, labels, cosmético) → directo. (Casi toda Ola 1-3 mueve dinero → mostrar antes de subir.)
4. **IA:** autorizada. El gasto esperado es bajo. Igual, la IA es opt-in donde toque flujo diario.
5. **Arranque:** ya. Hoy es 1 de julio (inicio de mes, sin cierre en curso) — ventana limpia.
6. **Decisiones de producto (alimentan frentes específicos):**
   - **6.1 Cobros:** la mayoría de los clientes paga adelantado, algunos a mes vencido → **agregar un toggle
     por cliente** (adelantado / vencido) que el generador de cobros use para fechar `expectedDate`. Alimenta
     el frente del generador (G1) y R1.
   - **6.2 Deuda USD y criterio bancario:** la deuda en dólares va **dentro del "a pagar" del mes** (hay que
     pagarla). Pero si no se paga, la app debe saber que ese monto **pasa a deuda nacional/rotativa y se arrastra
     al mes siguiente**, con claridad de todo el ciclo. Esto se implementa en dos capas: (a) el **cálculo del
     arrastre** en código puro y testeable; (b) **conocimiento de dominio bancario chileno** (ciclos de
     facturación, corte vs. vencimiento, pago mínimo, mora, deuda rotativa) como **contexto del asesor** — la
     IA razona con criterio, pero NO calcula. Alimenta Y3 + F6.
   - **6.3 Ahorro consolidado:** descuenta **todos los gastos familiares y de empresa**. Alimenta F1.

---

## 0. Cómo trabajan los agentes acá (LEER ANTES DE TOCAR NADA)

### 0.1 Reglas no negociables (heredadas del proyecto)

1. **Codex antes de codear.** Todo frente que modifique lógica pasa su plan por `/codex` ANTES de escribir código. Recién con el visto bueno se implementa. (Los frentes marcados "esfuerzo chico / mecánico" pueden saltarse Codex si son sweep puros — se indica en cada uno.)
2. **Revisor antes de push.** Antes de cualquier push, pasar el diff por el agente `revisor` (revisión adversarial en frío). Corregir P1/P2 antes de subir.
3. **Tests siempre.** `npm test` (117+ tests) debe pasar antes de push. Si el frente cambia lógica de dominio, **agregar tests nuevos** que cubran el caso arreglado — es la red de seguridad de la próxima sesión.
4. **Nada de escribir a Firestore sin dry-run.** Cualquier script que TOQUE datos: dry-run por defecto + `--apply` explícito + backup/manifest + guard de projectId. Patrón `scripts/bank-bot/`. Los scripts de solo lectura van con prefijo `_q*` (throwaway, no se commitean).
5. **La IA no calcula números.** Los números vienen de código puro y testeable (`client/src/domain/`). La IA solo lee desorden, empareja lo difuso y traduce a lenguaje humano. Si un frente le pide a un LLM que calcule un saldo, está mal diseñado.
6. **Cambios irreversibles → confirmar con Pancho.** Deploy a prod, borrado de datos, cambio de reglas Firestore. Mostrar qué se va a hacer y esperar "sí".

### 0.2 El modelo de ramas y worktrees (por qué y cómo)

**El problema real:** ahora mismo hay 7 worktrees de otras sesiones tocando este repo (`git worktree list` lo confirma). Si dos agentes editan la copia principal a la vez, o comparten la misma rama, **se pisan** — uno sobrescribe el trabajo del otro y se pierde.

**Concepto (para Pancho):**
- Una **rama** (branch) es una línea de trabajo paralela. Cada frente vive en su propia rama, así los cambios no se mezclan hasta que vos decidas.
- Un **worktree** es una *carpeta separada en tu disco* que apunta a otra rama del mismo repo. Permite que dos agentes trabajen a la vez en carpetas distintas sin pisarse la copia de archivos. Es la clave para correr agentes en paralelo sin desastre.

**Regla operativa para cada agente:**
1. **Nunca trabajar en la copia principal** (`octopus-finance-source`, que está en `main`). Es compartida y otra sesión puede cambiarla de rama bajo tus pies.
2. Crear un worktree propio con una rama propia. Nombre de rama sugerido: `claude/finance-<frente>` (ej. `claude/finance-fechas-locales`).
   ```bash
   # desde la copia principal, crear worktree + rama nueva en una carpeta hermana
   git worktree add ../octopus-finance-<frente> -b claude/finance-<frente> origin/main
   cd ../octopus-finance-<frente>
   npm install   # cada worktree necesita sus node_modules la primera vez
   ```
3. Trabajar, commitear, testear DENTRO de ese worktree.
4. **Subir con `git push origin HEAD:main`** solo cuando el frente está verde (tests + revisor). Antes de pushear, verificar que `origin/main` no avanzó (otra sesión pudo mergear): `git fetch origin && git log HEAD..origin/main --oneline`. Si avanzó, rebasar sobre `origin/main` **excluyendo commits ajenos** antes de pushear.
5. Al terminar, el worktree se puede borrar: `git worktree remove ../octopus-finance-<frente>`.

> **Deploy:** pushear a `main` = auto-deploy a Railway. Por eso cada push debe estar verde y, si toca algo sensible (fechas, dinero), confirmado con Pancho antes.

### 0.3 La regla de oro de la paralelización: **un archivo, un agente a la vez**

Dos agentes pueden correr en paralelo **solo si tocan archivos distintos.** Si dos frentes tocan el mismo archivo, se pisan al mergear aunque estén en ramas separadas. Por eso más abajo hay un **Mapa de Archivos Calientes**: los archivos que varios frentes necesitan se trabajan **en serie** (uno, se mergea, el siguiente parte de esa base); los frentes que tocan archivos aislados corren **en paralelo, en olas**.

---

## 1. Mapa de Archivos Calientes (esto dicta qué corre junto)

Archivos que **varios frentes necesitan** → se trabajan EN SERIE, coordinados:

| Archivo caliente | Frentes que lo tocan | Regla |
|---|---|---|
| `client/src/lib/firestore.ts` | A (fechas), R1, R3, R5, Y6 | **Nunca 2 a la vez.** Serie estricta. Es el archivo más caliente del repo (2877 líneas). |
| `client/src/lib/finance.ts` | A (fechas), R1, Y7 | Serie. |
| `client/src/domain/cash-obligations.ts` | Y3, Y11 | Serie (o 1 agente hace los dos juntos). |
| `client/src/domain/commitments.ts` | A (fechas), Y10, Y12 | Serie (o 1 agente los tres). |
| `client/src/pages/overview.tsx` | Y3, Y5, funcionalidades (Mes Financiero, ahorro) | Serie. Coordinar fuerte: es el Resumen, todos quieren tocarlo. |
| `client/src/pages/import-data.tsx` | R1, R6 | Coordinar (colisión menor, distintas zonas del archivo). |

Archivos **aislados** (un solo frente los toca) → corren EN PARALELO sin miedo:

| Archivo aislado | Frente único |
|---|---|
| `client/src/domain/debt.ts` | R4 |
| `client/src/lib/parsers/credit-cards.ts` | R6 |
| `client/src/pages/budget.tsx` | Y4 |
| `client/src/pages/monthly-close.tsx` | Y1 |
| `client/src/pages/categories.tsx` + `items-manager.tsx` | R5 (parte UI) |

---

## 2. Los frentes, organizados en OLAS

Cada frente tiene: **objetivo · qué mejora para Pancho · tareas · archivos · rama · ¿paralelo? · depende de · esfuerzo · Codex? · done cuando.**

---

### 🌊 OLA 1 — Confianza barata y aislada (corre 4 agentes EN PARALELO)

Estos cuatro frentes tocan archivos aislados → se lanzan simultáneamente en 4 worktrees distintos. Cero colisión entre ellos. Son la base de confianza y los merges más rápidos.

#### Frente R4 — Fallback de neteo de deuda al borrar cuenta
- **Objetivo:** que borrar una cuenta-tarjeta no infle la deuda del Centro de Deuda.
- **Mejora para Pancho:** el Centro de Deuda deja de mostrar plata que ya pagaste como si la debieras.
- **Tarea:** en `debt.ts:105-107`, si `accById.get(n.cardAccountId)` es `undefined`, caer al fallback por `creditCardName` (hoy queda en `""` y el pago desaparece del neteo).
- **Archivo:** `client/src/domain/debt.ts` (aislado).
- **Rama:** `claude/finance-debt-fallback` · **Paralelo:** ✅ · **Depende de:** nada · **Esfuerzo:** chico · **Codex:** opcional (fix puntual) · **Test:** agregar caso `pagado` con `cardAccountId` a cuenta inexistente.
- **Done:** test nuevo pasa + revisor 0 P1.

#### Frente R6 — Reversas de tarjeta bien clasificadas
- **Objetivo:** que las devoluciones/abonos de tarjeta no entren como gasto.
- **Mejora para Pancho:** una compra reversada queda en cero, no como gasto + deuda fantasma.
- **Tareas:** en `parsers/credit-cards.ts:16-40`, (a) cuando se detecta el par que se cancela, marcar **ambas** filas como `"reversal"`, no solo la positiva; (b) para un abono sin pareja, un tercer estado "abono — revisar" que fuerce decisión humana en el preview en vez de asumir `"purchase"`. Actualizar `credit-cards.test.ts` (hoy solo cubre la fila positiva).
- **Archivos:** `client/src/lib/parsers/credit-cards.ts` (aislado) + toque menor en `import-data.tsx` (zona de preview de reversas, líneas ~420/930).
- **Rama:** `claude/finance-reversas` · **Paralelo:** ✅ (coordinar el toque de import-data.tsx con R1 si corren juntos) · **Depende de:** nada · **Esfuerzo:** mediano · **Codex:** sí · **Test:** casos de par cancelado y abono suelto.
- **Done:** tests cubren ambas puntas + preview muestra el tercer estado.

#### Frente Y4 — Presupuesto usa el mismo "gasto real" que el resto
- **Objetivo:** que Presupuesto, Análisis y Cierre den el mismo total de gasto para el mismo mes.
- **Mejora para Pancho:** dejás de ver dos cifras distintas de gasto según la pantalla.
- **Tarea:** en `budget.tsx:328-343`, reemplazar el predicado inline por `isExecutedTransaction` + `getTransactionExpenseImpact` (el canónico).
- **Archivo:** `client/src/pages/budget.tsx` (aislado).
- **Rama:** `claude/finance-budget-canonico` · **Paralelo:** ✅ · **Depende de:** nada · **Esfuerzo:** chico · **Codex:** opcional · **Test:** verificar que un gasto no-tarjeta `pending` ya no infla el ejecutado.
- **Done:** un mes da el mismo gasto en Presupuesto, Análisis y Cierre.

#### Frente Y1 — Cierre Mensual avisa las cartolas que faltan
- **Objetivo:** que el cierre no dé "verde" si te olvidaste de importar una cartola.
- **Mejora para Pancho:** el paso más fácil de olvidar (bajar todas las cartolas) deja de pasar desapercibido.
- **Tarea:** nuevo ítem de checklist "Cartolas del mes" en `monthly-close.tsx`: por cada cuenta/tarjeta activa, warning si no hay ningún `ImportedMovement` con fecha del mes. No bloquear duro — mostrar "revisar".
- **Archivo:** `client/src/pages/monthly-close.tsx` (aislado).
- **Rama:** `claude/finance-cierre-cartolas` · **Paralelo:** ✅ · **Depende de:** nada · **Esfuerzo:** chico · **Codex:** opcional.
- **Done:** cerrar un mes con una cartola faltante muestra el aviso.

---

### 🌊 OLA 2 — Confianza sobre archivos calientes (corre EN SERIE, 1 a la vez)

Todos tocan `firestore.ts`, `finance.ts`, `commitments.ts` o `cash-obligations.ts`. Van uno tras otro; cada uno parte de la base del anterior ya mergeado. **Un solo agente los toma en secuencia, o agentes distintos pero nunca simultáneos sobre el mismo archivo.**

#### Frente A — Fechas locales (va PRIMERO de la ola, es la base)
- **Objetivo:** que la app deje de creerse que es mañana después de las 8 PM.
- **Mejora para Pancho:** cobros y vencimientos dejan de correrse de mes/día cuando trabajás de noche.
- **Tarea:** sweep reemplazando `new Date().toISOString().slice(0,10)` por `getTodayLocalDateKey()` (ya existe en `finance.ts:114-118`) en: `cash-flow.tsx:191`, `advisor.ts:21`, `client-payments.tsx` (varias), `monthly-automation.tsx:105,143,154,418`, `commitments.ts:296`, `quick-expense-capture.tsx:63`. Revisar los `createdAt/updatedAt` de `firestore.ts` (esos pueden quedar en UTC, son metadata — decidir caso a caso).
- **Archivos calientes:** `firestore.ts`, `commitments.ts`, `finance.ts` (import), `cash-flow.tsx`, `advisor.ts`.
- **Rama:** `claude/finance-fechas-locales` · **Paralelo:** ❌ (base de la ola) · **Depende de:** nada · **Esfuerzo:** chico pero muchos archivos · **Codex:** opcional (sweep mecánico) · **Test:** el helper ya tiene comportamiento correcto; agregar test de que un cobro marcado "de noche" cae en el mes correcto.
- **Done:** ningún `toISOString().slice(0,10)` para fechas de negocio + tests verdes. **Se mergea primero** porque toca archivos que los siguientes frentes también tocan.

#### Frente R3 — Borrar transacción limpia el movimiento importado
- **Objetivo:** que borrar una transacción convertida no deje un "fantasma" en la cartola.
- **Mejora para Pancho:** no quedan gastos invisibles ni cartolas "conciliadas" contra la nada.
- **Tarea:** extraer la reversión de `resolveDuplicateTransaction` (firestore.ts:475-496) a un helper y llamarla desde `deleteTransaction` (466-468) y `bulkDeleteTransactions` (498-505).
- **Archivo caliente:** `firestore.ts`.
- **Rama:** `claude/finance-delete-limpio` · **Paralelo:** ❌ (firestore.ts) · **Depende de:** A mergeado · **Esfuerzo:** chico · **Codex:** sí (toca borrado) · **Test:** borrar una tx convertida devuelve el movimiento a estado usable.
- **Done:** no quedan `importedMovements` huérfanos tras un delete normal.

#### Frente Y6 — Deshacer conversión/conciliación desde la UI
- **Objetivo:** poder revertir un movimiento convertido/conciliado sin trucos.
- **Mejora para Pancho:** si te equivocás al convertir, lo deshacés con un clic en vez de borrar a mano.
- **Tarea:** `revertConvertedMovement(movementId)` transaccional (borra/cancela la tx vinculada + movimiento a `pending`), expuesto como acción en la bandeja (`bank-movements.tsx`).
- **Archivos calientes:** `firestore.ts` + `bank-movements.tsx`.
- **Rama:** `claude/finance-deshacer-conversion` · **Paralelo:** ❌ (firestore.ts) · **Depende de:** R3 mergeado (comparten patrón de reversión) · **Esfuerzo:** mediano · **Codex:** sí.
- **Done:** un movimiento `converted` se puede volver a `pending` desde la UI.

#### Frente R5 — Guards de borrado + Salud de Datos ve el pipeline de importación
- **Objetivo:** avisar el impacto antes de borrar categoría/item, y que Salud de Datos cace los huérfanos.
- **Mejora para Pancho:** no borrás algo sin saber qué se rompe; Salud de Datos deja de tener un punto ciego.
- **Tareas:** (a) antes de borrar categoría/item, contar referencias (reusar `mergeDuplicateCategories`/`buildBrokenReferencesPlan`) y mostrarlas en el diálogo; (b) extender `FinanceAuditInput` (finance-audit.ts:34-44) con `importedMovements`, `importBatches`, `commitmentTemplates/Instances`, `movementRules` + 3-4 chequeos (converted huérfano, batch `reviewing` viejo, regla con referencias rotas).
- **Archivos:** `firestore.ts` (deletes) + `finance-audit.ts` (caliente) + `categories.tsx`/`items-manager.tsx`/`data-health.tsx` (UI).
- **Rama:** `claude/finance-guards-borrado` · **Paralelo:** ❌ (firestore.ts + finance-audit.ts) · **Depende de:** A, R3 mergeados · **Esfuerzo:** mediano · **Codex:** sí · **Test:** chequeos nuevos del audit.
- **Done:** borrar categoría en uso avisa; un converted huérfano aparece en Salud de Datos.

#### Frente Y7 — Migrar Resumen/P&L al motor canónico (cierra el legacy IVA + cuotas)
- **Objetivo:** eliminar `combineFinancialTransactions` legacy de las superficies de dinero.
- **Mejora para Pancho:** desaparecen la doble-resta de IVA y las cuotas proyectadas que ya se pagaron; un solo motor manda.
- **Tarea:** reemplazar `combineFinancialTransactions` en `pnl.tsx` y `monthly-balances.ts` por el motor canónico (`buildCashFlowFinancialTransactions` / `buildCashObligations`). Resolver de paso los dos follow-ups IVA estacionados. **El más delicado de la ola** — blast radius overview + pnl + monthly-balances.
- **Archivos calientes:** `finance.ts`, `pnl.tsx`, `monthly-balances.ts`, `overview.tsx`.
- **Rama:** `claude/finance-motor-unico` · **Paralelo:** ❌ · **Depende de:** A mergeado · **Esfuerzo:** grande · **Codex:** sí (obligatorio, diseño completo) · **Test:** ampliar cobertura de P&L y saldos.
- **Done:** un mes da el mismo resultado en Resumen, P&L, Flujo y Cierre, sin doble-resta.

---

### 🌊 OLA 3 — El grande: emparejador cobro ↔ depósito (R1 + IA)

> Este es el frente más importante y el mejor caso de IA de toda la app. Va **solo**, con diseño Codex
> completo antes de tocar código, idealmente **antes de que importes la cartola de julio** (si no, se
> vuelve a duplicar el ingreso). No se mezcla con otras olas porque toca `finance.ts` + `firestore.ts` +
> `reconciliation.ts` + `client-payments.tsx` a la vez.

#### Frente R1 — Conciliación cobros de cliente ↔ abonos de cartola
- **Objetivo:** que el mismo pago de cliente no se cuente dos veces (proyección + depósito importado).
- **Mejora para Pancho:** tu ingreso del mes deja de inflarse solo cuando entra la plata al banco (el bug de julio $8.26M no vuelve).
- **Diseño (a validar con Codex):**
  - **Capa código (sin IA, cubre el 90%):** al importar/convertir un movimiento `income`, buscar `ClientPayment` con `totalAmount` (bruto, con IVA) ≈ monto del depósito y fecha cercana → candidato de match.
  - **Capa IA (solo desempate difuso):** cuando el monto calza pero el nombre bancario es críptico ("076881709K Transf. CHILE AIRES SPA"), la IA confirma que es el cliente "Chile Aires". Nunca aplica sola — propone, Pancho confirma con un clic.
  - **Efecto:** convertir seteando `sourceClientPaymentId` + marcar el cobro `paid`. El filtro anti-doble-conteo existente (`isGeneratedFromClientPayment`) hace el resto → ingreso contado UNA vez, en neto.
- **Archivos calientes:** `finance.ts`, `firestore.ts` (conversión), `reconciliation.ts`, `client-payments.tsx`, `import-data.tsx`.
- **Rama:** `claude/finance-cobros-depositos` · **Paralelo:** ❌ · **Depende de:** A mergeado (fechas correctas) · **Esfuerzo:** grande · **Codex:** obligatorio · **Test:** cobro bruto ↔ depósito neto, con y sin match de nombre.
- **Done:** importar un depósito que corresponde a un cobro lo concilia (no crea segundo ingreso); tests cubren el caso bruto/neto.

---

### 🌊 OLA 4 — Ritual, IA que suma y funcionalidades faltantes

> Estos son frentes de producto, más grandes y con diseño propio. Varios tocan `overview.tsx` (caliente)
> → coordinar. Se abordan después de que las Olas 1-3 dejaron los números confiables (no tiene sentido
> una pantalla nueva sobre números que mienten). Algunos son paralelos entre sí (tocan archivos nuevos).

#### Frente F1 — Número de ahorro consolidado
- **Objetivo:** la cifra "¿me sobra o me falta?" después de TODO (obligaciones, IVA, deuda vencida, cobros esperados). Es la razón de ser de la app (Biblia §6).
- **Mejora para Pancho:** una sola cifra honesta que distingue ahorro sano de caja inflada por deuda pateada.
- **Diseño:** helper puro nuevo `buildConsolidatedSurplus` en `client/src/domain/` (testeable, sin IA). Consume los motores existentes. Se muestra en Resumen.
- **Archivos:** dominio nuevo (aislado) + `overview.tsx` (caliente, coordinar).
- **Rama:** `claude/finance-ahorro-consolidado` · **Depende de:** Olas 1-3 · **Esfuerzo:** mediano · **Codex:** sí.

#### Frente F2 — Vista "Mes Financiero" (el ritual)
- **Objetivo:** una pantalla/sección que siga el orden real del trabajo mensual: caja hoy → cobros esperados/atrasados → obligaciones → tarjetas/deuda → uso cruzado → resultado → cierre. Con el **estado de cada paso** ("te faltan 2 cartolas, 3 movimientos por revisar").
- **Mejora para Pancho:** dejás de saltar entre 7 módulos para saber en qué vas; la app te guía el ritual.
- **Diseño:** empezar como bloque/reordenamiento dentro del Resumen (Biblia §10 P3) antes de crear página nueva. Reusa los motores; el "estado de cada paso" cruza `importedMovements`/`commitments`/`monthlyClose`.
- **Archivos:** `overview.tsx` (caliente) + componentes nuevos.
- **Rama:** `claude/finance-mes-financiero` · **Depende de:** F1 (usa el número de ahorro) · **Esfuerzo:** grande · **Codex:** sí.

#### Frente F3 — Insight de uso cruzado de instrumentos
- **Objetivo:** "Octopus gastó $X con tu tarjeta personal este mes" — trazabilidad, NO deuda ni reembolso.
- **Mejora para Pancho:** ves cuánto de la empresa pasa por instrumentos personales, sin que la app lo trate como error.
- **Diseño:** helper puro `buildCrossWorkspaceInstrumentUsage` (compara `transaction.workspace` vs `cardAccount.workspace`). Tono descriptivo. Se muestra en Resumen + columna de ámbito en Panel de Tarjetas.
- **Archivos:** dominio nuevo (aislado) + `overview.tsx` (coordinar) + `credit-cards-panel.tsx`.
- **Rama:** `claude/finance-uso-cruzado` · **Depende de:** Olas 1-3 · **Esfuerzo:** mediano · **Codex:** sí · **Paralelo con F1/F4** (dominio aislado; solo coordinar overview.tsx).

#### Frente F4 — Cobranza asistida por correo (IA que redacta)
- **Objetivo:** detectar cobros vencidos/por vencer → IA redacta borrador de recordatorio → Pancho aprueba y envía → guarda fecha del último recordatorio.
- **Mejora para Pancho:** reducís atraso de clientes (tu tensión de caja real) sin salir de la app.
- **Diseño (Biblia §10 P5):** la detección es código (cobros `receivable`/`invoiced` vencidos). La IA solo redacta el texto (monto, días de atraso, tono). Nunca envía sola. Endpoint IA protegido (ya hay auth F5).
- **Archivos:** endpoint server nuevo + `client-payments.tsx` + campo `lastReminderAt`.
- **Rama:** `claude/finance-cobranza` · **Depende de:** Olas 1-3 · **Esfuerzo:** grande · **Codex:** sí.

#### Frente F5 — Sugerencia IA de categoría (segunda opinión sobre las reglas)
- **Objetivo:** cuando ninguna regla determinista conoce el comercio, la IA sugiere categoría (marcada como sugerencia, confianza baja/alta, nunca sola).
- **Mejora para Pancho:** menos comercios nuevos que categorizar a mano.
- **Diseño:** las reglas (F2 ya construido) siguen siendo el primer filtro; IA como respaldo, patrón ya probado en F3 histórico. Prioridad: regla manual > IA > keyword > vacío.
- **Archivos:** `import-data.tsx` + endpoint IA + dominio de sugerencia.
- **Rama:** `claude/finance-ia-categoria` · **Depende de:** nada de las otras olas (aislado en su flujo) · **Esfuerzo:** mediano · **Codex:** sí · **Paralelizable temprano** si querés.

#### Frente F6 — Narrativas del asesor (arrastre + cierre narrado)
- **Objetivo:** que el asesor cuente la historia de la deuda ("viene de mayo, pagaste la mitad, quedan $X vencidos") y narre el cierre del mes en 5 frases honestas.
- **Mejora para Pancho:** entendés de dónde viene cada deuda sin descifrar tablas.
- **Diseño:** los "facts" ya los calcula código; la IA solo narra. Extiende `buildAdvisorFacts` con `reasonKind` (cash/debt/late_income/missing_data/instrument_usage/duplicate) para que cada alerta diga su capa.
- **Archivos:** `advisor.ts` + `advisor.tsx`.
- **Rama:** `claude/finance-asesor-narrativa` · **Depende de:** A, R1 (para que los facts sean fieles) · **Esfuerzo:** mediano · **Codex:** sí.

#### Frentes chicos de cierre (agrupar en 1 rama de "pulido"):
- **Y2** — mostrar los `cardWarnings` (tarjeta sin cartola) en Flujo y Asesor. *(chico)*
- **Y3** — decidir si la deuda USD entra al "a pagar" del Asesor/Flujo (`cash-obligations.ts`) o se rotula. *(chico + decisión)*
- **Y5** — labels de capa (Caja/Resultado/Deuda/Cobro/IVA/Arrastre) en las cifras del Resumen. *(chico, mucho toque de UI)*
- **Y10** — status `pending` para compromiso pagado con tarjeta (`commitments.ts:139`). *(chico)*
- **Y11** — rama `transfer` en `buildCashObligations` (latente, sin caso real hoy). *(chico)*
- **Y12** — aviso de compromisos vencidos >1 mes sin resolver. *(chico)*
- **G6/G9/G10** — `deleteClient` deja `clientId` fantasma; nota "ya incluida en Deuda" en KPIs de cuotas; guard de monto en `buildQuickExpenseTransaction`. *(chicos)*
- **Rama:** `claude/finance-pulido` · agrupa varios chicos que tocan archivos distintos — pero OJO: Y10/Y11 tocan `commitments.ts`/`cash-obligations.ts` (calientes), coordinar con Ola 2.

---

## 3. Orden de ejecución (de corrido, en orden — decisión de Pancho)

Sesión única, secuencial por valor. **Mandato: Olas 1-3 (números fieles). Ola 4 estacionada.**
Cada frente que mueve dinero: implementar → tests verdes → `revisor` → **mostrar diff a Pancho → aprobar → push**.
Los que no mueven dinero (Y1 aviso, labels): directo tras tests + revisor.

| Paso | Frente | Mueve dinero? | Gate |
|---|---|---|---|
| 1 | **R4** fallback neteo deuda | sí (muestra) | aprobar diff |
| 2 | **Y1** cierre avisa cartolas | no | directo |
| 3 | **Y4** presupuesto canónico | sí | aprobar diff |
| 4 | **R6** reversas tarjeta | sí | aprobar diff |
| 5 | **A** fechas locales | sí (fechas de plata) | aprobar diff — base de la serie firestore |
| 6 | **R3** delete limpia importado | sí (integridad) | aprobar diff |
| 7 | **Y6** deshacer conversión | sí | aprobar diff |
| 8 | **R5** guards borrado + audit | sí | aprobar diff |
| 9 | **Y7** motor único (IVA/cuotas) | sí | aprobar diff (el grande de confianza) |
| 10 | **R1** cobros ↔ depósitos (+IA) | sí | Codex obligatorio + aprobar diff. **Antes de importar cartola julio.** |
| 11 | **Pulido** confianza: Y2, Y3, Y10, Y11, Y12, G6/G9/G10 | mixto | dinero→aprobar, resto directo |
| — | **Ola 4 (F1-F6)** | — | **ESTACIONADA** hasta cerrar 1-11 |

**Sobre paralelo vs secuencial en esta sesión:** aunque el doc describe olas paralelas (para cuando corren
agentes autónomos días), esta sesión es en vivo y secuencial por pedido de Pancho ("en orden"). Los pasos 1-4
tocan archivos aislados → si se quisiera acelerar, se pueden lanzar en worktrees paralelos; pero el gate de
aprobación de dinero hace más limpio ir de a uno. Del paso 5 en adelante es serie obligada (archivos calientes).

> **No abrir más de lo que el mapa de archivos calientes permite.** Mismo archivo caliente = serie, no paralelo.

---

## 4. Tablero de estado (marcar a medida)

**Confianza (Olas 1-2):**
- [ ] R4 — fallback neteo deuda `claude/finance-debt-fallback`
- [ ] R6 — reversas tarjeta `claude/finance-reversas`
- [ ] Y4 — presupuesto canónico `claude/finance-budget-canonico`
- [ ] Y1 — cierre avisa cartolas `claude/finance-cierre-cartolas`
- [ ] A — fechas locales `claude/finance-fechas-locales`
- [ ] R3 — delete limpia importado `claude/finance-delete-limpio`
- [ ] Y6 — deshacer conversión `claude/finance-deshacer-conversion`
- [ ] R5 — guards borrado + audit imports `claude/finance-guards-borrado`
- [ ] Y7 — motor único (legacy IVA/cuotas) `claude/finance-motor-unico`

**El grande (Ola 3):**
- [ ] R1 — cobros ↔ depósitos (+ IA) `claude/finance-cobros-depositos`

**Producto + IA (Ola 4):**
- [ ] F1 — ahorro consolidado `claude/finance-ahorro-consolidado`
- [ ] F2 — vista Mes Financiero `claude/finance-mes-financiero`
- [ ] F3 — insight uso cruzado `claude/finance-uso-cruzado`
- [ ] F4 — cobranza asistida `claude/finance-cobranza`
- [ ] F5 — sugerencia IA categoría `claude/finance-ia-categoria`
- [ ] F6 — narrativas asesor `claude/finance-asesor-narrativa`
- [ ] Pulido — Y2/Y3/Y5/Y10/Y11/Y12/G6/G9/G10 `claude/finance-pulido`

---

## 5. Referencias

- Hallazgos completos con archivo:línea: `docs/AUDITORIA-LOGICA-2026-07.md`
- Contrato de producto (qué debe hacer cada pantalla): `docs/BIBLIA-PRODUCTO-FINANCIERO.md`
- Decisiones tomadas + estado del código: `docs/ARQUITECTURA-Y-DECISIONES.md`
- Backlog vivo + pendientes manuales de Pancho: `docs/PENDIENTES.md`
- Scripts de datos (dry-run/apply/backup): `scripts/bank-bot/`
- Verificación de solo lectura reusable: `scripts/bank-bot/_qaudit-*.ts`

> **Regla final:** este doc es el mapa, no el territorio. Si un frente al ejecutarse descubre que el
> diseño no calza con el código real, se ajusta el doc ANTES de codear (igual que la Biblia manda:
> "si una respuesta no está clara, primero ajustar modelo/producto antes de tocar UI").
