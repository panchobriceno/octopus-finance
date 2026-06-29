MANUAL DE OCTOPUS FINANCE
Cómo funciona tu app de finanzas, en lenguaje simple

Versión: junio 2026
Para qué sirve este documento: que puedas resolver dudas sobre tu app sin abrir el
código, y que la IA tampoco tenga que leer el código cada vez. Hay un gemelo técnico
de este manual dentro del proyecto (el archivo CLAUDE.md) pensado para la IA; este de
acá está escrito para vos, en lenguaje de negocio. Si la app cambia, conviene actualizar
los dos.


====================================================================
PARTE 1 — LAS 5 IDEAS BASE (entendé esto y entendés toda la app)
====================================================================

Toda la app se construye sobre cinco conceptos. Si los tenés claros, cada pantalla se
explica sola.

1) ÁMBITOS (workspaces): Empresa, Familia, Consulta Dentista.
   Cada movimiento pertenece a un ámbito. La app te deja ver todo junto ("Consolidado")
   o filtrar por uno. Sirve para no mezclar la plata de la agencia con la de la casa o
   la de la consulta. Casi toda pantalla tiene un selector de ámbito arriba.

2) TIPO DE MOVIMIENTO: ingreso, gasto, transferencia o pago de tarjeta.
   - Ingreso: entra plata.
   - Gasto: sale plata.
   - Transferencia: mueves plata de un ámbito/cuenta a otro (sale de uno, entra al otro;
     en el consolidado se cancela, no inventa ni destruye plata).
   - Pago de tarjeta: cuando pagas la deuda de una tarjeta de crédito desde tu cuenta.

3) MÉTODO DE PAGO: efectivo, cuenta bancaria o tarjeta de crédito.
   Esto es clave porque decide CUÁNDO sale la plata de tu caja:
   - Efectivo o cuenta bancaria: la plata sale AHORA.
   - Tarjeta de crédito: la plata NO sale ahora; se genera una deuda que pagas después.
     Por eso una compra con tarjeta no baja tu caja el día que la haces.

4) REAL vs PROYECTADO (en la app: "actual" vs "planned").
   - Real: pasó de verdad (lo registraste o lo importaste del banco).
   - Proyectado: todavía no pasa; es una estimación a futuro (un presupuesto, una cuota
     que viene, el IVA que vas a tener que pagar).
   La app casi siempre te muestra los dos lados por separado: lo que ya ocurrió y lo que
   se espera que ocurra. En los gráficos, la línea sólida es lo real y la punteada lo
   proyectado.

5) ESTADO: pendiente, pagado o anulado.
   - Pendiente: aún no se liquidó (típico de una compra con tarjeta sin pagar).
   - Pagado: ya está.
   - Anulado: la app lo ignora en TODOS los cálculos. Es la forma de "borrar sin borrar".

Con esto en mente: cada movimiento que registras es la combinación de un ámbito + un
tipo + un método de pago + un estado + si es real o proyectado. La app usa esa
combinación para saber cómo afecta tu caja, tu deuda y tus resultados.


====================================================================
PARTE 2 — QUÉ HACE CADA SECCIÓN
====================================================================

La app tiene alrededor de 17 secciones. Las agrupo por para qué las usas.

--- EL DÍA A DÍA ---

RESUMEN (la pantalla de inicio)
Responde la pregunta más importante: "¿cuánta plata tengo disponible ahora y qué debería
hacer?". Arriba te muestra los números que importan: caja disponible, cuánto te queda
después de descontar la deuda de tarjetas, cuánto IVA tenés que separar (y cuándo vence),
cuánto ingresaste este mes, cuánto te falta por cobrar y tu margen. Abajo trae alertas
(por ejemplo "el IVA vence pronto" o "la caja está baja") y un "pulso" por cada ámbito.
También tenés tarjetas con indicadores que podés arrastrar y ordenar a tu gusto.
Desde acá creás movimientos rápido y saltás a las otras secciones.

MOVIMIENTOS (el libro mayor)
Es la lista completa de todo lo que registraste. Buscás por nombre, filtrás por mes,
ámbito, estado o categoría, editás o borrás (incluso varios de una). Es donde vas cuando
querés revisar que todo esté bien cargado. Muestra hasta 200 filas a la vez (si hay más,
te avisa).

