# Octopus Finance — Auditoria de Brechas Producto/Dominio

> Pasada 1 basada en lectura de codigo y docs. Complementar con revision visual de la app.
> Fecha: 2026-07-01.

## Marco de evaluacion

Esta auditoria usa la biblia de producto como contrato:

- Separar atribucion economica de mecanica de pago.
- Separar caja, resultado, deuda, cobros, IVA, arrastre y ahorro.
- Evitar doble-conteo de tarjetas.
- Hacer visibles los casos hibridos: Empresa usando tarjeta personal, clientes atrasados y pagos tardios.
- No transformar automaticamente el uso de tarjeta personal para gastos de Empresa en deuda interna o reembolso pendiente.
- Soportar captura diaria de gastos y conciliacion posterior con cartola sin duplicar.

## Lectura general

La app esta en un buen punto tecnico: ya existe una fuente comun para obligaciones de caja (`buildCashObligations`) y el Centro de Deuda tiene una logica mas estructural (`buildCardDebt`). La brecha principal ya no parece ser "faltan datos", sino "falta una narrativa de decision que una los modulos".

Hoy la navegacion esta por modulos:

- Panorama: Resumen, Asesor, Flujo, Deuda, Suscripciones, Analisis, P&L.
- Operacion mensual: Movimientos, Revision, Conciliacion, Automatizacion, Tarjetas, Cierre.
- Planificacion: Presupuesto, Ingresos Clientes.
- Ajustes.

Pero el trabajo real del usuario probablemente es por ritual mensual:

1. Que entro o deberia entrar.
2. Que tengo que pagar.
3. Que tarjeta/deuda esta vencida o por vencer.
4. Si Empresa y Familia, juntas, alcanzan para pagar todo.
5. Que compras ya registre manualmente y cuales confirma la cartola.
6. Que se pago con instrumentos cruzados entre Empresa/Familia.
7. Que datos faltan para confiar.
8. Si puedo cerrar el mes o ahorrar.

## Brechas P0 — lenguaje y contratos

### 1. "Gasto" puede significar cosas distintas

Riesgo:

- En algunas superficies el usuario puede leer "gasto" como gasto economico.
- En otras, "gasto" se acerca a salida de caja.
- En tarjetas, la palabra puede confundir cargo individual con pago de tarjeta.

Impacto:

- Pancho puede desconfiar de la app aunque el numero sea tecnicamente correcto.

Recomendacion:

- Rotular cifras importantes con capa: `Resultado`, `Caja`, `Deuda`, `Obligacion`, `Cobro`, `IVA`, `Arrastre`.
- En tarjetas usar "cargo de tarjeta" para compras y "pago de tarjeta" para caja.

### 2. Resumen necesita convertirse en "decision del mes"

Estado actual esperado:

- Ya muestra caja real, deuda TC, IVA y alertas desinfladas.

Brecha:

- Falta una lectura compacta tipo:
  - "Disponible hoy"
  - "Entra esperado"
  - "A pagar"
  - "Vencido/arrastre"
  - "Empresa uso tarjeta personal"
  - "Sobrante/faltante consolidado"

Recomendacion:

- Agregar o reordenar un bloque "Mes financiero" en Resumen antes de crear una pagina nueva.

### 3. Asesor deberia explicar la causa de la recomendacion

Estado actual:

- `buildAdvisorFacts` protege que la IA no invente numeros.

Brecha:

- Si recomienda pagar o revisar algo, deberia decir la capa: caja, deuda, cobro atrasado, dato faltante o posible duplicado.

Recomendacion:

- En facts o UI, asociar cada alerta con `reasonKind`: `cash`, `debt`, `late_income`, `missing_data`, `instrument_usage`, `duplicate`.

## Brechas P1 — uso cruzado de instrumentos

### 4. No existe insight visible para Empresa pagada con tarjeta personal

Estado actual:

- La data permite inferirlo: transaction workspace + `cardAccountId` + account workspace.

Brecha:

- El usuario no ve explicitamente que Empresa esta usando instrumento personal.
- Esto no debe presentarse como error ni deuda automatica; es una forma valida de operar.

Recomendacion MVP:

- Crear helper puro `buildCrossWorkspaceInstrumentUsage`.
- Mostrar en Resumen/Asesor:
  - "Empresa pago $X con tarjeta personal este mes"
  - "Principales cargos"
  - "No es gasto nuevo; ya esta en P&L. Es trazabilidad del instrumento."

### 5. No hay una lectura clara de "esto esta bien, solo esta cruzado"

Brecha:

- Si se detecta uso cruzado, la app podria dar la sensacion de que hay algo que corregir.

Recomendacion:

- Primero solo insight.
- El tono debe ser descriptivo, no correctivo.
- Mas adelante se puede permitir tratamiento opcional si Pancho lo necesita, pero no como default.

No crear movimientos automaticos en el MVP.

### 5b. Panel de Tarjetas no hace suficientemente visible el workspace en compras

Estado actual:

- La tabla de compras del ciclo muestra fecha, tarjeta, categoria, detalle y monto.
- La data tiene `workspace` y la tabla de pagos si muestra ambito.

Recomendacion:

