# Octopus Finance — Biblia de Producto Financiero

> Documento normativo. Define como debe pensar la app, no solo como funciona hoy.
> Ultima revision: 2026-07-01.

## 1. La pregunta central

Octopus Finance existe para responder, cada mes:

1. Cuanta plata real tengo disponible.
2. Cuanta plata deberia entrar y que tan confiable es esa entrada.
3. Cuanta plata tengo que pagar este mes.
4. Que parte de lo que pago es personal, empresa o consulta, aunque el instrumento de pago sea compartido.
5. Que deuda o arrastre queda para el mes siguiente.
6. Si puedo ahorrar, si estoy apretado o si parte de la operacion esta pasando por instrumentos personales.

La app no debe ser solo un registro de movimientos. Debe ser una superficie de decision mensual.

## 2. Decisiones confirmadas por Pancho

Estas decisiones reflejan la operacion real; la app debe ordenarla, no corregirla.

1. **Los gastos de Empresa pagados con tarjeta personal son validos.**
   Deben verse como gastos de Empresa. No son un error ni generan reembolso automatico.

2. **Los cargos de una tarjeta pueden estar mezclados.**
   La misma tarjeta puede tener software de Empresa, comida de Familia, gastos personales, etc. Cada cargo debe distinguirse por categoria/subcategoria y workspace.

3. **La cuenta donde entran clientes puede financiar la vida operativa completa.**
   Entran cobros de Empresa; desde ahi se separa IVA/imposiciones/empresa y tambien se transfiere plata a cuentas personales para pagar tarjeta, comida y compromisos familiares.

4. **"Tengo que pagar este mes" se responde por separado y consolidado.**
   La app debe poder decir:
   - compromisos/obligaciones de Empresa;
   - compromisos/obligaciones de Familia;
   - total consolidado;
   - si alcanza, sobra o falta.

5. **Si un cliente paga tarde, la app debe avisar riesgo de caja y apoyar cobranza.**
   La siguiente funcion de producto deseada es enviar correos recordatorios de cobranza. Hoy el modelo tiene emails y vencimientos de clientes, pero el envio de correos debe tratarse como feature nueva.

6. **"Puedo ahorrar" es una cifra consolidada total.**
   Debe mirar caja total despues de obligaciones, compromisos, IVA, tarjetas, vencidos y cobros razonablemente esperados. Luego puede abrirse por Empresa/Familia, pero el semaforo principal es consolidado.

7. **Familia representa a Pancho + Javiera.**
   No separar `Pancho personal` de `Familia` por ahora.

8. **El uso cruzado de instrumentos no debe ser alerta de problema por defecto.**
   Interesa que este marcado y ordenado para analizar cuanto cuesta la Empresa y cuanto cuesta la vida familiar, no para corregir la forma de operar.

9. **La captura diaria es deseable.**
   La app debe permitir registrar compras/gastos el mismo dia para tener control diario. Cuando llega la cartola, esa cartola debe servir para verificar, conciliar y completar, no para duplicar lo ya registrado.

10. **La cartola es fuente de verificacion operacional.**
    Si un gasto fue registrado manualmente y luego aparece en la cartola, el sistema debe proponer un match y conciliarlo contra la transaccion existente. Solo debe crear una nueva transaccion si no hay match razonable.

## 3. Tesis de dominio

La regla mas importante:

> La atribucion economica y la mecanica de pago son dos cosas distintas.

Ejemplo: un software de Octopus pagado con la tarjeta personal de Pancho es:

- Economicamente: gasto de Empresa.
- Operativamente: cargo en tarjeta personal.
- En caja: no sale plata el dia de la compra; sale cuando se paga la tarjeta.
- En deuda: aumenta la obligacion de tarjeta.
- En lectura interna: la Empresa uso un instrumento personal, pero eso no implica automaticamente que exista un reembolso pendiente.

Por eso la app debe separar cuatro capas:

