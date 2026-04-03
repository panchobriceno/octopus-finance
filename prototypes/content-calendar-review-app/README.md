# Content Calendar Review App

Starter en Apps Script para convertir un Google Sheet en una app de aprobacion para cliente.

## Que resuelve

- Lee el calendario desde Google Sheets
- Filtra por estado, red y categoria
- Filtra tambien por tipo y semana del mes
- Muestra las piezas en vista `Grid` y `Calendario`
- Muestra cada pieza como tarjeta con panel de detalle
- Abre previews de imagen, video o enlace cuando existe `Link Preview`
- Permite `Aprobar`, `Pedir cambios` o `Rechazar`
- Guarda feedback y nombre del revisor
- Crea un `Revision Log` para trazabilidad
- Permite exportar CSV y preparar impresion/PDF
- Incluye tema claro/oscuro guardado localmente

## Archivos

- `Code.gs`: backend y acceso a Sheets
- `Index.html`: interfaz cliente
- `appsscript.json`: manifest recomendado
- `DEPLOYMENT.md`: guia exacta para publicar y ejecutar la migracion

## Configuracion inicial

1. Crea un proyecto de Apps Script.
2. Copia `Code.gs`, `Index.html` y `appsscript.json`.
3. Revisa `CONFIG.spreadsheetId` y `CONFIG.sheetName`.
4. Si quieres un link privado, define `CONFIG.accessToken`.
5. Ejecuta `setupWorkflow()` una vez para migrar el sheet actual sin romper las columnas existentes.
6. Despliega como `Web app`.

## Columnas recomendadas

El script puede trabajar con la estructura actual, pero funciona mejor si agregas:

- `Visible Cliente`
- `Link Preview`
- `Estado Cliente`
- `Feedback Cliente`
- `Fecha Revision`
- `Revisado Por`
- `Ultima Actualizacion`

## Como comparte el link con el cliente

### Opcion simple

Despliega la app y comparte el URL.

### Opcion con token

Si defines `CONFIG.accessToken`, comparte:

`https://script.google.com/macros/s/.../exec?token=tu-token`

## Recomendacion operativa

Usa `Estado Cliente` para la aprobacion externa y deja la columna `Estado` original libre para manejo interno o historico.