- Agregar columna/chip de `Ambito` en compras del ciclo para que los cargos mezclados se entiendan sin abrir detalle.

## Brechas P2 — arrastre y pagos tardios

### 6. Centro de Deuda muestra deuda real, pero falta narrativa de origen

Estado actual:

- `buildCardDebt` muestra facturado, pagado, pendiente, vencimiento, pagos post-cierre e historial.

Brecha:

- El usuario necesita leer rapidamente:
  - esto vence ahora;
  - esto ya vencio;
  - esto viene arrastrado;
  - esto se pago parcial/tarde.

Recomendacion:

- Agregar badges/filas:
  - `Ciclo actual`
  - `Vencido`
  - `Arrastre`
  - `Pago parcial`

### 7. Clientes atrasados y tarjetas vencidas no aparecen conectados

Brecha:

- La app puede saber cobros esperados y obligaciones, pero falta una frase de decision:
  - "Si Cliente X no paga antes del 12, la tarjeta Y queda sin caja suficiente."

Recomendacion:

- En Asesor o Flujo, cruzar top cobros esperados con vencimientos de tarjeta/obligaciones cercanas.
- Hacerlo primero como insight, no como simulador complejo.

## Brechas P2b — captura diaria y duplicados de cartola

### 7b. Registrar hoy y subir cartola despues puede no auto-resolverse siempre

Estado actual:

- La app tiene deteccion de duplicados al importar/convertir.
- La deteccion exacta usa clave por fecha, nombre, monto, tipo y cuenta/tarjeta.
- La conciliacion es mas flexible y puede proponer matches por monto, fecha, tarjeta/cuenta y tipo.

Riesgo:

- Si Pancho registra "Mall 3 cuotas" y la cartola luego trae una descripcion bancaria distinta, la deteccion exacta podria no marcarlo automaticamente como duplicado.
- Si se convierte desde la bandeja sin revisar el match, podria aparecer una segunda transaccion.

Recomendacion:

- Convertir "captura diaria + cartola" en contrato explicito del producto.
- Agregar matching estructural de tarjeta antes de crear transacciones desde cartola.
- En Revisión de cartola, mostrar "posible ya registrado" aunque el texto no coincida.
- Conciliar la fila importada contra la transaccion manual en vez de borrar/recrear.
- Regla fuerte confirmada: fecha exacta + monto exacto + mismo instrumento/cuenta/tarjeta + mismo tipo debe vincular aunque el nombre no coincida.

## Brechas P3 — cierre mensual

### 8. Cierre Mensual puede cerrar contabilidad sin cerrar la historia de deuda

Estado actual:

- Tiene checklist de datos, categorias, cobros, import batches, etc.

Brecha:

- Faltan checks orientados a esta realidad:
  - cartolas de tarjeta del mes cargadas;
  - pago de tarjeta asociado a `cardAccountId`;
  - deuda vencida/arrastre explicada;
  - uso cruzado de instrumentos revisado si supera umbral.

Recomendacion:

- Agregar checks informativos antes de bloquear cierre. No bloquear duro al inicio; mostrar "revisar".

## Brechas P4 — informacion y navegacion

### 9. `shared` sigue siendo semanticamente caro

Brecha:

- Si `shared` aparece en cuentas/movimientos relevantes, puede romper lectura de caja por workspace.

Recomendacion:

- Salud de Datos deberia tratar `shared` en cuentas activas como advertencia de clasificacion, salvo excepciones permitidas.

### 10. Falta una vista de ritual mensual

Brecha:

- La navegacion por modulos obliga al usuario a saber donde vive cada pregunta.

Recomendacion:

- Probar primero en Resumen un bloque "Mes financiero".
- Si funciona, moverlo a pantalla dedicada o convertirlo en home principal.

### 11. Cobranza por correo no existe como flujo

Estado actual:

- Clientes/cobros tienen email y fechas.
- La app detecta cobros vencidos/esperados en varias superficies.
- No hay envio o preparacion de correos de cobranza.

Recomendacion:

- Agregar MVP de recordatorios: generar borrador, confirmar envio, guardar fecha/estado del recordatorio.

## Priorizacion recomendada

1. P0: lenguaje/rotulos y contratos de cifras.
2. P1: helper + insight de uso cruzado de instrumentos.
3. P2: narrativa de arrastre en deuda/resumen/asesor.
4. P2b: captura diaria + conciliacion de cartola sin duplicados.
5. P3: checks de cierre mensual orientados a tarjetas/arrastre.
6. P4: sobrante/faltante consolidado y reorganizacion de ritual mensual.
7. P5: cobranza asistida por correo.

## Preguntas abiertas para revisar en app real

1. En Resumen, cual es el primer numero que Pancho cree que debe mirar?
2. Al ver Centro de Deuda, queda claro que es "facturado - pagado" y no gasto del mes?
3. En Flujo semanal, se entiende que una tarjeta vencida cae como obligacion de caja?
4. En Panel de Tarjetas, se ve el workspace economico de cada cargo o solo la tarjeta?
5. En Cierre Mensual, que haria Pancho si hay deuda vencida pero todos los datos estan conciliados?
6. Que pantalla muestra mejor hoy "puedo ahorrar" y que descuenta realmente?
