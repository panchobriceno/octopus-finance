# 🐙 OCTOPUS OPS
## Product Requirements Document
### Portal de Clientes + Portal de Agencia

| **Versión** | 1.0 — Draft inicial |
| --- | --- |
| **Producto** | Octopus Ops — Portal web |
| **Audiencia** | Equipo Octopus Media |
| **Estado** | **En revisión** |
| **Clasificación** | **Confidencial — Uso interno** |

---

# 🎯 SECCIÓN 1 — Visión y Objetivos
*Qué es, para quién y por qué*

---

# 1. Visión General del Producto

Octopus Ops es la plataforma operativa central de Octopus Media. Centraliza en un solo lugar la gestión de la relación con los clientes, el ciclo de producción de contenido, la automatización de publicaciones y la administración interna de la agencia.

La plataforma tiene dos portales diferenciados con accesos, vistas y permisos distintos: el Portal de la Agencia (uso interno del equipo) y el Portal del Cliente (acceso externo para cada cliente).

| **Problema que resuelve** |
| --- |
| Hoy la operación de la agencia está fragmentada entre Google Sheets, Google Docs, WhatsApp, el Apps Script del calendario y procesos manuales. Octopus Ops unifica todo en una sola interfaz, conectada a las automatizaciones de n8n, con accesos diferenciados por rol. |

## 1.1 Usuarios del sistema

| **Rol** | **Tipo de acceso** | **Quiénes son** | **Qué hacen en la plataforma** |
| --- | --- | --- | --- |
| **Admin** | Portal Agencia | Dueño / Director de agencia | Acceso total. Ve todos los clientes, finanzas, usuarios, configuración global. |
| **Community Manager** | Portal Agencia | CM asignado a cuentas | Ve solo sus clientes asignados. Cura calendarios, carga instrucciones, gestiona estados. |
| **Diseñador** | Portal Agencia | Equipo creativo | Ve los posts en estado 'En diseño'. Sube assets, cambia estado a 'Diseño listo'. |
| **Cliente** | Portal Cliente | Contacto del cliente en la empresa | Ve su calendario, aprueba contenido, ve métricas, carga briefs, gestiona su cuenta. |

## 1.2 Objetivos del producto — V1

- **OBJ-1** Centralizar la operación de la agencia en una sola plataforma.
- **OBJ-2** Eliminar el uso de WhatsApp para comunicaciones operativas con el cliente.
- **OBJ-3** Darle al cliente visibilidad en tiempo real del estado de su cuenta.
- **OBJ-4** Conectar la plataforma con las automatizaciones de n8n de forma transparente.
- **OBJ-5** Diferenciar claramente la vista interna (agencia) de la vista externa (cliente).
- **OBJ-6** Reemplazar el Apps Script del calendario interactivo actual con una solución nativa.

## 1.3 Fuera de alcance — V1

| **Lo que NO incluye esta versión** |
| --- |
| • Publicación automática desde la plataforma (eso lo sigue manejando n8n) |
| • Integración directa con Meta Ads |
| • App móvil nativa (V1 es web responsive) |
| • Multi-agencia / white label |
| • Chat interno entre miembros del equipo |
| • Editor de contenido / creación de diseños en la plataforma |

---

# 🏗️ SECCIÓN 2 — Arquitectura de Portales
*Dos accesos, un solo sistema*

---

# 2. Arquitectura de Portales

La plataforma tiene una única base de datos y backend compartido, pero dos portales con URL, diseño y permisos completamente diferenciados. El enrutamiento se basa en el rol del usuario autenticado.

| **🏢 Portal de la Agencia** | **🤝 Portal del Cliente** |
| --- | --- |
| app.octopusops.com/agencia | app.octopusops.com/cliente |
| Acceso: Admin, CM, Diseñador | Acceso: Contacto del cliente |
| Vista de todos los clientes asignados | Vista de su propia cuenta únicamente |
| Datos operativos + financieros + configuración | Datos de su cuenta + aprobaciones + métricas |
| Dark mode por defecto | Light mode por defecto (personalizable) |

## 2.1 Autenticación y permisos