1. **Hecho economico:** que paso y a que mundo pertenece.
2. **Instrumento:** con que cuenta o tarjeta se movio la plata.
3. **Caja:** cuando entra o sale plata real.
4. **Obligacion/deuda:** que queda pendiente y contra quien.

## 4. Vocabulario canonico

### Workspace

Responde "a quien le corresponde economicamente".

- `business`: Octopus Media / Empresa.
- `family`: vida personal/familiar.
- `dentist`: consulta de Javiera.
- `shared`: legacy o excepciones; no debe ser la primera opcion para cuentas nuevas.

El `workspace` de un gasto no depende necesariamente de la tarjeta usada.

### Cuenta bancaria

Instrumento de caja. Su saldo representa plata disponible o deuda bancaria directa.

Campo principal: `accountId`.

### Tarjeta de credito

Instrumento de financiamiento. No representa salida inmediata de caja cuando se compra.

Campo principal: `cardAccountId`.

Regla:

- En una compra con tarjeta, `cardAccountId` es la tarjeta usada.
- En un pago de tarjeta, `accountId` es la cuenta que paga y `cardAccountId` es la tarjeta pagada.
- Nunca usar `accountId` para representar "la tarjeta" en pagos de tarjeta.

### Movimiento

Registro atomico visible para el usuario: ingreso, gasto, transferencia o pago de tarjeta.

Un movimiento puede afectar resultado economico, caja, deuda o mas de una capa, segun su tipo.

### Compromiso

Obligacion esperada de pago. Sirve para saber que viene y que falta pagar.

Si el compromiso se paga con tarjeta, no debe aparecer como salida de caja individual. La salida de caja sera el pago real de la tarjeta.

### Cartola / estado de cuenta

Fuente externa de verdad operacional. Permite saber que paso en bancos y tarjetas.

Para tarjetas, la cartola define el ciclo facturado, fecha de vencimiento y deuda real del periodo.

La cartola no debe reemplazar automaticamente la captura diaria. Debe confirmar lo registrado, detectar omisiones y corregir datos cuando el usuario lo apruebe.

### Obligacion de caja

Lo que efectivamente hay que pagar con plata disponible.

Motor canonico actual: `buildCashObligations`.

Incluye:

- Compromisos no-tarjeta pendientes.
- Pago real de tarjeta desde cartola, neteado por pagos ya hechos.

Excluye:

- Suscripciones/cargos individuales pagados con tarjeta.
- Placeholders legacy de pago de tarjeta.

### Deuda

Monto pendiente contra banco, tarjeta, cliente, persona o empresa.

La deuda de tarjeta no es igual al gasto economico del mes. Es lo que el banco exige pagar segun ciclos, pagos hechos y vencimientos.

### Arrastre

Obligacion que correspondia a un ciclo anterior pero sigue impaga hoy.

Regla: lo vencido pendiente se imputa como urgencia del mes actual, pero debe conservar memoria de su origen.

### Uso cruzado de instrumentos

Cuando un mundo economico usa el instrumento de otro mundo.

Caso clave: Empresa usa tarjeta personal de Pancho para software. La app deberia poder mostrarlo como orden y trazabilidad, no como deuda formal por defecto:

> "Octopus tuvo $X de gastos pagados con tarjeta personal. Estan bien atribuidos a Empresa, aunque el pago de caja salga desde la tarjeta/cuenta personal."

## 5. Invariantes del producto

Estas reglas no deberian romperse en ninguna pantalla:

1. **Una compra con tarjeta no baja caja hoy.**
   Baja caja cuando se paga la tarjeta.

2. **El gasto pertenece al workspace economico, no al instrumento.**
   Un cargo de empresa en tarjeta personal sigue siendo gasto de empresa.

3. **El pago de tarjeta es salida de caja, no gasto economico duplicado.**
   En P&L se mira el cargo; en caja se mira el pago.