GASTO RÁPIDO (atajo con ⌘J)
Un formulario chico para anotar un gasto al toque, sin entrar a ninguna sección. La app
hasta intenta adivinar la categoría según lo que escribas.

--- VER CÓMO VAS ---

FLUJO DE CAJA
Responde "¿cómo va a estar mi caja en los próximos días y semanas?". Parte de un saldo
inicial (que podés ajustar a mano) y va sumando y restando lo que ocurre día a día.
Te muestra dos finales: el saldo si solo contás lo que ya pasó (ejecutado) y el saldo si
sumás también lo proyectado. Trae una tabla por semana donde cada celda es clickeable
para ver qué movimientos la componen, y una tabla por mes. Los números en rojo te avisan
si la caja se va a poner negativa.

RESULTADOS (P&L / estado de resultados)
Responde "¿cuánto ingresé, cuánto gasté y cuál fue mi resultado?". Es una tabla por
categoría y por mes que compara lo real contra lo presupuestado, mostrando la diferencia
(varianza). Sirve para ver dónde te pasaste o dónde ahorraste.

PRESUPUESTO
Acá planificás cuánto pensás gastar por categoría cada mes y la app lo compara contra lo
que realmente gastaste (más lo comprometido). Podés marcar gastos como recurrentes (con
día del mes), ordenarlos arrastrando, y maneja un cálculo especial: el "remanente" que
deja la empresa después de sus gastos pasa a ser ingreso disponible de la familia, al que
se le suma el "ingreso de Javi" (un número que cargás a mano).

--- TU PLATA Y TUS CLIENTES ---

CUENTAS (bancos y tarjetas)
El listado de tus cuentas y tarjetas. Para cada una anotás el saldo que dice el banco
(eso es la verdad oficial) y la app calcula, en paralelo, cuánto debería haber según los
movimientos que registraste. Si hay diferencia, es señal de que falta cargar algo o hay
un error. Es tu herramienta para cuadrar con el banco.

INGRESOS DE CLIENTES (facturación y cobros)
El seguimiento de la plata que te deben y la que ya entró. Cada ingreso pasa por estados:
proyectado (todavía es una expectativa de venta), por cobrar (confirmado), facturado
(emitiste la factura) y pagado (entró la plata). El IVA (19%) se calcula solo cuando
ingresás el neto. Lo importante: cuando marcás un cobro como "pagado", la app crea
automáticamente el movimiento de ingreso correspondiente. No tenés que cargarlo aparte.

TARJETAS DE CRÉDITO
El panel de control de tus tarjetas: cuánto debés en total, las compras del mes, los
pagos que hiciste y —lo más útil— las CUOTAS FUTURAS proyectadas. Si compraste algo en
12 cuotas, acá ves cómo se reparten en los próximos meses. También vinculás cada tarjeta
con la cuenta desde donde la pagás. Ojo: acá revisás y gestionás, pero el "pago" en sí se
registra como un movimiento aparte.

--- CARGAR Y ORDENAR DATOS ---

IMPORTAR DATOS
Subís la cartola del banco o de la tarjeta (CSV o PDF). La app detecta sola de qué banco
es, ordena las columnas, sugiere categorías y detecta posibles duplicados. Para los PDF
usa IA para leerlos. Lo que subís no se convierte de inmediato: queda en una bandeja de
revisión.

MOVIMIENTOS BANCARIOS (la bandeja de revisión)
Acá repasás lo que importaste antes de convertirlo en movimientos reales. Podés ajustar
categoría, ámbito y cuenta de cada fila, convertir uno por uno o convertir en lote todos
los que la app marca con alta confianza (85% o más). Cuando terminás, cerrás el lote.

CONCILIACIÓN
Sirve para aparear, cuenta por cuenta y mes por mes, lo que dice la cartola del banco
contra lo que tenés registrado en la app. La app sugiere las coincidencias (por monto,
fecha y descripción parecida), y vos confirmás, descartás o creás un ajuste si hay una
diferencia. Es el paso que te da certeza de que tu app refleja la realidad del banco.

--- CERRAR Y AUTOMATIZAR ---