- Login unificado con email + contraseña. El sistema detecta el rol y redirige al portal correcto.
- Opción de login con Google (OAuth2) para simplificar el acceso.
- El Admin puede crear, editar y desactivar usuarios de cualquier rol.
- Los clientes solo pueden ver datos de su propia empresa — nunca datos de otros clientes.
- Los CMs solo ven los clientes que el Admin les asignó.
- Los diseñadores solo ven posts en estado 'En diseño' de los clientes activos.
- Sesiones con expiración de 30 días. Opción de cerrar sesión en todos los dispositivos.

## 2.2 Mapa de módulos por portal

| **Módulo** | Portal Agencia | Portal Cliente | Rol mínimo requerido | Descripción |
| --- | --- | --- | --- | --- |
| **Dashboard** | ✅ | ✅ | Todos | Vista principal con resumen del estado actual |
| **Calendario** | ✅ | ✅ | CM / Cliente | Ver, aprobar, rechazar y comentar posts |
| **Estadísticas** | ✅ | ✅ | CM / Cliente | Métricas de rendimiento por período |
| **Clientes** | ✅ | — | Admin / CM | Gestión del perfil y datos de cada cliente |
| **Brief rápido** | — | ✅ | Cliente | Formulario para enviar novedades del mes |
| **Instrucciones CM** | ✅ | — | CM | Cargar excepciones y adiciones al prompt |
| **Assets / Drive** | ✅ | — | CM / Diseñador | Gestión de archivos para publicación |
| **Publicaciones** | ✅ | — | CM | Log de todo lo publicado con links y métricas |
| **Onboarding** | ✅ | ✅ | Admin / Cliente | Wizard de alta de cliente nuevo |
| **Brand Bible** | ✅ | Solo lectura | Admin | Ver y editar el documento de marca |
| **Redes conectadas** | ✅ | ✅ | Admin / Cliente | Estado de tokens Meta y Metricool |
| **Contratos** | ✅ | Solo lectura | Admin / Cliente | Acceso al contrato vigente en PDF |
| **Facturación** | ✅ | ✅ | Admin / Cliente | Estado de pago, facturas y vencimientos |
| **Contacto / Soporte** | — | ✅ | Cliente | Botón WhatsApp + formulario de solicitud |
| **Notificaciones** | ✅ | ✅ | Todos | Centro de alertas y novedades |
| **Configuración** | ✅ | Limitada | Admin | Usuarios, integraciones, APIs |

---

# 🏢 SECCIÓN 3 — Portal de la Agencia
*Lo que ve el equipo interno*

---

# 3. Portal de la Agencia

El portal de la agencia es la herramienta operativa del equipo de Octopus Media. Desde acá se gestiona el ciclo completo de producción: análisis, generación de calendarios, curación, diseño y publicación. Cada rol ve solo lo que necesita ver.

## 3.1 Dashboard — Vista principal

### Admin

- Panel con todos los clientes activos y su estado del mes actual (en qué fase del ciclo están).
- KPIs globales: clientes activos, posts publicados este mes, posts pendientes de aprobación, errores de publicación.
- Alertas prioritarias: tokens vencidos, facturas vencidas, posts con fecha próxima sin diseño.
- Acceso rápido a cualquier cliente con un click.

### Community Manager

- Vista filtrada solo de sus clientes asignados.
- Posts pendientes de curación hoy.
- Próximas publicaciones de los próximos 7 días.
- Alertas de posts sin diseño con fecha próxima.

### Diseñador

- Lista de posts en estado 'En diseño' ordenados por fecha de publicación (más urgente primero).
- Para cada post: nombre del archivo esperado, descripción del asset, fecha límite.
- Botón para marcar como 'Diseño listo' al subir el archivo a Drive.

## 3.2 Módulo de Clientes

- Lista de todos los clientes con filtros por estado, CM asignado y fecha de próximo vencimiento.
- Ficha completa por cliente con todas las pestañas del Sheet Maestro integradas en UI:
  - Datos básicos: nombre, rubro, CM asignado, plan contratado, fecha de inicio.
  - Redes conectadas: estado del token de Meta y Metricool con indicador visual.
  - Brand Bible: visor del documento con botón de editar (abre Google Docs).
  - Historial de calendarios generados con link a cada Sheet.
  - Historial de publicaciones con filtro por mes y estado.
- Alta de cliente nuevo via wizard de onboarding integrado.
- Desactivar / pausar cliente (no elimina datos, solo cambia estado).

## 3.3 Módulo de Calendario (vista interna)

