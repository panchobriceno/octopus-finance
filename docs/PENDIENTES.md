# Pendientes — Octopus Finance

> Backlog vivo. Lo grande y estable de arquitectura vive en `ARQUITECTURA-Y-DECISIONES.md`
> (sección "Estado al cierre"); acá va lo accionable: manual de Pancho, verificaciones y follow-ups.
> Última actualización: **2026-07-01**.

---

## 🔴 Manual — para Pancho (en la app)

- [ ] **~18 transacciones en "Otros"** por categorizar a mano. Ir a **Transacciones** → filtro categoría = "Otros" → editar cada una (lápiz). Son las que ni la regla ni la IA se animaron (F3).
- [ ] **3 × TRASPASO DEUDA INTERNACIONAL** → editar y setear **categoría "Tarjeta de credito"** + **tipo de movimiento "Pago de tarjeta"** (los dos campos), para que salgan de gastos y entren al circuito de deuda/conciliación.
  - ⚠️ Antes confirmar el **doble conteo**: ¿las compras individuales en dólares ya están cargadas por separado? Si sí, el traspaso como pago de tarjeta evita contar dos veces; si no, el traspaso *es* el gasto real. (Pancho puede pedir a Claude que investigue los datos.)
- [ ] **$414 "abono cuenta internacional"** → revisar aparte: es un **crédito** (va al revés), probablemente reverso/ajuste, NO un pago de tarjeta.

## 🟡 Verificación end-to-end (probar en prod lo de esta sesión)

- [ ] **Flujo de importación completo**: subir cartola → el preview pre-rellena categoría/subcategoría con reglas → corregir a mano una fila → tocar ✨ y aprender una regla → convertir desde la bandeja. Confirmar que las correcciones sobreviven y que aprender re-categoriza otras filas del mismo comercio.
- [ ] **Editor de reglas** en Salud de datos: crear/editar/borrar; selector de subcategoría filtrado; regla de monto (ej. ChatGPT vía Apple ≥ $80.000).
- [ ] **Selector de mes** en Análisis de gastos (cambiar a meses previos, confirmar que números y tendencia cambian).

## 🟢 Mejoras técnicas / follow-ups (no bloquean)

- [ ] **Filtro por ámbito** (Empresa/Familia) en Análisis de gastos — hoy mezcla los dos en el total. *(Oportunidad detectada esta sesión.)*
- [ ] **201 transacciones con categoría pero sin subcategoría** — pasada de enriquecimiento de items aparte (no se tocó en F3, que fue solo Sin categoría/Otros).
- [ ] **Validación zod de `MovementRule` en Firestore** — `createMovementRule`/`updateMovementRule` hacen spread directo sin validar shape; el editor es hoy la única barrera. *(P3 revisor F2 paso 2.)*
- [ ] **Locks de `movementType`/`paymentMethod`** en el preview de importación — F2 paso 3 cubrió category/item/workspace; estos dos también los pisan las reglas (riesgo bajo). *(Codex F2 paso 3.)*
- [ ] **Aviso de ruteo legacy** en el editor de reglas — una regla legacy con accountId/creditCardName editada + cambio de categoría cross-workspace mantiene el ruteo invisible. *(P3 revisor F2 paso 2.)*
- [ ] **Ruteo cuenta/tarjeta** (accountId/creditCardName/cardAccountId) en el editor de reglas — fuera de v1. *(F2 paso 2.)*
- [ ] **Dedupe de reglas aprendidas** usa igualdad exacta de keyword mientras el matcher usa substring — puede crear una regla de más (desempata por prioridad, no rompe). *(P3 F2 paso 4.)*
- [ ] **Convert single** hace 2 lecturas extra de catálogos que el UI ya tiene en memoria (one-off, despreciable). *(P3 F2 paso 5.)*
- [ ] **Follow-ups IVA**: (1) simetría de proyección en Resumen/P&L (`combineFinancialTransactions` resta IVA en `projectedEndingBalance`); (2) opening neto estricto en el semanal.
- [ ] **4 importaciones pendientes** en la bandeja + **1 cartola cosmética** (7232 mayo: cupoUtilizado>cupoTotal).

## 🗺️ Roadmap grande (después de F1-F3, ya completos)

- [ ] **F4-hardening** — estabilizar `sourceKey` (accountId vacío al importar); fuzzy solo como "posible duplicado", no auto-descarte. Preventivo, baja urgencia.
- [ ] **F5 seguridad** — proteger endpoints IA (`/api/extract-pdf`, `/api/extract-receipt`, `/api/advisor`) con token + rate limit.

---

## Cómo revertir F3 (si algo no cuadra)

Las 48 transacciones categorizadas en F3 tienen backup:
```bash
npx tsx scripts/bank-bot/restore-historicos.ts _backup-historicos-2026-07-01T15-22-52-701Z.json
```