CIERRE MENSUAL
Antes de dar un mes por cerrado, te muestra una lista de verificación de 7 puntos
(¿quedan movimientos pendientes?, ¿hay cosas sin categoría?, ¿conciliaste las cuentas?,
etc.). Si todo está en orden, "congelás" el mes: la app guarda una foto del estado
(presupuesto vs real) que queda fija aunque después edites algo. Siempre podés reabrirlo.

AUTOMATIZACIÓN MENSUAL (compromisos recurrentes)
Para los gastos fijos que se repiten todos los meses (arriendo, seguros, servicios).
Creás una plantilla una vez y cada mes la app genera el compromiso, intenta engancharlo
solo con el movimiento real cuando aparece, y vos lo marcás como pagado (o lo salteás).
Sirve para no olvidarte de nada y ver cuánto te falta pagar del mes.

--- MANTENIMIENTO ---

SALUD DE DATOS
Una auditoría que revisa toda tu información buscando problemas: categorías duplicadas,
referencias rotas, montos raros, cobros sin su movimiento, diferencias de conciliación,
etc. Cada hallazgo viene con su recomendación y un botón para ir directo a arreglarlo.
Incluye reparaciones automáticas (como fusionar categorías duplicadas) que siempre te
piden descargar un respaldo antes.

CONFIGURACIÓN
Cosas generales: tu logo, atajos rápidos y la lista de nombres de tus tarjetas.

CATEGORÍAS y SUBCATEGORÍAS
Las categorías son las grandes bolsas (Comida, Sueldos, Arriendo). Las subcategorías son
el detalle dentro de una categoría (dentro de "Comida": "Almuerzo trabajo", "Supermercado").
Los ingresos no se asignan a un ámbito; los gastos sí.


====================================================================
PARTE 3 — CÓMO "PIENSA" EL DINERO (la lógica fina, sin fórmulas)
====================================================================

Acá está la inteligencia de la app: las reglas que hacen que los números te cuadren.
Las explico en castellano, sin código.

LAS COMPRAS CON TARJETA NO BAJAN TU CAJA HOY
Cuando comprás algo con tarjeta de crédito, ese día no sale plata de tu cuenta: lo que
sube es tu deuda. La caja recién baja cuando pagás la tarjeta. Por eso una compra con
tarjeta queda en estado "pendiente" hasta que la pagás. Aun así, para los reportes de
resultados, esa compra cuenta como gasto real del momento en que la hiciste (gastaste,
aunque todavía no hayas pagado).

LAS CUOTAS SE REPARTEN HACIA ADELANTE
Si comprás en N cuotas, la app divide el monto en partes iguales y reparte el resto (los
pesos que sobran de la división) en la última cuota. Después proyecta cada cuota en su
mes correspondiente, como un gasto futuro. Así, cuando mirás el flujo de caja de los
próximos meses, ya aparecen descontadas las cuotas que vienen.

EL IVA SE PROYECTA SOLO
Cuando un cliente te paga, la app sabe que parte de eso es IVA que no es tuyo: lo tenés
que enterar al fisco. Por eso, además de registrar el ingreso por el monto NETO (sin IVA),
proyecta automáticamente el pago del IVA acumulado para el día 20 del mes siguiente. En tu
flujo de caja ese IVA aparece como una salida futura, para que no te agarre desprevenido.

UN COBRO PAGADO SE CONVIERTE EN INGRESO AUTOMÁTICAMENTE
No tenés que cargar dos veces. Cuando marcás un cobro de cliente como "pagado", la app
crea sola el movimiento de ingreso, con la fecha en que lo recibiste. Y para no contar la
misma plata dos veces, ese ingreso queda "amarrado" al cobro original: la app sabe que
nació de ahí y no lo suma de más en los totales.

LA TRANSFERENCIA NO CREA NI DESTRUYE PLATA
Cuando mueves plata de la empresa a la familia, sale de un lado y entra al otro. Si mirás
un ámbito solo, ves la salida o la entrada; si mirás el consolidado, se cancela. La plata
total no cambia, solo cambió de bolsillo.

EL SALDO DE FIN DE MES SE ARRASTRA AL SIGUIENTE
La app intenta no hacerte cargar el saldo inicial de cada mes a mano: toma el saldo real
con que cerró el mes anterior y lo usa como punto de partida del mes nuevo. Si el mes
anterior tampoco tiene dato, sigue mirando hacia atrás hasta encontrar uno.

