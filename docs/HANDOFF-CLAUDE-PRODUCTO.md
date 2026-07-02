# Handoff para Claude Code — Carril Producto/Dominio

> Leer junto con `docs/ARQUITECTURA-Y-DECISIONES.md` y `docs/BIBLIA-PRODUCTO-FINANCIERO.md`.
> Fecha: 2026-07-01.

## Contexto

MEDIOS, DATOS y F5 ya estan avanzando en otro carril. Este handoff no busca duplicar eso.

El objetivo paralelo es transformar Octopus Finance desde "app que ordena movimientos" hacia "app que entiende la realidad financiera hibrida de Pancho: persona + empresa + tarjetas personales + clientes que pagan tarde".

Nota de producto importante: Pancho no busca cambiar su operacion ni que la app lo empuje a reembolsarse. Si Octopus paga software con su tarjeta personal, esta bien. La app debe ordenarlo y reflejarlo correctamente, no convertirlo automaticamente en deuda interna.

Decisiones confirmadas:

- Familia representa Pancho + Javiera; no crear `Pancho personal` por ahora.
- Ahorro/sobrante debe ser consolidado total despues de obligaciones de Empresa + Familia.
- Los cargos mezclados en tarjeta personal deben quedar etiquetados por workspace/categoria/subcategoria.
- La plata de clientes puede entrar a cuenta de Empresa y luego distribuirse a IVA, imposiciones, gastos empresa y cuenta personal.
- La app debe avisar atrasos de clientes y, como feature futura, preparar/enviar correos de cobranza.
- La captura diaria de gastos con tarjeta es parte deseada del flujo. La cartola posterior debe conciliar contra esos registros, no duplicarlos.

## Tesis a respetar

La atribucion economica y la mecanica de pago son distintas.

Caso central:

- Software de Octopus pagado con tarjeta personal.
- Debe contar como gasto de Empresa.
- No debe bajar caja el dia de compra.
- Debe aumentar deuda de tarjeta.
- Cuando se paga la tarjeta, baja caja de la cuenta pagadora.
- Producto debe poder mostrar que Empresa uso un instrumento personal, sin asumir que hay reembolso pendiente.

## Plan que propongo implementar despues de MEDIOS/DATOS/F5

### 1. P0 — Alinear lenguaje y contratos

No crear grandes features todavia. Primero hacer que las pantallas hablen el mismo idioma:

- Resumen: rotular claramente caja, deuda, cobros, IVA y obligaciones.
- Asesor: explicar si una recomendacion viene de caja, deuda, cobro atrasado o dato faltante.
- Flujo: mantener consistencia semanal/mensual.
- Centro de Deuda: reforzar que es deuda real por cartola, no P&L.
- Cierre Mensual: agregar checks de deuda/arrastre/uso cruzado de instrumentos cuando exista la data.
- Definir y mostrar sobrante/faltante consolidado despues de obligaciones.

### 2. P1 — Insight de uso cruzado de instrumentos sin nueva coleccion

Crear helper puro, probablemente en `client/src/domain/instrument-usage.ts` o similar.

Input:

- `transactions`
- `accounts`

Logica inicial:

- Tomar transacciones `movementType=expense`, `paymentMethod=credit_card`, no canceladas.
- Resolver `cardAccountId` contra cuenta tipo `credit_card`.
- Comparar `transaction.workspace` con `cardAccount.workspace`.
- Si son distintos, crear fila de uso cruzado:
  - `economicWorkspace`
  - `instrumentWorkspace`
  - `cardAccountId`
  - `transactionId`
  - `amount`
  - `date`
  - `monthKey`

MVP de UI:

- En Resumen o Asesor: "Empresa pago $X con tarjeta personal este mes".
- En detalle: listar cargos principales.
- En Panel de Tarjetas: mostrar workspace en la tabla de compras del ciclo.

Importante:

- No duplicar P&L.
- No crear transferencia automatica.
- No asumir que hay que reembolsar. El default conceptual es "solo trazabilidad".

### 3. P2 — Narrativa de arrastre

Mejorar `buildCardDebt`/consumidores para que el usuario entienda deuda vieja vs ciclo actual.

Producto:

- "Vence este mes": deuda del ciclo con vencimiento futuro.
- "Vencido": deuda cuyo `pagarHasta < asOf`.
- "Arrastre": deuda pendiente originada en ciclo anterior o pago parcial/tardio.

UI:

- Centro de Deuda debe mostrar origen y vencimiento.
- Resumen/Asesor deben decir "vencido de tarjeta" distinto de "tarjeta a pagar".

### 4. P2b — Captura diaria + conciliacion de cartola

Estado actual observado:

- `buildTransactionMatchKey` exige fecha, nombre, monto, tipo y cuenta/tarjeta bastante exactos.
- `findExistingTransactionForPayload` usa esa clave exacta al convertir/importar.
- Conciliacion (`scoreReconciliationCandidate`) es mas flexible: monto, fecha, misma cuenta/tarjeta, tipo y similitud de texto.
- Para compras manuales de tarjeta, si el nombre manual difiere de la descripcion de la cartola, la deteccion exacta puede fallar aunque conciliacion luego pueda proponer match.