- Vista mensual del calendario de cada cliente.
- Columnas visibles: Fecha, Formato, Tema/Idea, Copywrite, Estado, Nombre_Archivo, Notas_equipo.
- Filtros por semana, formato, estado y CM.
- Edición inline de Copywrite y Notas_equipo directamente desde la UI.
- Cambio de estado con dropdown (todos los estados disponibles según rol).
- Indicador visual por color según el estado de cada post.
- Vista de 'Posts urgentes': los que tienen fecha en los próximos 5 días sin estar en 'Diseño listo' o 'Publicado'.
- Botón 'Enviar al cliente' que cambia el estado de todos los posts en curación a 'Enviado al cliente' y notifica al cliente.

## 3.4 Módulo de Instrucciones del CM

Reemplaza la pestaña 05_Instrucciones_CM del Sheet Maestro con una UI nativa.

- Formulario simple: Cliente, Mes, Tipo de instrucción, Descripción, Prioridad.
- Lista de instrucciones cargadas con estado (Pendiente / Aplicado).
- Deadline visual: cuenta regresiva hasta el día 28 del mes actual.
- Al guardar, se escribe directamente en el Sheet Maestro vía API (o futura DB propia).

## 3.5 Módulo de Publicaciones

- Log completo de todo lo publicado por el Flujo 3 de n8n.
- Columnas: Fecha, Cliente, Formato, Tema, Estado, Link al post, Error (si lo hay).
- Filtros por cliente, mes, formato y estado (Publicado / Error).
- Para posts con error: botón 'Reintentar' que dispara el nodo de publicación en n8n via webhook.
- Vista de calendario de publicaciones futuras (posts en 'Diseño listo' con fecha asignada).

## 3.6 Módulo de Estadísticas (vista interna)

- Métricas del mes actual vs mes anterior por cliente.
- Gráficos de evolución de seguidores, alcance y engagement rate.
- Top 3 posts del mes con métricas individuales.
- Comparativa entre clientes (solo visible para Admin).
- Datos alimentados por el 04_Rendimiento_Historico actualizado por el Flujo 2.

## 3.7 Módulo de Facturación (Admin)

- Lista de clientes con estado de pago: Al día / Vencido / Por vencer (próximos 7 días).
- Fecha de próximo vencimiento por cliente.
- Historial de facturas con opción de subir PDF y marcar como pagada.
- V1: gestión manual. V2: integración con Alegra, Facturama u otro sistema de facturación.
- Alerta automática al Admin cuando una factura está a 7 días de vencer.

## 3.8 Configuración

- Gestión de usuarios: crear, editar, asignar rol, activar/desactivar.
- Asignación de CM a clientes.
- Configuración de integraciones: API keys de Anthropic, Metricool, Meta, Cloudinary.
- Webhook URL de n8n (para disparar flujos desde la plataforma).
- Configuración de notificaciones: qué alertas recibe cada rol y por qué canal.

---

# 🤝 SECCIÓN 4 — Portal del Cliente
*Lo que ve cada cliente*

---

# 4. Portal del Cliente

El portal del cliente es la cara pública de Octopus Ops. Es lo que cada cliente ve al ingresar con sus credenciales. Diseñado para ser simple, claro y accionable — el cliente no necesita entender cómo funciona la agencia por dentro para usarlo.

## 4.1 Home / Dashboard del cliente

- Estado del ciclo mensual actual con indicador visual de fase:
  - Generando calendario → En curación → Listo para revisar → Publicando
- Contador de posts pendientes de aprobación con acceso directo al calendario.
- Próxima publicación programada: qué sale mañana / esta semana.
- Resumen de métricas del mes: alcance total, engagement rate, posts publicados.
- Alerta de factura próxima a vencer (si aplica).
- Notificaciones no leídas.

## 4.2 Mi Calendario

Reemplaza el Apps Script actual con una versión nativa dentro del portal.

- Vista mensual con todos los posts del calendario.
- Cada post muestra: Fecha, Formato, Tema/Idea, Copy, Estado actual.
- Acciones disponibles por post (según estado):
  - Si está en 'Enviado al cliente': botón Aprobar / Rechazar + campo de feedback.
  - Si está 'Aprobado': solo lectura con indicador de aprobado.
  - Si está 'Publicado': link directo al post en Instagram.
- Filtros por semana, formato y estado.
- Historial de meses anteriores con posts publicados y sus métricas.
- El cliente NO ve los campos internos: Nombre_Archivo, Notas_equipo, instrucciones del CM.