CUADRAR CON EL BANCO = COMPARAR DOS NÚMEROS
En Cuentas, la app pone lado a lado lo que dice el banco (lo que cargás vos) y lo que
debería haber según tus movimientos. La diferencia te dice cuánto te falta registrar o
cuánto cargaste mal. El objetivo es que esa diferencia sea cero.

LA APP SUGIERE, PERO VOS DECIDÍS
Tanto al importar cartolas como al conciliar o al enganchar compromisos recurrentes, la
app usa "puntajes" para sugerir: mira si el monto coincide, si la fecha está cerca, si la
descripción se parece, si toca la cuenta correcta. Cuanto más alto el puntaje, más segura
está. Pero las conversiones y confirmaciones las terminás vos (salvo el lote de "alta
confianza", que requiere 85% o más).


====================================================================
PARTE 4 — FLUJOS TÍPICOS (paso a paso)
====================================================================

REGISTRAR UN GASTO
1. Desde Resumen o Gasto Rápido, "nuevo movimiento".
2. Elegís ámbito, "gasto", categoría y subcategoría, monto y fecha.
3. Elegís método de pago (efectivo / cuenta / tarjeta + cuotas).
4. Guardás. Aparece en Movimientos y afecta Flujo de Caja, Presupuesto y Resultados.

IMPORTAR LA CARTOLA DEL MES
1. En Importar Datos subís el CSV o PDF.
2. La app detecta el banco, sugiere categorías y marca duplicados.
3. Revisás todo en Movimientos Bancarios (la bandeja).
4. Convertís los que están bien (uno por uno o el lote de alta confianza).
5. Vas a Conciliación para cuadrar contra el banco.
6. Cerrás el lote.

CERRAR UN MES
1. Entrás a Cierre Mensual y elegís el mes.
2. Recorrés la lista de 7 puntos; donde haya algo pendiente, hacés clic y te lleva a
   resolverlo.
3. Cuando está todo en verde, congelás el cierre (queda la foto guardada).

COBRAR A UN CLIENTE
1. En Ingresos de Clientes, lo creás como "facturado" (aparece como ingreso proyectado y
   la app proyecta el IVA del mes siguiente).
2. Cuando te pagan, lo marcás como "pagado" con la fecha y la cuenta.
3. La app crea sola el ingreso real. Listo.


====================================================================
PARTE 5 — COSAS QUE CONVIENE SABER (para no asustarte)
====================================================================

- ALGUNOS DATOS VIVEN EN EL NAVEGADOR, NO EN LA NUBE. El "ingreso de Javi", el logo, la
  lista de nombres de tarjetas y los ítems que marcás como "revisados" en Salud de Datos
  se guardan en el navegador donde usás la app. Si cambiás de computador o limpiás el
  navegador, esos datos puntuales podrían no estar. El grueso de tu información (todos los
  movimientos, cuentas, cobros, presupuestos) sí está en la nube (Firebase).

- ANULAR ES MÁS SEGURO QUE BORRAR. Si dudás, anulá un movimiento en vez de borrarlo: la
  app lo ignora en los cálculos pero queda el registro.

- EL SALDO DEL BANCO ES LA VERDAD. En Cuentas, el número que cargás del banco manda. La
  app no lo cambia sola; lo usa para compararse contra sí misma.

- LAS REPARACIONES PIDEN RESPALDO A PROPÓSITO. Antes de fusionar categorías o reparar
  referencias en Salud de Datos, te obliga a descargar un respaldo. Hacelo: es tu botón
  de "deshacer" si algo sale raro.

- "CONFIANZA 85%" NO ES MAGIA. Cuando convertís en lote los movimientos de alta confianza,
  la app está muy segura pero no es infalible. Para montos grandes o cosas dudosas, revisá
  igual antes de convertir.


====================================================================
NOTA FINAL
====================================================================

Este manual describe la app tal como funciona hoy (junio 2026). Si más adelante le
agregamos o cambiamos secciones, conviene actualizar tanto este documento como su gemelo
técnico (CLAUDE.md), para que vos y la IA sigan teniendo la misma foto de la verdad.
