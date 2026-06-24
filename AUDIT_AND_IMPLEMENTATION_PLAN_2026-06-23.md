# Auditorias siguientes y plan de implementacion - Octopus Finance

Fecha: 2026-06-23

## Decisiones base

- Hay datos reales, pero antiguos. Se deben respaldar antes de cualquier migracion.
- Se permite crear diagnosticos y migraciones, dejando backup/export antes de escribir.
- Prioridad: negocio Octopus, familia y tarjetas de credito.
- Caja significa saldo disponible.
- Las compras con tarjeta afectan deuda; caja cambia cuando se paga la tarjeta.
- Ingreso cliente real cuenta cuando el pago queda cargado/pagado.
- Cierre mensual recomendado: snapshot congelable, con recalculo preview antes de cerrar.
- Bancos/cartolas relevantes: Santander, Banco Edwards e Itau.
- Se prioriza dejar correcto aunque implique refactor grande.
- Se puede reorganizar la app si el modelo mental actual confunde.

## 1. Auditoria de datos

### Riesgos encontrados

- Transacciones permiten estados, workspaces, metodos de pago y montos sin validacion estricta.
- Categorias e items se referencian por nombre en varios reportes; renombrar puede romper historicos.
- Transferencias antiguas usan `destinationWorkspace` como texto libre de destino.
- Pagos cliente pueden quedar desalineados con su settlement en `transactions`.
- Tarjetas viven parcialmente en `localStorage`, `credit_card_settings` y transacciones.
- Importaciones no tienen una entidad `ImportBatch` formal; el lote vive duplicado en cada transaccion.

### Mejora iniciada

- Se agrego `destinationAccountId` al modelo de transaccion.
- Se creo `client/src/domain/finance-audit.ts` para detectar inconsistencias sin tocar datos.
- Se creo `npm run audit:data`, que exporta backup JSON y genera reporte markdown en `audits/`.

## 2. Auditoria de reconciliacion financiera

### Riesgos encontrados

- `currentBalance` se usaba como saldo inicial/base y tambien como saldo real.
- Cuentas calculaba saldo sumando movimientos encima de `currentBalance`, lo que puede duplicar si `currentBalance` ya es saldo banco.
- Flujo semanal restaba compras pendientes TC en fecha de compra, contrario a la regla definida.
- Cierre mensual usaba ingreso neto total, no neto pagado, como real.
- Ingreso familiar manual de Javi impactaba presupuesto pero no cierre.

### Mejora iniciada

- `currentBalance` queda tratado como saldo banco disponible.
- Se agrego un ledger de reconciliacion por cuenta: saldo banco vs saldo segun movimientos.
- Flujo semanal ahora excluye tarjetas como cuentas de caja y solo considera pagos TC proyectados.
- Cierre mensual usa `paidNet`, `paidVat` y `paidGross` para real.
- Cierre mensual suma ingreso manual familiar de Javi.

## 3. Auditoria UX de flujos criticos

### Hallazgos

- Resumen mezcla dashboard, creacion, edicion masiva, ordenamiento, filtros y forecast en una sola superficie.
- Ingresos Clientes mezcla alta de cliente, alta de pago, cobranza, migracion y tabla operativa.
- Presupuesto mezcla definicion de presupuesto, compromisos, orden, recurrencia y cierre familiar.
- Tarjetas muestra compras, pagos, cuotas, importaciones y vinculacion de cuenta en un mismo workspace.
- Importador es un flujo critico pero esta implementado como una pagina gigante.

### Direccion recomendada

- Resumen debe ser superficie de decision: caja disponible, deuda TC, ingresos por cobrar, alertas de cierre.
- Movimientos debe ser workspace operativo separado: crear, editar, filtrar, importar, reconciliar.
- Tarjetas debe tener una vista por tarjeta: deuda, proximo pago, cuotas, compras importadas, pagos aplicados.
- Cierre Mensual debe ser checklist: revisar ingresos, revisar gastos, revisar TC, reconciliar cuentas, congelar snapshot.

## 4. Auditoria performance y escalabilidad

### Riesgos encontrados

- Varias pantallas leen colecciones completas de Firestore.
- Calculos financieros pesados viven en render/memos de pantalla.
- Importador y Presupuesto tienen mucha logica local y arrays derivados.
- Bundle principal sigue grande.
- No hay paginacion/virtualizacion en tablas grandes.

### Direccion recomendada

- Mover calculos a dominio puro y memoizable.
- Crear queries por periodo/workspace para transacciones.
- Formalizar `ImportBatch` y procesar por lote.
- Separar pantallas pesadas con lazy routes.
- Virtualizar tablas de movimientos e importacion.

## 5. Auditoria testing y confiabilidad

### Riesgos encontrados