## 4.3 Mis Resultados

- Métricas del mes actual: alcance, impresiones, engagement rate, nuevos seguidores.
- Comparativa vs mes anterior con indicador de variación (↑ ↓).
- Top 3 posts del mes con link a cada publicación.
- Gráfico de evolución de seguidores (últimos 6 meses).
- Biblioteca de contenido publicado: galería de todos los posts ordenados por mes.
- Datos alimentados automáticamente por el Flujo 2 (sin intervención del CM).

## 4.4 Brief Rápido

Canal oficial para que el cliente comunique novedades del mes sin tener que escribir por WhatsApp.

- Formulario simple con campos:
  - ¿Qué novedades tenés este mes? (texto libre)
  - ¿Hay fechas especiales o lanzamientos? (fecha + descripción)
  - ¿Cambió algo en tu negocio que debamos considerar? (texto libre)
  - ¿Tenés restricciones o cosas que NO querés este mes? (texto libre)
- Al enviar: va directo a la pestaña 05_Instrucciones_CM del Sheet Maestro.
- El CM recibe una notificación inmediata con el contenido del brief.
- El cliente ve el historial de briefs enviados con la fecha y el estado (Recibido / Aplicado).
- Deadline visible: 'Enviá tu brief antes del [fecha] para que se incluya en el calendario de [mes]'.

## 4.5 Contacto con el equipo

- Botón de WhatsApp directo al CM asignado (número configurado por el Admin).
- Formulario de solicitud formal para pedidos que requieren seguimiento: cambios en Brand Bible, solicitudes de contenido adicional, consultas de facturación.
- Cada solicitud genera un ticket visible en el módulo de Clientes del portal de agencia.
- El cliente ve el historial de solicitudes con estado: Recibida / En proceso / Resuelta.

## 4.6 Mi Cuenta

### Redes Conectadas

- Estado visual de cada red social conectada: activa / token vencido / no conectada.
- Instrucciones paso a paso para reconectar si el token venció.
- El cliente NO ve ni puede copiar los tokens — solo ve el estado.

### Datos de mi Empresa

- Vista de lectura de su perfil: rubro, redes activas, piezas contratadas por mes.
- Para editar: debe solicitar al equipo vía formulario de contacto.

### Brand Bible

- Vista de lectura de su Brand Bible actual.
- Botón 'Solicitar actualización' que abre un formulario y notifica al CM.
- Historial de versiones de la Brand Bible con fecha de cada actualización.

### Onboarding

- Si el cliente es nuevo y el onboarding está incompleto: wizard paso a paso visible.
- Pasos: datos de la empresa → preguntas de marca → conectar redes → firma de contrato.
- Indicador de progreso con porcentaje de completitud.

## 4.7 Facturación

- Estado de pago actual con fecha de próximo vencimiento.
- Historial de facturas con opción de descargar PDF.
- Acceso al contrato vigente en PDF.
- Para pagar: botón de transferencia bancaria (V1) o link de pago (V2 con integración de pagos).

## 4.8 Notificaciones del cliente

Todas las notificaciones que hoy se mandan por email o WhatsApp pasan a ser notificaciones dentro del portal, con email como canal secundario.

| **Evento** | Canal V1 | Quién la genera |
| --- | --- | --- |
| **Calendario listo para revisar** | In-app + Email | n8n / Flujo 1 |
| **Recordatorio de aprobación pendiente** | In-app + Email | n8n (automático) |
| **Post publicado en Instagram** | In-app | n8n / Flujo 3 |
| **Factura próxima a vencer** | In-app + Email | Sistema |
| **Respuesta a solicitud del cliente** | In-app | CM (manual) |
| **Brief recibido confirmación** | In-app | Sistema automático |
| **Token de red social por vencer** | In-app + Email | Sistema |

---

# ⚙️ SECCIÓN 5 — Requerimientos Técnicos
*Stack, integraciones y arquitectura*

---

# 5. Requerimientos Técnicos

## 5.1 Stack recomendado

