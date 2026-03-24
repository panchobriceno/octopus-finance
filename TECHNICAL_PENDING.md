# Technical Pending

## Clientes antiguos sin vincular

Pendiente técnico:

- Crear una herramienta de regularización para vincular `ClientPayment` antiguos que solo tienen `clientName` con la entidad `Client`.
- La idea es sugerir matches automáticos por nombre y dejar revisión manual para los casos dudosos.
- Esto es importante porque los clientes reales del negocio son relativamente estables y vale la pena consolidarlos en el catálogo `clients`.

Objetivo futuro:

- Que los ingresos históricos también queden relacionados con `clientId`, no solo los nuevos.

## Deploy en Railway y config de Firebase

Pendiente técnico:

- Documentar y simplificar el deploy full-stack en Railway.
- Tuvimos un problema donde Railway sí levantaba Express, pero el frontend quedaba inicializando Firebase con `projectId = undefined`.
- Eso ocurrió porque la app dependía de variables `VITE_FIREBASE_*` en build time, y el bundle servido no siempre quedaba alineado con la configuración efectiva del entorno.
- También hubo confusión inicial porque un servicio anterior había sido detectado como `vite static site`, lo que dejaba corriendo Caddy en vez del backend.

Solución actual que quedó implementada:

- `railway.json` para forzar el arranque del servidor Node/Express.
- `server/static.ts` sirve `index.html` con `Cache-Control: no-store` para evitar que quede pegado un bundle viejo.
- `server/index.ts` expone `/app-config.js` con la config pública de Firebase en runtime.
- `client/src/lib/firebase.ts` usa `window.__APP_CONFIG__` antes de caer al fallback de `import.meta.env`.

Objetivo futuro:

- Dejar un flujo de deploy más simple y explícito para Railway, idealmente con una sola fuente de verdad para la config pública del frontend.
- Evaluar si conviene mantener el fallback runtime como solución permanente o reemplazarlo por una estrategia más limpia y documentada.
- Agregar una mini guía de deploy para evitar repetir debugging de caché, detección de servicio estático y variables de entorno.