4. **Lo vencido no desaparece.**
   Si una tarjeta se pago tarde o no se pago completa, la obligacion pendiente se arrastra como deuda actual.

5. **Las transferencias no crean resultado.**
   Mueven plata entre cuentas/workspaces. En consolidado deben cancelarse.

6. **Cliente pagado tarde afecta caja, no necesariamente resultado economico.**
   El servicio puede pertenecer a un mes, aunque la plata entre despues.

7. **Los numeros de decision deben tener fuente unica.**
   Si Resumen, Asesor y Flujo muestran "a pagar", deben venir del mismo motor.

8. **Captura diaria + cartola no deben duplicar gasto.**
   Si una compra fue registrada manualmente y luego aparece importada, la cartola debe quedar conciliada con esa transaccion existente.

9. **Las alertas deben cambiar conducta.**
   No mostrar alertas que solo reflejan ruido tecnico o numeros inflados.

10. **Toda deuda debe tener contraparte.**
   Banco, tarjeta, cliente, persona, empresa o SII.

11. **Toda cifra mensual importante debe decir que capa representa.**
    Caja, resultado, deuda, cobro esperado, IVA o ahorro.

## 6. Las preguntas que debe responder cada mes

### Salud inmediata

- Cuanta caja real tengo hoy por workspace.
- Que debo pagar antes de que entre nueva plata.
- Que pagos estan vencidos.
- Que pasa si los clientes se atrasan.

### Resultado del mes

- Cuanto facture/ingrese economicamente.
- Cuanto gaste economicamente.
- Que margen dejo la empresa.
- Que gastos personales/familiares consumieron caja o deuda.

### Deuda y arrastre

- Cuanto debo en tarjetas segun cartola.
- Que parte corresponde al ciclo actual.
- Que parte viene arrastrada por pago tardio o parcial.
- Que intereses/comisiones aparecieron por atraso, si existen.

### Uso cruzado de instrumentos

- Cuanto gasto de empresa se pago con instrumento personal.
- Cuanto gasto personal se pago con instrumento de empresa, si ocurre.
- Si eso esta bien clasificado economicamente, sin asumir que debe reembolsarse.

### Ahorro

- Cuanto quedaria despues de obligaciones reales, IVA y deuda vencida.
- Cuanto es ahorro sano vs plata que parece disponible porque se pateo una tarjeta o un cliente aun no pago.
- Cual es el sobrante consolidado total despues de Empresa + Familia, entendiendo que la caja puede moverse entre cuentas.

## 7. Modelo recomendado para casos mixtos

### Caso A: software de empresa pagado con tarjeta personal

Registro esperado:

- Transaction:
  - `movementType = expense`
  - `paymentMethod = credit_card`
  - `workspace = business`
  - `cardAccountId = tarjeta personal usada`
  - `accountId = null`

Impacto:

- P&L Empresa: suma como gasto.
- Caja Empresa: no baja el dia de la compra.
- Deuda tarjeta: sube en el ciclo correspondiente.
- Caja Familia/Pancho: baja cuando se paga la tarjeta desde cuenta personal.
- Insight futuro: Empresa uso una tarjeta personal, pero el gasto sigue siendo de Empresa. No crear deuda ni reembolso automatico.

### Caso B: pago de tarjeta personal desde cuenta personal

Registro esperado:

- Transaction:
  - `movementType = credit_card_payment`
  - `paymentMethod = bank_account`
  - `workspace = family` o workspace de la cuenta pagadora
  - `accountId = cuenta que paga`
  - `cardAccountId = tarjeta pagada`

Impacto:

- Caja: baja en cuenta pagadora.
- Deuda tarjeta: baja.
- P&L: no debe duplicar gasto.

### Caso C: cliente paga tarde y obliga a patear tarjeta

La app debe mostrar:

