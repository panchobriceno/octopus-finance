# Automatizacion mensual - base implementada

Fecha: 2026-06-23

## Objetivo

Resolver la base operativa para que la app no dependa de crear movimientos manualmente durante el mes:

- Compromisos esperados por mes.
- Movimientos reales importados/sincronizados.
- Conciliacion automatica.
- Bandeja mensual de pendientes.

## Modelo implementado

### CommitmentTemplate

Plantilla recurrente. Representa obligaciones que se esperan todos los meses:

- Nombre y categoria.
- Monto fijo o variable.
- Dia esperado de pago.
- Ambito: empresa, familia, consulta o compartido.
- Cuenta esperada.
- Tarjeta asociada si aplica.
- Keywords para matching.
- Tolerancia de monto y fecha.
- Estado activo/inactivo.

### CommitmentInstance

Instancia mensual generada desde una plantilla:

- Mes `YYYY-MM`.
- Fecha esperada.
- Monto esperado.
- Estado: pendiente, pagado u omitido.
- Movimiento real conciliado.
- Fecha de match/pago.

## Flujo implementado

1. Crear plantillas de compromisos recurrentes.
2. Crear plantillas desde presupuestos recurrentes existentes.
3. Generar compromisos de un mes.
4. Conciliar compromisos contra transacciones reales.
5. Marcar manualmente como pagado u omitido.
6. Ver cobertura, pendientes, vencidos, salida esperada y pagada.

## Archivos principales

- `shared/schema.ts`: tipos `CommitmentTemplate` y `CommitmentInstance`.
- `client/src/domain/commitments.ts`: motor puro de generacion, scoring y dashboard.
- `client/src/lib/firestore.ts`: colecciones y operaciones Firestore.
- `client/src/lib/hooks.ts`: hooks React Query.
- `client/src/pages/monthly-automation.tsx`: pantalla operativa.
- `client/src/App.tsx`: ruta `/automation`.
- `client/src/components/app-sidebar.tsx`: item de navegacion.

## Conciliacion actual

El motor intenta matchear compromisos pendientes con transacciones reales usando:

- Mes.
- Tipo de movimiento.
- Metodo de pago.
- Workspace.
- Cuenta esperada.
- Tarjeta esperada.
- Monto y tolerancia.
- Fecha y tolerancia.
- Keywords.

Si encuentra un match confiable:

- Cambia instancia a `paid`.
- Guarda `matchedTransactionId`.
- Guarda `matchedAt`.
- Usa la fecha del movimiento como `paidAt`.

## Siguiente etapa

### Importaciones bancarias

Crear una capa `BankImportSource` para:

- Santander.
- Banco Edwards / Banco de Chile.
- Itau.

Primero con archivos manuales, luego con conectores.

### Conectores posibles

- Fintoc como adapter profesional.
- Floid como alternativa.
- Browser assistant local para descarga semi-automatica con login manual.
- Parser de correos/notificaciones como senal secundaria.

### Lo que falta

- Entidad `ImportedMovement` separada de `Transaction`.
- Bandeja de revision para movimientos no conciliados.
- Reglas persistentes de categorizacion.
- Generacion automatica de transacciones reales desde movimientos confirmados.
- Seed/migracion de templates con cuentas esperadas por banco.
- Tests unitarios de `client/src/domain/commitments.ts`.