| **Capa** | Tecnología | Alternativa | Justificación |
| --- | --- | --- | --- |
| Frontend | React + Next.js | Remix | SSR para SEO y carga rápida. Ecosistema robusto. |
| UI Components | Tailwind CSS + shadcn/ui | Chakra UI | Componentes accesibles y customizables. |
| Backend | Node.js + Express | Next.js API routes | API REST para comunicación con n8n y frontend. |
| Base de datos | PostgreSQL | MySQL | Relacional, robusto para datos de clientes y facturación. |
| Auth | NextAuth.js / Clerk | Auth0 | OAuth2 integrado con Google. Manejo de roles. |
| ORM | Prisma | Drizzle | Type-safe, migraciones automáticas. |
| Hosting | Railway / Vercel | Render | Fácil deploy, CI/CD integrado. |
| Storage archivos | Google Drive API | AWS S3 | Ya es parte del flujo actual. |
| Email | Resend | SendGrid | Simple, buen developer experience. |
| Motor automático | n8n self-hosted | — | Ya definido. Se comunica vía webhooks. |

## 5.2 Integraciones requeridas

- **n8n (webhooks):** la plataforma puede disparar flujos de n8n desde botones de la UI (ej: 'Regenerar calendario', 'Reintentar publicación').
- **Google Sheets API:** lectura y escritura en el Sheet Maestro y en los Sheets de cada cliente.
- **Google Docs API:** lectura de la Brand Bible para mostrarla en el portal.
- **Google Drive API:** búsqueda y descarga de assets para el módulo de publicaciones.
- **Meta Graph API:** lectura de métricas para el módulo de estadísticas.
- **Metricool API:** lectura de métricas detalladas de posts, reels y stories.
- **Gmail / Resend:** envío de notificaciones y alertas por email.
- **WhatsApp Business API o link directo:** botón de contacto del portal cliente.

## 5.3 Comunicación plataforma ↔ n8n

La plataforma y n8n se comunican en ambas direcciones:

| **Dirección** | Trigger | Acción |
| --- | --- | --- |
| **Plataforma → n8n** | Admin activa cliente nuevo | n8n configura el cliente en el Sheet Maestro |
| **Plataforma → n8n** | CM presiona 'Regenerar calendario' | n8n re-ejecuta el Flujo 1 para ese cliente |
| **Plataforma → n8n** | Diseñador marca 'Diseño listo' | n8n programa la publicación del post |
| **Plataforma → n8n** | Admin presiona 'Reintentar publicación' | n8n re-ejecuta el Nodo de publicación |
| **n8n → Plataforma** | Flujo 1 termina | Webhook notifica a la plataforma: calendario listo |
| **n8n → Plataforma** | Flujo 3 publica un post | Webhook actualiza estado en DB y notifica al cliente |
| **n8n → Plataforma** | Flujo 2 actualiza histórico | Webhook refresca el módulo de estadísticas |

## 5.4 Seguridad

- Todas las API keys (Meta, Metricool, Anthropic, Cloudinary) se almacenan en variables de entorno del servidor — nunca en el frontend.
- Los tokens de redes sociales de los clientes se almacenan encriptados en la base de datos.
- El cliente solo puede leer sus propios datos — validación de ownership en cada endpoint.
- HTTPS obligatorio en todos los entornos.
- Rate limiting en la API para prevenir abuso.
- Logs de auditoría para acciones sensibles: cambios de estado, acceso a contratos, modificaciones de Brand Bible.

---

# 🎨 SECCIÓN 6 — UX y Diseño
*Principios visuales y de experiencia*

---

# 6. Principios de UX y Diseño

## 6.1 Portal de la Agencia

- Dark mode por defecto. Paleta: fondo `#080C14`, superficie `#0E1520`, acentos teal `#00D4C8` y naranja `#FF6B35`.
- Tipografía: Syne (headings, bold) + Instrument Sans (body). Nunca Inter o Roboto.
- Sidebar fija con navegación por módulo. Contenido a la derecha.
- Densidad de información alta pero organizada — es una herramienta de trabajo, no una landing page.
- Indicadores de estado con color semántico: verde = OK, naranja = atención, rojo = error/urgente.
- Tablas y listas como formato principal para datos operativos.

## 6.2 Portal del Cliente

- Light mode por defecto con opción de dark mode.
- Tono más limpio y menos denso que el portal de agencia — el cliente ve menos información pero más clara.
- El logo y los colores de Octopus Media presentes pero sin sobrecargar.
- Mobile-first: el cliente puede usar el portal desde el celular sin fricción.
- Llamados a la acción claros: 'Aprobar', 'Rechazar', 'Enviar brief', 'Descargar factura'.
- El cliente nunca ve terminología técnica interna (IDs, nombres de campos del Sheet, estados internos como 'Diseño listo').

