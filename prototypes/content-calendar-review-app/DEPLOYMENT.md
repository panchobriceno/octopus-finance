# Deploy exacto en Apps Script

## 1. Crear el proyecto

1. Abre [script.new](https://script.new).
2. Renombra el proyecto como `IC Calendario Review`.
3. Crea estos archivos:
   - `Code.gs`
   - `Index.html`
   - `appsscript.json`
4. Copia el contenido de:
   - [Code.gs](/Users/panchobriceno/Downloads/octopus-finance-source/prototypes/content-calendar-review-app/Code.gs)
   - [Index.html](/Users/panchobriceno/Downloads/octopus-finance-source/prototypes/content-calendar-review-app/Index.html)
   - [appsscript.json](/Users/panchobriceno/Downloads/octopus-finance-source/prototypes/content-calendar-review-app/appsscript.json)

## 2. Verificar configuracion

En `Code.gs` ya viene apuntando a:

- `spreadsheetId`: `1xXQAd7BD-7sSij4qy5H937_Lbtm7xbdxYmFeu4E369c`
- `sheetName`: `Hoja 1`

Si quieres proteger el link de la app, define:

```javascript
accessToken: 'tu-token-aqui'
```

## 3. Ejecutar la migracion inicial

1. En el selector de funciones, elige `setupWorkflow`.
2. Haz clic en `Run`.
3. Autoriza el script.

`setupWorkflow()` hara esto:

- agrega columnas nuevas al final del calendario
- crea la hoja `Revision Log`
- congela la fila de encabezados
- crea el dropdown en `Estado Cliente`
- marca como visibles las filas actuales con contenido
- inicializa `Estado Cliente` segun el `Estado` legado
- copia feedback antiguo si existiera

## 4. Publicar la web app

1. Ve a `Deploy` → `New deployment`.
2. Tipo: `Web app`.
3. Ejecutar como: `Me`.
4. Acceso:
   - si quieres compartir directo con el cliente, usa acceso segun tu politica de cuenta
   - si agregaste `accessToken`, comparte el URL con `?token=...`
5. Copia el URL publicado.

## 5. Link final para cliente

Sin token:

```text
https://script.google.com/macros/s/.../exec
```

Con token:

```text
https://script.google.com/macros/s/.../exec?token=tu-token-aqui
```

## 6. Recomendacion operativa inmediata

Antes de compartir con el cliente:

1. llena `Link Preview` en las piezas que ya tengan arte o video
2. revisa que `Visible Cliente` este en `TRUE` solo para las piezas que quieres exponer
3. confirma que `Estado Cliente` quedo en `Pendiente`
4. abre la app y prueba una aprobacion de punta a punta