- No hay runner de tests configurado.
- Las reglas financieras centrales no tienen tests unitarios.
- El bug de Budget llego al navegador con `Maximum update depth exceeded`.
- No hay fixtures para cartolas Santander, Edwards e Itau.

### Direccion recomendada

- Agregar Vitest.
- Tests P0: caja, transferencias, TC, pagos cliente, cierre mensual, presupuesto.
- Fixtures de importacion por banco.
- Smoke tests de rutas principales con Playwright.

## 6. Auditoria arquitectura y mantenibilidad

### Riesgos encontrados

- Logica financiera dispersa por pantalla.
- Schemas Zod son permisivos.
- `localStorage` guarda datos que deberian vivir en Firestore.
- `workspace` no esta normalizado entre negocio/familia/dentist/shared.
- No hay snapshots de cierre mensual.

### Direccion recomendada

- Dominio compartido:
  - cuentas y ledger
  - transacciones e impactos
  - pagos cliente
  - tarjetas
  - presupuesto
  - cierre mensual
  - importaciones
- Repositorios Firestore tipados con validacion Zod estricta.
- Migraciones idempotentes con backup previo.
- Screens mas delgadas, enfocadas en interaccion.

## Plan por partes

### Parte 1 - Base confiable

1. Crear auditor de datos y backup.
2. Corregir transferencias nuevas con `destinationAccountId`.
3. Reinterpretar `currentBalance` como saldo banco.
4. Mostrar reconciliacion banco vs movimientos en Cuentas.
5. Corregir Budget loop y DOM invalid.
6. Alinear Flujo de Caja con regla TC.
7. Alinear Cierre Mensual con ingresos pagados.

### Parte 2 - Migraciones seguras

1. Correr `npm run audit:data`.
2. Revisar reporte generado en `audits/`.
3. Crear script de migracion de transferencias legacy.
4. Crear script de regularizacion pagos cliente.
5. Unificar tarjetas `localStorage` -> Firestore.

### Parte 3 - Dominio financiero

1. Extraer impactos de transaccion a dominio puro.
2. Extraer modelo TC: compras, pagos, cuotas, deuda.
3. Extraer presupuesto efectivo y compromisos.
4. Extraer cierre mensual como snapshot.
5. Ajustar pantallas para consumir modelos.

### Parte 4 - Importador bancario

1. Separar parsers por banco: Santander, Edwards, Itau.
2. Crear fixtures reales anonimizables.
3. Crear `ImportBatch`.
4. Mejorar dedupe y rollback por lote.

### Parte 5 - UX reorganizada

1. Resumen como dashboard de decision.
2. Movimientos como workspace operativo.
3. Tarjetas como workspace por tarjeta.
4. Cierre como checklist congelable.

## Implementacion iniciada en esta parte

- `shared/schema.ts`: se agrego `destinationAccountId`.
- `client/src/domain/accounts.ts`: nuevo modulo de saldo disponible y ledger por cuenta.
- `client/src/domain/finance-audit.ts`: nuevo auditor puro de datos/reconciliacion.
- `scripts/firestore-audit.ts`: backup + reporte markdown desde Firestore.
- `scripts/firestore-repair-data.ts`: reparacion idempotente con backup previo.
- `package.json`: nuevo comando `npm run audit:data`.
- `package.json`: nuevo comando `npm run repair:data`.
- `overview.tsx`: transferencias nuevas guardan cuenta destino por ID.
- `accounts.tsx`: saldos pasan a banco vs movimientos.
- `cash-flow.tsx`: caja semanal excluye compras TC y tarjetas como cuentas.
- `budget.tsx`: correccion de loop de render, DOM de drag y filtro de canceladas.
- `monthly-close.tsx`: real usa ingresos cliente pagados y suma ingreso familiar manual.

## Resultado ejecutado

- `npm run audit:data` inicial:
  - 80 transacciones, 24 categorias, 39 items, 38 presupuestos, 5 ingresos cliente, 10 cuentas.
  - 15 issues detectados.
  - 1 P1: transaccion importada con monto 0.
- `npm run repair:data`:
  - Backup previo creado en `audits/firestore-pre-repair-2026-06-23T06-29-41-912Z.json`.
  - 15 categorias faltantes creadas desde transacciones reales.
  - 1 transaccion con monto 0 anulada.
- `npm run audit:data` final:
  - Reporte final en `audits/finance-data-audit-2026-06-23T06-31-31-163Z.md`.
  - 0 issues activos.
- Validacion tecnica:
  - `npm run check` pasa.
  - `npm run build` pasa con warnings conocidos de bundle grande y `app-config.js`.
  - Smoke test browser en `/`, `/budget`, `/cash-flow`, `/accounts`, `/monthly-close` sin errores de consola.