- Cobro esperado original.
- Fecha real o nueva fecha esperada.
- Obligacion de tarjeta vencida o parcialmente pagada.
- Riesgo de caja: "esta deuda se esta financiando por atraso de cliente".

Regla:

- El ingreso economico puede pertenecer al mes del servicio.
- La caja entra cuando el cliente paga.
- El pago tardio de tarjeta sigue como arrastre hasta que haya pago real.

### Caso D: pago parcial de tarjeta

La app debe mostrar:

- Facturado del ciclo.
- Pagado despues del cierre.
- Pendiente real.
- Vencimiento.
- Si el saldo pendiente quedo vencido.

No debe asumir que el siguiente estado de cuenta "arregla" el mes anterior. La deuda vieja sigue viva hasta que el banco/cartola/pagos demuestren lo contrario.

### Caso E: traspaso Empresa -> Pancho

Modelo futuro sugerido si alguna vez se quiere registrar un traspaso:

- Una transferencia o movimiento interno que reduzca financiamiento interno.
- No debe crear gasto nuevo si el gasto original ya existia.
- Debe mejorar caja de Familia/Pancho y reducir caja de Empresa.
- En consolidado, no crea ni destruye plata.
- No es obligatorio para que el gasto este "bien" si Pancho decide simplemente pagar la tarjeta personal con sus flujos habituales.

### Caso F: compra registrada hoy y luego aparece en cartola

Flujo esperado:

1. Pancho registra hoy una compra con tarjeta:
   - `movementType = expense`
   - `paymentMethod = credit_card`
   - `workspace = business` o `family`
   - `cardAccountId = tarjeta usada`
   - categoria/subcategoria elegida por el usuario.
2. La compra afecta P&L/deuda, pero no caja.
3. A fin de mes se importa la cartola.
4. La fila importada debe encontrar la transaccion existente por monto, fecha cercana, tarjeta y tipo.
5. El usuario confirma el match si hace falta.
6. La fila importada queda `reconciled`; no se crea una segunda transaccion.

Regla:

- Si coinciden fecha exacta, monto exacto, instrumento/tarjeta y tipo de movimiento, se debe considerar match fuerte aunque el nombre no sea igual.
- Si hay match confiable, conciliar.
- Si hay match posible, pedir confirmacion.
- Si no hay match, crear transaccion nueva desde la cartola.
- Si el nombre manual y la descripcion bancaria difieren, el sistema no debe depender solo del texto para detectar el match.

## 8. Pantallas y contrato de producto

### Resumen

Trabajo del usuario: decidir "que hago ahora".

Debe priorizar:

1. Caja real disponible.
2. Obligaciones urgentes y vencidas.
3. Cobros esperados y atrasados.
4. Deuda de tarjeta real.
5. Riesgo de caja por workspace.
6. Insight de uso cruzado de instrumentos si es material.
7. Sobrante/faltante consolidado despues de obligaciones.

No deberia priorizar:

- Metricas infladas por doble-conteo.
- Saldos totales sin explicar si son caja, deuda o resultado.
- Alertas tecnicas que no requieren accion.

### Tu asesor

Trabajo del usuario: recibir una lectura accionable.

Debe explicar:

- Que pagar primero.
- Que revisar.
- Que dato falta para confiar en el diagnostico.
- Que cliente o deuda esta tensionando caja.

La IA no debe inventar numeros. Los numeros vienen de facts calculados por codigo.

### Flujo de Caja

Trabajo del usuario: anticipar semanas peligrosas.

Debe separar:

- Real ejecutado.
- Proyectado confiable.
- Obligaciones de caja.
- Cobros esperados con fecha/riesgo.

El flujo semanal y mensual deben usar el mismo criterio de neto/IVA/obligaciones.

### Centro de Deuda

Trabajo del usuario: entender cuanto se debe de verdad.

Debe mostrar:

- Deuda por tarjeta, por identidad estructural.
- Facturado, pagado, pendiente.
- Vencido vs no vencido.
- Deuda nacional + internacional.
- Arrastre y pagos post-cierre.

