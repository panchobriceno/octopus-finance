# Sistema de aprobacion para calendario de contenidos

## Lo que revise

- Spreadsheet real: `Calendario Abril - Instituto Cardiovascular`
- Tab activa: `Hoja 1`
- Estructura actual: 17 columnas, desde `#` hasta `Feedback`
- Workflow actual: la columna `Estado` esta usando valores booleanos `TRUE/FALSE`
- Comentarios nativos de Google Sheets: no hay
- HTML actual: el titulo dice `Plan Meta Ads - Instituto Cardiovascular Concepcion`, `Version 1`, `Octubre 2025`

## Diagnostico de product manager

### 1. Hoy hay un desalineamiento entre el activo y la herramienta

El spreadsheet es un calendario operativo de contenido por pieza.

El HTML pegado no es un visor del calendario real. Es una landing o deck estatico para presentar una propuesta de pauta/creatividad. Eso genera tres problemas:

- El cliente no esta revisando la misma fuente de verdad que el equipo.
- Cada cambio obliga a editar HTML, no solo a actualizar el sheet.
- El titulo, la fecha y el contenido del HTML no coinciden con el archivo revisado.

En concreto:

- El sheet que revise corresponde a `Abril`.
- El HTML que pegaste muestra `Octubre 2025`.
- El sheet es un calendario de contenidos.
- El HTML se comporta como una presentacion de campanas Meta Ads.

### 2. El estado no modela una revision real

`Estado = TRUE/FALSE` sirve para una casilla de verificacion, pero no para un flujo cliente-equipo.

Faltan al menos estos estados:

- `Pendiente`
- `Aprobado`
- `Requiere cambios`
- `Rechazado`

Opcionales para operacion interna:

- `Listo para revision`
- `Programado`
- `Publicado`

### 3. Falta trazabilidad

Hoy no queda claro:

- quien reviso la pieza
- cuando la reviso
- cual fue el estado anterior
- cual fue el feedback historico

Eso vuelve fragil cualquier proceso con varios aprobadores o varias rondas.

### 4. El cliente y el equipo comparten demasiados campos

`Notas de Equipo` y el detalle operativo viven en la misma estructura que lo que deberia ver el cliente.

Para aprobacion externa conviene separar:

- campos visibles para cliente
- campos internos del equipo

### 5. Falta una columna critica: preview

El cliente necesita revisar la pieza final o borrador visual, no solo el copy. El modelo actual no tiene un `Link Preview` o `URL de pieza`.

Sin preview, la app puede mostrar el brief, pero no la pieza que realmente se aprueba.

### 6. La IA esta puesta en el lugar equivocado

El boton de Gemini del HTML actual resuelve variaciones de guion, pero no ataca el problema principal del producto, que es la aprobacion.

Ademas, llamar un modelo directo desde el front:

- es menos seguro
- es mas dificil de auditar
- no ayuda a ordenar el workflow de revision

La IA puede existir, pero como herramienta interna del equipo, no como centro del flujo cliente.

## MVP recomendado

### Fuente de verdad

Mantener Google Sheets como backoffice.

### Interfaz cliente

Crear una web app en Apps Script que:

- lea el calendario desde Sheets
- muestre solo piezas visibles para cliente
- permita aprobar, pedir cambios o rechazar
- guarde feedback de forma estructurada
- deje trazabilidad minima

### Estructura recomendada del sheet

Mantener `Hoja 1` como calendario principal y agregar columnas nuevas, sin romper las actuales.

Columnas recomendadas:

| Columna | Uso |
| --- | --- |
| `Visible Cliente` | Define si la pieza aparece en la app |
| `Link Preview` | URL de Figma, Drive, Frame.io o asset final |
| `Estado Cliente` | Estado de aprobacion externo |
| `Feedback Cliente` | Comentario actual del cliente |
| `Fecha Revision` | Timestamp de la ultima revision |
| `Revisado Por` | Nombre del aprobador |
| `Ultima Actualizacion` | Timestamp tecnico |

Opcionales si el proceso crece:

| Columna | Uso |
| --- | --- |
| `Estado Interno` | Workflow del equipo |
| `Version` | Control de iteraciones |
| `Owner` | Responsable interno |
| `Prioridad` | Orden operativo |

### Tab adicional recomendada

`Revision Log`

Cada accion del cliente agrega una fila con:

- timestamp
- row number
- id de la pieza
- fecha de publicacion
- tema
- estado anterior
- estado nuevo
- feedback
- revisado por

## Flujo recomendado

### Flujo simple

1. El equipo prepara la pieza en el sheet.
2. Marca `Visible Cliente = TRUE`.
3. Agrega `Link Preview`.
4. La app muestra la pieza al cliente.
5. El cliente elige `Aprobado`, `Requiere cambios` o `Rechazado`.
6. La app escribe el estado y el feedback en el sheet.
7. La app agrega una fila al `Revision Log`.

### Regla de oro

La app cliente no debe depender de editar HTML cada mes.

El HTML debe ser un visor generico que renderiza filas del sheet.

## Recomendacion tecnica

### Mantener

- Google Sheets como base editable por el equipo
- Apps Script como backend ligero
- HtmlService para la interfaz

### Cambiar

- sacar el contenido hardcodeado del HTML
- dejar de usar `Estado` como booleano de negocio
- agregar columnas de workflow
- registrar feedback como dato estructurado

### No haria todavia

- migrar a una base de datos
- montar un backend externo
- meter IA en el flujo cliente

Para este caso, Sheets + Apps Script ya alcanza bien si el modelo de datos esta ordenado.

## Roadmap sugerido

### Fase 1

- agregar columnas nuevas
- desplegar web app de revision
- usar un solo aprobador o nombre manual

### Fase 2

- agregar `Link Preview`
- agregar filtros por red, categoria y estado
- separar visibilidad cliente vs equipo

### Fase 3

- email automatico al equipo cuando el cliente revisa
- resumen semanal de pendientes
- versionado por pieza

## Decision de producto

La mejor optimizacion no es hacer el HTML mas bonito.

La mejor optimizacion es cambiar el sistema desde:

- `presentacion manual y estatica`

hacia:

- `visor dinamico conectado al sheet con workflow de aprobacion`

Ese es el salto que realmente te ahorra tiempo y errores.