## 6.3 Principios generales

- Cada pantalla tiene un propósito único y claro — sin pantallas multipropósito.
- Feedback inmediato en cada acción: loading states, confirmaciones, mensajes de error descriptivos.
- Nunca un error genérico — siempre explicar qué pasó y qué hacer.
- Las acciones destructivas (rechazar, desactivar cliente) piden confirmación.
- El sistema funciona correctamente en Chrome, Safari y Firefox. Responsive hasta 375px de ancho.

---

# 🗓️ SECCIÓN 7 — Roadmap
*Priorización y fases de desarrollo*

---

# 7. Roadmap de Desarrollo

El desarrollo se divide en 3 fases. Cada fase entrega valor funcional completo antes de arrancar la siguiente.

## Fase 1 — MVP Operativo (Mes 1-2)

| **Objetivo de la Fase 1** |
| --- |
| El equipo de la agencia puede operar completamente desde la plataforma, reemplazando el Sheet Maestro en las operaciones diarias. |

- **P1** Auth: login con email/contraseña + roles (Admin, CM, Diseñador).
- **P1** Portal Agencia: Dashboard con estado de clientes.
- **P1** Portal Agencia: Módulo de Calendario con gestión de estados.
- **P1** Portal Agencia: Módulo de Clientes con ficha completa.
- **P1** Portal Agencia: Instrucciones del CM.
- **P1** Portal Agencia: Log de Publicaciones.
- **P1** Integración con Google Sheets (lectura/escritura).
- **P1** Webhooks con n8n (trigger desde UI + notificaciones de vuelta).
- **P1** Notificaciones por email (Resend).

## Fase 2 — Portal Cliente (Mes 3-4)

| **Objetivo de la Fase 2** |
| --- |
| El cliente tiene su propio portal funcional. Se elimina el Apps Script del calendario interactivo. |

- **P2** Portal Cliente: Dashboard, Calendario, Estadísticas.
- **P2** Portal Cliente: Aprobación/rechazo de posts con feedback.
- **P2** Portal Cliente: Brief Rápido.
- **P2** Portal Cliente: Contacto con botón WhatsApp.
- **P2** Portal Cliente: Mi Cuenta (redes, Brand Bible, onboarding).
- **P2** Portal Cliente: Facturación (vista básica).
- **P2** Sistema de notificaciones in-app.
- **P2** Integración con Meta API y Metricool para estadísticas.

## Fase 3 — Madurez y Automatización (Mes 5-6)

| **Objetivo de la Fase 3** |
| --- |
| La plataforma es autogestiva para el cliente. La agencia opera con mínima intervención manual. |

- **P3** Wizard de onboarding completo para nuevos clientes.
- **P3** Gestión de contratos: upload, firma digital básica, historial.
- **P3** Facturación: integración con sistema externo (Alegra u otro).
- **P3** Módulo de feedback mensual del cliente (calificación + comentario).
- **P3** Dashboard comparativo para Admin (todos los clientes).
- **P3** Alertas automáticas avanzadas por demorado en el ciclo.
- **P3** Optimizaciones de performance y mobile.

---

# 📈 SECCIÓN 8 — Métricas de Éxito
*Cómo sabemos que funciona*

---

# 8. Métricas de Éxito del Producto

| **Métrica** | Baseline actual | Target V1 |
| --- | --- | --- |
| **Tiempo de aprobación del calendario por el cliente** | 3-5 días (WhatsApp) | < 24 horas (portal) |
| **Mensajes de WhatsApp operativos por cliente/mes** | ~30-40 | < 5 |
| **Tiempo de generación de calendario (proceso manual)** | 1-2 horas | 0 min (100% automático) |
| **Posts publicados sin error por mes** | Manual, variable | ≥ 95% éxito automático |
| **% de clientes que usan el portal activamente** | 0% | ≥ 80% en 60 días |
| **NPS del cliente (satisfacción con el servicio)** | No medido | ≥ 50 |
| **Tiempo del CM en tareas operativas por cliente/mes** | ~4-6 horas | < 1 hora |
| **Errores de token vencido sin detectar** | Frecuentes | 0 (alertas proactivas) |

---

*— Fin del documento —*