No debe transformarse en P&L ni en presupuesto.

### Panel de Tarjetas

Trabajo del usuario: operar y revisar tarjetas.

Debe permitir:

- Ver cargos del ciclo.
- Ver cuotas futuras.
- Relacionar tarjeta con cuenta pagadora.
- Detectar cargos por workspace economico.
- Entender que cargos de empresa viven dentro de una tarjeta personal.
- Mostrar el workspace de los cargos mezclados de forma visible, no solo inferible desde categoria.

### Estado de Resultados / P&L

Trabajo del usuario: ver rendimiento economico.

Debe incluir compras con tarjeta en el mes economico correcto, aunque no se hayan pagado aun.

No debe incluir pagos de tarjeta como gasto adicional.

### Cierre Mensual

Trabajo del usuario: congelar una foto confiable.

Debe chequear:

- Cartolas importadas.
- Conciliacion.
- Categorias y cuentas completas.
- Cobros de clientes.
- Obligaciones vencidas.
- Deuda de tarjeta pendiente.
- Uso cruzado de instrumentos material.

## 9. Brechas actuales conocidas

Estas brechas son de producto/dominio, no necesariamente bugs puntuales:

1. **No existe insight explicito de uso cruzado de instrumentos.**
   Hoy se puede inferir por `workspace` + `cardAccountId`, pero no se expresa claramente para el usuario.

2. **El usuario no siempre sabe que capa esta mirando.**
   Algunas pantallas muestran deuda, caja, resultado o presupuesto sin rotulos suficientemente fuertes.

3. **La navegacion esta organizada por modulos, no por ritual mensual.**
   Para una app de 2 usuarios puede funcionar, pero el trabajo real es: importar -> revisar -> conciliar -> decidir pagos -> cobrar -> cerrar.

4. **Los pagos tardios necesitan narrativa propia.**
   El sistema ya puede calcular deuda pendiente, pero falta explicar arrastre: que venia de antes, que vencio, que se pago tarde y que queda.

5. **Clientes atrasados y tarjetas vencidas no estan unidos como tension de caja.**
   Producto deberia poder decir: "si este cliente no paga antes de X, esta obligacion queda apretada".

6. **Ahorro debe ser consolidado y conservador.**
   Debe distinguir sobrante sano de caja temporalmente inflada por deuda pateada o cobros aun no recibidos.

7. **`shared` sigue existiendo como estado ambiguo.**
   Debe tratarse como legacy/excepcion y aparecer en Salud de Datos si afecta decisiones.

8. **No existe envio de correos de cobranza.**
   El modelo de clientes tiene `email`, `dueDate` y `expectedDate`, pero falta una feature explicita para generar/enviar recordatorios.

9. **La deteccion de duplicados exactos puede ser insuficiente para captura diaria.**
   La conciliacion por cuenta/tarjeta usa monto, fecha, tipo y similitud, pero la deteccion automatica al convertir/importar puede depender demasiado de nombre exacto. Para compras manuales como "Mall" vs descripcion bancaria, debe preferirse conciliacion estructural antes de crear duplicados.

## 10. Roadmap de producto paralelo a MEDIOS/DATOS/F5

### P0 — Alinear lenguaje y contratos

Objetivo: que cada pantalla use los mismos conceptos.

Acciones:

- Agregar labels de capa: Caja, Resultado, Deuda, Cobro, IVA, Arrastre.
- Documentar en codigo que motor alimenta cada cifra central.
- Asegurar que Resumen, Asesor y Flujo usen el mismo "a pagar".
- Revisar textos de pantalla para evitar "gasto" cuando se habla de "pago de tarjeta".
- Definir el calculo de "sobrante/faltante consolidado" como metrica principal de ahorro.

### P1 — Mapa de uso cruzado de instrumentos

