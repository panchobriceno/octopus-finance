# PRD — Octopus Finance

**Versión:** 1.0
**Fecha:** Marzo 2026
**Autor:** Francisco Briceno

---

## 1. Visión General

Octopus Finance es una aplicación web de gestión financiera diseñada para una agencia familiar (Octopus Media) donde los límites entre finanzas personales y empresariales están entrelazados. El objetivo central es reemplazar planillas de Google Sheets con un sistema que dé claridad financiera en tiempo real — sabiendo exactamente qué entra, qué sale, cuándo, y qué pasa si un cliente se atrasa.

La pregunta que la app debe responder en todo momento:

> ¿Tengo caja suficiente esta semana para pagar mis compromisos, considerando lo que me falta cobrar?

---

## 2. Usuarios

- **Hoy:** Francisco Briceno — único usuario, dueño y operador de la agencia.
- **Futuro cercano:** Javiera (socia/esposa) — acceso para ver estado financiero familiar y empresarial.
- **Futuro medio:** Equipo de la agencia — acceso limitado a módulos operativos.

---

## 3. Contexto del Problema

La agencia es un negocio familiar donde:

- Los ingresos de la agencia y los gastos personales comparten las mismas cuentas bancarias
- Los clientes pagan en fechas distintas y con atrasos frecuentes
- Una tarjeta de crédito paga tanto gastos de empresa como gastos familiares
- Sin visibilidad clara, es fácil perder de vista compromisos y generar una bola de nieve financiera

---

## 4. Arquitectura y Stack Técnico

| Capa | Tecnología |
| --- | --- |
| Frontend | React + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Express.js (Node.js) |
| Base de datos | Firebase Firestore |
| Estado | TanStack React Query |
| Routing | Wouter |
| Build | Vite |
| Control de versiones | GitHub (rama v2-respaldo-final) |
| Deploy | Pendiente (Railway o Render) |

---

## 5. Modelo de Datos Principal

```
Client → ClientPayment → Transaction (auto-generada al marcar Pagado)
Account → Transaction (cada movimiento vinculado a una cuenta)
Budget → Transaction (auto-generada si es recurrente)
Category → Item (subcategorías)
```

- **Workspaces:** `business` | `family` | `shared`
- **Estados ClientPayment:** `projected` | `receivable` | `invoiced` | `paid` | `cancelled`
- **Tipos de movimiento:** `income` | `expense` | `transfer` | `credit_card_payment`

---

## 6. Módulos Existentes

| Módulo | Estado | Resumen |
| --- | --- | --- |
| Dashboard | ✅ | KPIs, ingresos reales vs proyectados, filtro por cuenta |
| Flujo de Caja | ✅ | Vista diaria y semanal |
| Estado de Resultados | ✅ | Multi-mes, por workspace |
| Ingresos Clientes | ✅ | Estados Facturado/Pagado, transacción automática |
| Presupuesto | ✅ | Gastos recurrentes, drag & drop |
| Cierre Mensual | ✅ | Presupuesto vs real |
| Panel de Tarjetas | ✅ | Deuda, compras, cuotas futuras |
| Cuentas | ✅ | Saldo base + saldo calculado + diferencia |
| Transferencias | ✅ | Entre cuentas y pago TC, excluidas de KPIs |
| Importar Datos | ✅ | CSV con detalle editable por lote |
| Categorías / Items | ✅ | CRUD con colores y workspaces |
| Clientes | ✅ | Entidad separada con riesgo de pago |

---

## 7. Roadmap

### 🔴 Alta prioridad

- **Correos de cobranza** — Nodemailer + Gmail desde francisco@octopusmedia.cl
- **Alertas de vencimiento** — pagos vencidos, semanas en rojo, clientes con atraso
- **destinationAccountId** — reemplazar texto por id real en transferencias

### 🟡 Prioridad media

- **Dashboard configurable** — ocultar y reordenar tarjetas
- **Rentabilidad por cliente** — fee, horas, costo hora, margen
- **Búsqueda global** — cmdk ya instalado sin usar
- `averageDaysLate` calculado automáticamente

### 🟢 Prioridad baja

- **OCR de boletas** — Google Cloud Vision
- **Módulo detalle de compras** — patrones de consumo familiar
- Filtros persistentes
- Edición inline en tabla de transacciones
- Limpieza de `family-income.ts`

### 🏁 Deploy

- Railway o Render — cuando la app esté estable

### 🔮 Futuro

- **Fintoc / Open Banking** — sincronización automática con Santander, Itaú y Banco Edwards cuando la normativa CMF esté operativa (2027)

---

## 8. Decisiones de Arquitectura

| Decisión | Razonamiento |
| --- | --- |
| Firebase como base de datos | Sin servidor propio, escala solo, gratuito para este volumen |
| ClientPayment como fuente de verdad de ingresos | Evita doble conteo con transacciones automáticas |
| `currentBalance` manual en cuentas | Base estable; saldo calculado se suma encima |
| Transferencias excluidas de KPIs | Movimientos internos no son gasto ni ingreso |
| Workspaces en vez de usuarios | Un solo usuario que necesita separar empresa/familia/compartido |

---

## 9. Deuda Técnica

- `destinationWorkspace` usado como texto en transferencias → migrar a `destinationAccountId`
- `Record<string, any>` en hooks → usar tipos específicos
- `family-income.ts` → archivo legacy, evaluar limpieza
- Revertir un pago de cliente no elimina la transacción generada automáticamente

---

## 10. Visión Futura — Octopus Hub

Octopus Finance + Octopus Ops conectados por la entidad `Client` como hilo común. Octopus Ops cubrirá calendario de contenido, reportes para clientes, briefings, onboarding y seguimiento de tareas.