Objetivo:

- Registrar gastos diariamente debe ser seguro.
- Al importar cartola, las filas ya registradas deben quedar como duplicado/match posible y conciliarse contra la transaccion manual.
- No crear segunda transaccion salvo que no haya match razonable.
- Regla confirmada por Pancho: si fecha exacta y monto exacto coinciden, se puede vincular aunque el nombre no sea igual. Para evitar falsos positivos, aplicar esto dentro del mismo instrumento/cuenta/tarjeta y tipo de movimiento.

Implementacion sugerida:

- Extraer helper de matching estructural para compras de tarjeta desde la logica de conciliacion.
- Usarlo en importacion/conversion como preflight antes de crear transaccion.
- Criterio fuerte: mismo `cardAccountId` o tarjeta resuelta, monto igual/casi igual, fecha exacta o cercana, `movementType=expense`, `paymentMethod=credit_card`.
- Texto ayuda, pero no debe ser requisito para matches de tarjeta con monto/fecha/tarjeta fuertes.
- Para auto-match fuerte, priorizar fecha exacta + monto exacto + misma tarjeta/cuenta + mismo tipo; usar fecha cercana o monto cercano como match posible con confirmacion.

### 5. P3 — Mes Financiero

Antes de crear nueva pagina, probar como bloque en Resumen:

1. Caja real hoy.
2. Cobros esperados/atrasados.
3. Obligaciones de caja.
4. Tarjetas y arrastre.
5. Uso cruzado de instrumentos.
6. Resultado economico.
7. Pendientes para cierre.

Si funciona, evaluar ruta dedicada despues.

## Brechas a buscar al revisar la app

1. Pantallas donde "gasto" significa a veces gasto economico y a veces salida de caja.
2. Pagos de tarjeta apareciendo como gasto duplicado en algun resumen.
3. Cargos de Empresa en tarjeta personal sin explicacion visible.
4. Cobros atrasados que no se conectan con riesgo de pagar tarde tarjetas.
5. Ahorro calculado sin descontar deuda vencida o arrastre.
6. `shared` usado como workspace ambiguo en cuentas/categorias/movimientos.
7. Cierre Mensual sin check explicito de tarjeta/cartola/arrastre.

## Archivos relevantes

- `docs/BIBLIA-PRODUCTO-FINANCIERO.md`
- `docs/ARQUITECTURA-Y-DECISIONES.md`
- `client/src/domain/cash-obligations.ts`
- `client/src/domain/debt.ts`
- `client/src/domain/account-identity.ts`
- `client/src/lib/finance.ts`
- `client/src/lib/advisor.ts`
- `client/src/pages/overview.tsx`
- `client/src/pages/cash-flow.tsx`
- `client/src/pages/debt.tsx`
- `client/src/pages/credit-cards-panel.tsx`
- `client/src/pages/monthly-close.tsx`

## No hacer por ahora

- No crear una gran refactorizacion de data model sin validar el insight inferido primero.
- No agregar reembolsos automaticos.
- No cambiar `accountId` historico a la fuerza.
- No mezclar pago de tarjeta con gasto economico.
- No mover F5 arriba de este trabajo salvo riesgo de costo/abuso inmediato.

## Primer PR sugerido

Titulo:

`Producto: detectar uso cruzado entre workspace e instrumento`

Contenido:

- Helper puro `buildCrossWorkspaceInstrumentUsage`.
- Tests con:
  - gasto business en tarjeta family;
  - gasto family en tarjeta family;
  - gasto business con banco business;
  - tarjeta sin resolver;
  - transaccion cancelada.
- Integracion liviana en Asesor facts o Resumen, solo lectura.

## PR sugerido para captura diaria

Titulo:

`Conciliacion: evitar duplicados entre captura diaria y cartola`

Contenido:

- Helper puro de match estructural para compras de tarjeta.
- Tests con:
  - compra manual "Mall" y cartola "COMERCIO PARQUE ARAUCO" mismo monto/fecha/tarjeta;
  - mismo monto/fecha/tarjeta/tipo con nombre distinto debe marcar match fuerte;
  - fecha con desfase 1-3 dias;
  - mismo monto pero tarjeta distinta;
  - mismo monto y tarjeta pero fecha lejana;
  - compra recurrente legitima que no debe colapsarse si fechas/montos no calzan.
- Integracion en preflight de importacion/conversion y/o Revisión de cartola.

## Feature futura: cobranza por correo

Estado actual observado:

- `ClientPayment` y `Client` tienen `email`.
- `ClientPayment` tiene `dueDate`, `expectedDate`, `status`.
- No se encontro flujo existente de envio de correos de cobranza.

MVP recomendado:

- Boton "Preparar recordatorio" en Ingresos Clientes para cobros vencidos/por vencer.
- Borrador editable antes de enviar.
- Registro de ultimo recordatorio para no insistir a ciegas.
- Envio solo con confirmacion.
