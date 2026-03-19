# Technical Pending

## Clientes antiguos sin vincular

Pendiente técnico:

- Crear una herramienta de regularización para vincular `ClientPayment` antiguos que solo tienen `clientName` con la entidad `Client`.
- La idea es sugerir matches automáticos por nombre y dejar revisión manual para los casos dudosos.
- Esto es importante porque los clientes reales del negocio son relativamente estables y vale la pena consolidarlos en el catálogo `clients`.

Objetivo futuro:

- Que los ingresos históricos también queden relacionados con `clientId`, no solo los nuevos.