Objetivo: detectar gastos cuyo workspace economico no coincide con el workspace del instrumento, sin tratarlos como error.

Primer enfoque sin nueva coleccion:

- Inferir casos desde transacciones con `paymentMethod=credit_card`.
- Resolver `cardAccountId` a cuenta-tarjeta.
- Comparar `transaction.workspace` con `cardAccount.workspace`.
- Agrupar por mes y mostrar insight: "Empresa uso tarjeta/cuenta personal por $X".
- En Panel de Tarjetas, hacer visible el workspace de cada compra del ciclo.

Despues, si hace falta:

- Permitir una lectura opcional: "solo trazabilidad", "quiero reembolsarlo", "aporte/asumido". El default debe ser solo trazabilidad.

### P2 — Narrativa de arrastre

Objetivo: explicar pagos tardios sin perder continuidad mensual.

Acciones:

- En Centro de Deuda: mostrar "origen del saldo" por ciclo.
- En Resumen/Asesor: separar "vence este mes" de "vencido de meses anteriores".
- En Flujo: imputar vencidos a hoy, pero mostrar fecha original.

### P2b — Captura diaria + conciliacion de cartola

Objetivo: que registrar gastos diariamente sea seguro.

Acciones:

- Definir un helper de matching estructural para compras de tarjeta: monto, fecha cercana, `cardAccountId`/tarjeta, tipo y workspace.
- Usarlo en importacion/conversion para marcar como duplicado o match posible aunque el texto difiera.
- En Revisión de cartola, mostrar "ya registrado manualmente" cuando exista match.
- En Conciliacion, mantener confirmacion humana para matches no obvios.
- No borrar la transaccion manual por defecto; conciliar la fila de cartola contra ella.
- Regla fuerte: fecha exacta + monto exacto + misma tarjeta/cuenta + mismo tipo basta para vincular, aunque el nombre bancario sea distinto.

### P3 — Vista "Mes Financiero"

Objetivo: una pantalla/agrupacion que siga el ritual real.

Orden sugerido:

1. Estado de caja hoy.
2. Cobros esperados y atrasados.
3. Obligaciones a pagar.
4. Tarjetas/deuda.
5. Uso cruzado de instrumentos.
6. Resultado economico del mes.
7. Cierre y pendientes de datos.

Puede empezar como reordenamiento/links dentro del Resumen antes de crear una pagina nueva.

### P4 — Simulacion simple

Objetivo: responder "que pasa si me pagan tarde".

MVP:

- Permitir mover fecha esperada de cobros relevantes.
- Mostrar impacto en saldo proyectado y vencimientos de tarjeta.
- No escribir en Firestore hasta que el usuario confirme cambios reales.

### P5 — Cobranza asistida

Objetivo: reducir atraso de clientes sin salir de la app.

MVP:

- Detectar cobros `receivable`/`invoiced` vencidos o por vencer.
- Generar borrador de correo con monto, vencimiento y contexto.
- Registrar fecha de ultimo recordatorio enviado o preparado.
- No enviar automaticamente sin confirmacion del usuario.

## 11. Criterios de aceptacion para futuros cambios

Antes de implementar o aceptar cambios en finanzas, responder:

1. Esta cifra representa caja, resultado, deuda, cobro, IVA o ahorro?
2. Cual es la fuente unica de verdad?
3. El cambio puede duplicar gastos de tarjeta?
4. Que pasa si el pago de tarjeta fue parcial o tardio?
5. Que pasa si el gasto es de Empresa pero la tarjeta es personal?
6. Que pasa si el cliente paga despues del mes de servicio?
7. Como se ve esto en Resumen, Flujo, Asesor y Cierre?
8. Que alerta accionable queda para el usuario?
9. Si el usuario lo registro manualmente y luego aparece en cartola, se concilia o se duplica?

Si una respuesta no esta clara, primero ajustar modelo/producto antes de tocar UI.
