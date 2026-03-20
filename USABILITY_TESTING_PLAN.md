# 🧪 Plan de Testing de Usabilidad - Octopus Finance

**Objetivo:** Validar que cada feature funciona correctamente y la lógica de negocio está bien aplicada.

---

## 📋 DESCRIPCIÓN DE TESTS

Cada test está estructurado así:
```
📌 TEST ID: [FEATURE]-[NÚMERO]
🎯 Descripción: Qué se va a probar
📝 Precondiciones: Datos/estado requerido
🎬 Pasos:
  1. Acción A
  2. Acción B
  3. Verificar resultado
✅ Resultado Esperado: Qué debe suceder
❌ Resultado Actual: Escribe aquí qué sucede realmente
🐛 Problemas encontrados: Si hay bugs
```

---

# 🏠 FEATURE: DASHBOARD / OVERVIEW

## 📌 TEST OV-001: Crear Transacción Simple (Ingreso)
**🎯 Descripción:** Usuario crea un ingreso simple
**📝 Precondiciones:** 
- Al menos una categoría de "income"
- Al menos una cuenta bancaria

**🎬 Pasos:**
1. Ir a Overview
2. Hacer click en "Agregar transacción"
3. Llenar:
   - Tipo: Income
   - Categoría: Seleccionar una
   - Monto: 1000
   - Fecha: Hoy
4. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Toast de éxito aparece
- ✓ Transacción aparece en la tabla
- ✓ KPI de "Ingresos" aumenta en 1000

**❌ Resultado Actual:** ___________________

---

## 📌 TEST OV-002: Validación - Monto Negativo
**🎯 Descripción:** Sistema debe rechazar montos negativos
**📝 Precondiciones:** Formulario de transacción abierto

**🎬 Pasos:**
1. Ir a crear transacción
2. Llenar:
   - Tipo: Income
   - Categoría: Cualquiera
   - **Monto: -1000** (NEGATIVO)
   - Fecha: Hoy
3. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Sistema muestra error
- ✓ Transacción NO se guarda
- ✓ Usuario ve mensaje claro

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** El sistema probablemente PERMITE montos negativos (BUG confirmado en análisis)

---

## 📌 TEST OV-003: Validación - Monto Cero
**🎯 Descripción:** Sistema debe rechazar monto = 0
**📝 Precondiciones:** Formulario de transacción abierto

**🎬 Pasos:**
1. Crear transacción
2. Monto: **0**
3. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Sistema rechaza
- ✓ Toast de error: "El monto debe ser mayor a 0"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST OV-004: Validación - Monto Inválido (Texto)
**🎯 Descripción:** Sistema debe rechazar montos no numéricos

**🎬 Pasos:**
1. Crear transacción
2. Monto: **"abc123"**
3. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Sistema rechaza
- ✓ Toast de error

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** El sistema permite (NaN silent failure - BUG confirmado)

---

## 📌 TEST OV-005: Transferencia Interna - Validación Circular
**🎯 Descripción:** No permitir transferencia de Cuenta A → Cuenta A

**📝 Precondiciones:** 
- Al menos 2 cuentas creadas (Cuenta A, Cuenta B)

**🎬 Pasos:**
1. Click "Agregar movimiento interno"
2. Tipo: Transferencia entre cuentas
3. Cuenta origen: **Cuenta A**
4. Cuenta destino: **Cuenta A** (MISMO)
5. Monto: 1000
6. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Sistema rechaza
- ✓ Error: "La cuenta origen y destino deben ser diferentes"

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** El sistema PERMITE (Logic bug - BUG confirmado)

---

## 📌 TEST OV-006: Transferencia - Validación Saldo Disponible
**🎯 Descripción:** No permitir transferencia si no hay saldo suficiente

**📝 Precondiciones:**
- Cuenta A: $100 de balance
- Cuenta B: $1,000 de balance

**🎬 Pasos:**
1. Crear transferencia:
   - Origen: Cuenta A ($100)
   - Destino: Cuenta B
   - Monto: **$1,000** (más que balance)
2. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Sistema rechaza
- ✓ Error: "Saldo insuficiente en Cuenta A"

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** El sistema PERMITE (Logic bug - BUG confirmado)

---

## 📌 TEST OV-007: Editar Transacción - Cambiar Monto
**🎯 Descripción:** Editar transacción existente cambiando el monto

**📝 Precondiciones:**
- Transacción existente: "Venta" por $5,000

**🎬 Pasos:**
1. Ir a Overview
2. Click en transacción "Venta" ($5,000)
3. Cambiar monto a: **$7,500**
4. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ KPI de "Ingresos" aumenta en $2,500
- ✓ Transacción muestra $7,500
- ✓ Reportes se actualizan

**❌ Resultado Actual:** ___________________

---

## 📌 TEST OV-008: Eliminar Transacción
**🎯 Descripción:** Eliminar transacción (con confirmación)

**🎬 Pasos:**
1. Transacción en tabla
2. Click ícono delete
3. Si hay popup de confirmación → Click "Confirmar"
4. Si NO hay confirmación → Proceder

**✅ Resultado Esperado:**
- ✓ Popup de confirmación aparece (o debería)
- ✓ Transacción se elimina
- ✓ KPIs se actualizan

**❌ Resultado Actual:** ___________________

---

## 📌 TEST OV-009: Dashboard Preferences - Reordenar Tarjetas
**🎯 Descripción:** Usuario puede reordenar tarjetas del dashboard con drag-and-drop

**📝 Precondiciones:**
- Modo configuración habilitado (si existe botón)

**🎬 Pasos:**
1. Click botón "Configurar Dashboard" (si existe)
2. Arrastrar tarjeta "KPI Balance" a otra posición
3. Refrescar página

**✅ Resultado Esperado:**
- ✓ Tarjeta se mueve mientras se arrastra
- ✓ Posición se guarda
- ✓ Después de refrescar, tarjeta está en nueva posición

**❌ Resultado Actual:** ___________________

---

## 📌 TEST OV-010: Dashboard Preferences - Ocultar Tarjeta
**🎯 Descripción:** Usuario puede ocultar/mostrar tarjetas

**🎬 Pasos:**
1. Modo configuración
2. Hacer click en ícono "Ojo" de una tarjeta
3. Refrescar página

**✅ Resultado Esperado:**
- ✓ Tarjeta desaparece del dashboard
- ✓ Persiste después de refrescar
- ✓ Puedo mostrarla de nuevo

**❌ Resultado Actual:** ___________________

---

# 💳 FEATURE: CUENTAS BANCARIAS

## 📌 TEST ACC-001: Crear Cuenta Bancaria
**🎯 Descripción:** Crear una cuenta bancaria nueva

**🎬 Pasos:**
1. Ir a "Cuentas"
2. Llenar:
   - Nombre: "Cuenta Corriente Banco A"
   - Banco: "Banco A"
   - Tipo: "Checking"
   - Balance Inicial: 5000
   - Workspace: "Empresa"
3. Click "Crear"

**✅ Resultado Esperado:**
- ✓ Cuenta aparece en tabla
- ✓ Balance = 5000
- ✓ Workspace = "Empresa"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST ACC-002: Validación - Balance Negativo
**🎯 Descripción:** Sistema rechaza balance negativo al crear

**🎬 Pasos:**
1. Ir a "Cuentas"
2. Balance inicial: **-1000**
3. Click "Crear"

**✅ Resultado Esperado:**
- ✓ Error: "Balance debe ser positivo"

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** BUG - El sistema permite

---

## 📌 TEST ACC-003: Validación - Nombre Vacío
**🎯 Descripción:** Sistema rechaza nombre vacío

**🎬 Pasos:**
1. Nombre: **""** (vacío)
2. Banco: "Banco A"
3. Balance: "1000"
4. Click "Crear"

**✅ Resultado Esperado:**
- ✓ Error: "Completa todos los campos"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST ACC-004: Editar Cuenta
**🎯 Descripción:** Editar datos de cuenta existente

**📝 Precondiciones:**
- Cuenta: "Banco A" - $5000

**🎬 Pasos:**
1. Click en cuenta
2. Cambiar:
   - Nombre: "Banco A - Principal"
   - Balance: 7000
3. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Nombre se actualiza
- ✓ Balance se actualiza
- ✓ Se refleja en el dashboard

**❌ Resultado Actual:** ___________________

---

## 📌 TEST ACC-005: Eliminar Cuenta con Transacciones
**🎯 Descripción:** ¿Qué pasa si eliminamos cuenta que tiene transacciones?

**📝 Precondiciones:**
- Cuenta A con 3 transacciones vinculadas

**🎬 Pasos:**
1. Click delete en Cuenta A
2. Click confirmar

**✅ Resultado Esperado:**
- ✓ O: Cuenta se elimina y transacciones se orfandan
- ✓ O: Sistema rechaza: "Cuenta tiene transacciones"

**❌ Resultado Actual:** ___________________

**🐛 Nota:** No está claro qué debería pasar

---

# 📊 FEATURE: CATEGORÍAS

## 📌 TEST CAT-001: Crear Categoría
**🎯 Descripción:** Crear categoría de gasto

**🎬 Pasos:**
1. Ir a "Categorías"
2. Llenar:
   - Nombre: "Alimentación"
   - Tipo: "Expense"
   - Color: Verde
   - Workspace: "Familia"
3. Click "Crear"

**✅ Resultado Esperado:**
- ✓ Aparece en tabla de "Gastos"
- ✓ Color es correcto
- ✓ Workspace = "Familia"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST CAT-002: Validación - Nombre Duplicado
**🎯 Descripción:** No permitir 2 categorías con mismo nombre en mismo workspace

**📝 Precondiciones:**
- Categoría existente: "Alimentación" en "Familia"

**🎬 Pasos:**
1. Intentar crear: "Alimentación" en "Familia"

**✅ Resultado Esperado:**
- ✓ Sistema rechaza o permite pero advierte
- ✓ Claridad en UI

**❌ Resultado Actual:** ___________________

**🐛 Nota:** Lógica no revisada en código

---

## 📌 TEST CAT-003: Editar Categoría
**🎯 Descripción:** Cambiar nombre y color de categoría

**🎬 Pasos:**
1. Click en categoría "Alimentación"
2. Cambiar:
   - Nombre: "Comida y Bebida"
   - Color: Naranja
3. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Todas las transacciones de "Alimentación" ahora muestran "Comida y Bebida"
- ✓ Color se actualiza

**❌ Resultado Actual:** ___________________

---

## 📌 TEST CAT-004: Eliminar Categoría con Transacciones
**📝 Precondiciones:**
- Categoría "Alimentación" con 10 transacciones

**🎬 Pasos:**
1. Click delete en "Alimentación"
2. Click confirmar

**✅ Resultado Esperado:**
- ✓ Popup de confirmación advierte "10 transacciones vinculadas"
- ✓ Al confirmar, transacciones se orfandan o se asignan a "Sin categoría"

**❌ Resultado Actual:** ___________________

---

# 📥 FEATURE: IMPORTACIÓN CSV

## 📌 TEST IMP-001: Importar CSV Simple
**🎯 Descripción:** Importar archivo CSV con transacciones

**📝 Precondiciones:**
- Archivo CSV con 5 transacciones válidas
- Ejemplo:
  ```
  Fecha,Descripción,Monto
  2026-01-05,Venta Cliente A,5000
  2026-01-10,Venta Cliente B,3000
  2026-01-15,Gasto Oficina,-1500
  ```

**🎬 Pasos:**
1. Ir a "Importación"
2. Drag-and-drop o seleccionar archivo CSV
3. Sistema detecta columnas automáticamente
4. Verificar preview
5. Click "Importar"

**✅ Resultado Esperado:**
- ✓ Sistema detecta correctamente: Fecha, Descripción, Monto
- ✓ Preview muestra 5 transacciones
- ✓ Después de importar: 5 nuevas transacciones en BD

**❌ Resultado Actual:** ___________________

---

## 📌 TEST IMP-002: Importación - Detección Automática de Columnas
**🎯 Descripción:** Sistema debe auto-detectar mapping de columnas

**🎬 Pasos:**
1. Archivo con encabezados: "FECHA | DESCRIPCION | MONTO"
2. Sistema debería auto-detectar mapping

**✅ Resultado Esperado:**
- ✓ Columnas se mapean correctamente SIN intervención del usuario
- ✓ Preview correcto

**❌ Resultado Actual:** ___________________

---

## 📌 TEST IMP-003: Importación - Fecha Inválida
**🎯 Descripción:** Manejar fechas inválidas en CSV

**🎬 Pasos:**
1. CSV con fila: "31-02-2026, Venta, 1000" (fecha inválida)
2. Intentar importar

**✅ Resultado Esperado:**
- ✓ Row aparece como ERROR en preview
- ✓ No se importa
- ✓ Usuario ve mensaje claro

**❌ Resultado Actual:** ___________________

---

## 📌 TEST IMP-004: Importación - Detección de Duplicados
**🎯 Descripción:** Sistema detecta si transacción ya existe

**📝 Precondiciones:**
- BD ya contiene: "2026-01-05 | Venta | 5000"

**🎬 Pasos:**
1. Importar CSV que también contiene: "2026-01-05 | Venta | 5000"

**✅ Resultado Esperado:**
- ✓ En preview, row aparece marcada como "DUPLICADO"
- ✓ No se importa
- ✓ Usuario puede ver por qué es duplicado

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** BUG - El sistema PERMITE duplicados (confirmado en análisis)

---

## 📌 TEST IMP-005: Importación - Duplicados Dentro del Mismo CSV
**🎯 Descripción:** Sistema detecta duplicados DENTRO del CSV

**🎬 Pasos:**
1. CSV con 2 filas idénticas:
   ```
   2026-01-05 | Venta | 5000
   2026-01-05 | Venta | 5000
   ```
2. Importar

**✅ Resultado Esperado:**
- ✓ Segunda row aparece como "Duplicado en este archivo"
- ✓ Solo 1 se importa

**❌ Resultado Actual:** ___________________

---

## 📌 TEST IMP-006: CSV - Importación de Cuotas/Installments
**🎯 Descripción:** Sistema interpreta correctamente columna de cuotas

**🎬 Pasos:**
1. CSV con columna "Cuotas":
   ```
   Fecha,Descripción,Monto,Cuotas
   2026-01-05,Compra TV,600000,12
   ```
2. Importar

**✅ Resultado Esperado:**
- ✓ Sistema detecta 12 cuotas
- ✓ Crea transacción con installmentCount = 12

**❌ Resultado Actual:** ___________________

---

## 📌 TEST IMP-007: Validar Rango de Montos
**🎯 Descripción:** Rechazar montos extremos

**🎬 Pasos:**
1. CSV con:
   - Monto: 0.01 (muy pequeño)
   - Monto: 999,999,999 (muy grande)

**✅ Resultado Esperado:**
- ✓ Ambas aparecen como ERROR o ADVERTENCIA en preview
- ✓ Usuario puede validar manualmente

**❌ Resultado Actual:** ___________________

**🐛 Nota:** No hay validación de rango

---

# 💰 FEATURE: INGRESOS DE CLIENTES

## 📌 TEST CP-001: Crear Ingreso de Cliente
**🎯 Descripción:** Crear nuevo ingreso desde cliente

**🎬 Pasos:**
1. Ir a "Ingresos Clientes"
2. Click "Agregar ingreso"
3. Llenar:
   - Cliente: "Acme Corp" (si existe) o crear nuevo
   - Monto neto: 10,000
   - IVA: auto-calcula a 1,900
   - Total: auto-suma a 11,900
   - Estado: "Proyectado"
4. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ IVA se calcula automáticamente (10,000 * 0.19 = 1,900)
- ✓ Total = 11,900
- ✓ Aparece en tabla con estado "Proyectado"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST CP-002: Validación - Cálculo IVA Exactitud
**🎯 Descripción:** Verificar que cálculo de IVA es preciso

**🎬 Pasos:**
1. Crear ingreso con:
   - Monto neto: 1,001
2. Verificar IVA

**✅ Resultado Esperado:**
- ✓ IVA = 190.19 (redondeado a 190)
- ✓ Total = 1,191

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** Sistema usa Math.round() (BUG de precisión - confirmado)

---

## 📌 TEST CP-003: Validación - Monto Negativo
**🎯 Descripción:** Rechazar monto negativo

**🎬 Pasos:**
1. Monto neto: **-10,000**

**✅ Resultado Esperado:**
- ✓ Sistema rechaza
- ✓ Error claro

**❌ Resultado Actual:** ___________________

**🐛 Problema Esperado:** BUG - Permite

---

## 📌 TEST CP-004: Crear Rápidamente un Nuevo Cliente
**🎯 Descripción:** Agregar cliente sobre la marcha mientras se crea ingreso

**🎬 Pasos:**
1. En formulario de ingreso
2. Click "Crear nuevo cliente"
3. Llenar:
   - Nombre: "New Client Corp"
   - RUT: "76.234.567-8" (si aplica)
4. Click "Crear"
5. Cliente se asigna automáticamente al ingreso

**✅ Resultado Esperado:**
- ✓ Cliente se crea
- ✓ Se asigna automáticamente
- ✓ Ingreso se guarda con cliente nuevo

**❌ Resultado Actual:** ___________________

---

## 📌 TEST CP-005: Cambiar Estado a "Pagado"
**🎯 Descripción:** Marcar ingreso como pagado

**📝 Precondiciones:**
- Ingreso en estado "Proyectado"

**🎬 Pasos:**
1. Estado actual: "Proyectado"
2. Cambiar a: "Pagado"
3. Se abre popup pidiendo:
   - Fecha de pago
   - Cuenta destino
4. Llenar y confirmar

**✅ Resultado Esperado:**
- ✓ Estado cambia a "Pagado"
- ✓ Se crea transacción de ingreso en esa fecha
- ✓ Monto aparece acreditado en cuenta

**❌ Resultado Actual:** ___________________

---

## 📌 TEST CP-006: Editar Ingreso Pagado
**🎯 Descripción:** Cambiar datos después de pagado

**📝 Precondiciones:**
- Ingreso en estado "Pagado"

**🎬 Pasos:**
1. Click editar
2. Cambiar monto neto de 10,000 a 12,000
3. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ O: Sistema advierte "Ya pagado, ¿actualizar?"
- ✓ O: Sistema permite pero actualiza monto en transacción

**❌ Resultado Actual:** ___________________

**🐛 Nota:** Comportamiento no está claro

---

# 📈 FEATURE: PRESUPUESTOS

## 📌 TEST BUD-001: Crear Presupuesto Simple
**🎯 Descripción:** Crear presupuesto para una categoría

**🎬 Pasos:**
1. Ir a "Presupuestos"
2. Mes: Marzo 2026
3. Workspace: Familia
4. Click "Agregar grupo de gastos"
5. Categoría: "Comida"
6. Monto: 200,000
7. ¿Recurrente? No
8. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Presupuesto aparece para Marzo 2026
- ✓ Monto = 200,000
- ✓ Estado: No recurrente

**❌ Resultado Actual:** ___________________

---

## 📌 TEST BUD-002: Presupuesto Recurrente - Generar Automático
**🎯 Descripción:** Crear presupuesto recurrente que genere transacciones automáticas

**🎬 Pasos:**
1. Crear presupuesto:
   - Categoría: "Arriendo"
   - Monto: 500,000
   - ¿Recurrente? **SÍ**
   - Desde: Marzo 2026
2. Ir a "Generar transacciones recurrentes" (si existe botón)
3. Mes: Abril 2026

**✅ Resultado Esperado:**
- ✓ Se crea transacción de "Arriendo" para Abril
- ✓ Monto: 500,000
- ✓ Estado: "pending" / "planned"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST BUD-003: Validación - Presupuesto Negativo
**🎯 Descripción:** Sistema rechaza presupuesto con monto negativo

**🎬 Pasos:**
1. Monto: **-100,000**

**✅ Resultado Esperado:**
- ✓ Error

**❌ Resultado Actual:** ___________________

---

## 📌 TEST BUD-004: Drag-and-Drop de Presupuestos
**🎯 Descripción:** Reordenar presupuestos con drag-and-drop

**🎬 Pasos:**
1. 3 presupuestos en lista
2. Arrastrar "Comida" a posición del "Arriendo"
3. Refrescar página

**✅ Resultado Esperado:**
- ✓ Orden se persiste

**❌ Resultado Actual:** ___________________

---

# 📊 FEATURE: REPORTES (P&L, CASH FLOW)

## 📌 TEST REP-001: P&L - Seleccionar Workspace
**🎯 Descripción:** Filtrar P&L por workspace

**🎬 Pasos:**
1. Ir a "Estado de Resultados"
2. Workspace: "Consolidado"
3. Verificar números (suma de todos los workspaces)
4. Cambiar a: "Empresa"
5. Verificar que números decreased

**✅ Resultado Esperado:**
- ✓ Números cambien al cambiar workspace
- ✓ "Consolidado" = Empresa + Familia + Dentista

**❌ Resultado Actual:** ___________________

---

## 📌 TEST REP-002: Cash Flow - Proyección Semanal
**🎯 Descripción:** Ver flujo de caja proyectado por semanas

**🎬 Pasos:**
1. Ir a "Flujo de Caja"
2. Vista: "Próximas 4 semanas"
3. Verificar columnas de semanas
4. Ingresos esperados y gastos proyectados

**✅ Resultado Esperado:**
- ✓ Cada semana muestra:
  - Saldo inicial
  - Ingresos clientes
  - Gastos presupuestados
  - Saldo final

**❌ Resultado Actual:** ___________________

---

## 📌 TEST REP-003: Cash Flow - Balance de Apertura
**🎯 Descripción:** Verificar que el balance inicial es correcto

**🎬 Pasos:**
1. Cash Flow
2. Mes: Marzo 2026
3. Verificar "Balance de Apertura"

**✅ Resultado Esperado:**
- ✓ Balance = suma de todas las cuentas al inicio del mes
- ✓ Número es correcto

**❌ Resultado Actual:** ___________________

---

# 🔧 FEATURE: CONFIGURACIÓN / SETTINGS

## 📌 TEST SET-001: Cambiar Tema (Light/Dark)
**🎯 Descripción:** Toggle entre temas

**🎬 Pasos:**
1. Click botón theme en header
2. Cambiar a Dark
3. Refrescar página

**✅ Resultado Esperado:**
- ✓ UI cambia a dark
- ✓ Persiste después de refrescar

**❌ Resultado Actual:** ___________________

---

## 📌 TEST SET-002: Limpiar Datos (si existe butón)
**🎯 Descripción:** Borrar todos los datos de la app

**🎬 Pasos:**
1. Settings → "Limpiar datos"
2. Confirmar

**✅ Resultado Esperado:**
- ✓ Popup de confirmación fuerte (ej: pedir contraseña)
- ✓ Todos los datos se borran
- ✓ App regresa a estado limpio

**❌ Resultado Actual:** ___________________

---

# 🔄 FEATURE: SINCRONIZACIÓN ENTRE PESTAÑAS

## 📌 TEST SYNC-001: Actualización en Tiempo Real
**🎯 Descripción:** Cambios en una pestaña se reflejan en otras

**🎬 Pasos:**
1. Abrir app en 2 pestañas
2. En Tab 1: Crear nueva transacción
3. En Tab 2: Verificar que aparece

**✅ Resultado Esperado:**
- ✓ Transacción aparece en Tab 2 (sin refrescar)
- ✓ O si no hay sync en vivo: aparece al refrescar

**❌ Resultado Actual:** ___________________

---

## 📌 TEST SYNC-002: Tarjetas de Crédito Sincronizadas
**🎯 Descripción:** Agregar tarjeta se sincroniza entre pestañas

**🎬 Pasos:**
1. Tab 1 + Tab 2 abiertas
2. Ir a "Tarjetas de Crédito" en Tab 1
3. Agregar tarjeta: "Visa Gold"
4. En Tab 2: Ir a crear transacción
5. Verificar si "Visa Gold" aparece en opciones de tarjeta

**✅ Resultado Esperado:**
- ✓ "Visa Gold" aparece automáticamente

**❌ Resultado Actual:** ___________________

---

# 📱 FEATURE: RESPONSIVIDAD

## 📌 TEST RES-001: Mobile View - Transacciones
**🎯 Descripción:** Tabla de transacciones es usable en mobile

**🎬 Pasos:**
1. Abrir app en dispositivo mobile (o zoom a 375px)
2. Ir a Overview
3. Ver tabla de transacciones
4. Intentar editar/borrar

**✅ Resultado Esperado:**
- ✓ Tabla es responsive
- ✓ Acciones están accesibles (no escondidas)
- ✓ No hay scroll horizontal problemático

**❌ Resultado Actual:** ___________________

---

## 📌 TEST RES-002: Mobile - Formularios
**🎯 Descripción:** Formularios son usables en mobile

**🎬 Pasos:**
1. Mobile view
2. Click "Agregar transacción"
3. Llenar todo el formulario
4. Check: ¿Son usables los selects? ¿Date inputs? ¿Números?

**✅ Resultado Esperado:**
- ✓ Todos los inputs son tocables (>44px de altura)
- ✓ Teclado no ocupa toda la pantalla
- ✓ Botón "Guardar" es visible siempre

**❌ Resultado Actual:** ___________________

---

# 🔍 FEATURE: BÚSQUEDA / FILTRADO

## 📌 TEST SEARCH-001: Filtrar Transacciones por Categoría
**🎯 Descripción:** Filtrar tabla de transacciones

**🎬 Pasos:**
1. Overview
2. Si existe filtro de categoría, usarlo
3. Seleccionar: "Ventas"

**✅ Resultado Esperado:**
- ✓ Solo transacciones de "Ventas" aparecen
- ✓ Total de "Ingresos" se actualiza

**❌ Resultado Actual:** ___________________

**🐛 Nota:** No vimos filtros en el código, usar si existen

---

## 📌 TEST SEARCH-002: Búsqueda por Texto
**🎯 Descripción:** Buscar transacción por nombre

**🎬 Pasos:**
1. Buscar: "Cliente A"
2. Solo transacciones con "Cliente A" aparecen

**✅ Resultado Esperado:**
- ✓ Búsqueda funciona
- ✓ Case-insensitive

**❌ Resultado Actual:** ___________________

---

# ⚡ PERFORMANCE

## 📌 TEST PERF-001: Cargar 1,000 Transacciones
**🎯 Descripción:** App no debería lag con muchos datos

**🎬 Pasos:**
1. Importar CSV con 1,000 transacciones
2. Ir a Overview
3. Medir tiempo de carga
4. Verificar que UI es reactivo

**✅ Resultado Esperado:**
- ✓ Carga en < 2 segundos
- ✓ No hay freezing
- ✓ Scroll es smooth

**❌ Resultado Actual:** ___________________

---

## 📌 TEST PERF-002: Crear Transacción con Muchos Datos
**🎯 Descripción:** Form no debería lag con 1,000 categorías

**🎬 Pasos:**
1. Crear 1,000 categorías (o simular)
2. Abrir formulario de transacción
3. Medir tiempo de: click en select de categoría

**✅ Resultado Esperado:**
- ✓ Select abre en < 500ms

**❌ Resultado Actual:** ___________________

---

# 🐛 CASOS EDGE CRÍTICOS

## 📌 TEST EDGE-001: Mes con 31 Días + Presup Recurrente
**🎯 Descripción:** Presupuesto en mes con 31 días

**🎬 Pasos:**
1. Enero (31 días)
2. Crear presupuesto recurrente con "día 31"
3. Generar para Febrero (28 días)

**✅ Resultado Esperado:**
- ✓ O: Sistema ajusta a día 28
- ✓ O: Sistema advierte: "Febrero no tiene día 31"

**❌ Resultado Actual:** ___________________

---

## 📌 TEST EDGE-002: Año Bisiesto
**🎯 Descripción:** Presupuesto el 29 de febrero en año NO bisiesto

**🎬 Pasos:**
1. Presupuesto para 29-02-2027 (NO es bisiesto)

**✅ Resultado Esperado:**
- ✓ Sistema rechaza o ajusta a 28-02

**❌ Resultado Actual:** ___________________

---

## 📌 TEST EDGE-003: String Muy Largo
**🎯 Descripción:** Ingresar string de 10,000 caracteres

**🎬 Pasos:**
1. Nombre de transacción: 10,000 'A'
2. Click "Guardar"

**✅ Resultado Esperado:**
- ✓ Sistema rechaza o limita a 255 caracteres
- ✓ No causa crash

**❌ Resultado Actual:** ___________________

---

## 📌 TEST EDGE-004: Cambio De Timezone
**🎯 Descripción:** App maneja correctamente diferentes timezones

**🎬 Pasos:**
1. Crear transacción hoy a las 23:00
2. Cambiar timezone de sistema a +12 horas (UTC+12)
3. Verificar fecha de transacción

**✅ Resultado Esperado:**
- ✓ Fecha es correcta (sigue siendo hoy, no mañana)

**❌ Resultado Actual:** ___________________

---

# 📋 SUMMARY CHECKLIST

Marca lo que has revisado:

## Overview / Dashboard
- [ ] OV-001: Crear transacción simple
- [ ] OV-002: Rechazo de montos negativos
- [ ] OV-003: Rechazo de monto cero
- [ ] OV-004: Validación de monto inválido
- [ ] OV-005: Transferencia circular rechazada
- [ ] OV-006: Validación de saldo disponible
- [ ] OV-007: Editar transacción
- [ ] OV-008: Eliminar transacción
- [ ] OV-009: Reordenar tarjetas dashboard
- [ ] OV-010: Ocultar tarjetas

## Cuentas
- [ ] ACC-001: Crear cuenta
- [ ] ACC-002: Rechazo balance negativo
- [ ] ACC-003: Rechazo nombre vacío
- [ ] ACC-004: Editar cuenta
- [ ] ACC-005: Eliminar cuenta con transacciones

## Categorías
- [ ] CAT-001: Crear categoría
- [ ] CAT-002: Nombres duplicados
- [ ] CAT-003: Editar categoría
- [ ] CAT-004: Eliminar categoría con transacciones

## Importación
- [ ] IMP-001: Importar CSV simple
- [ ] IMP-002: Auto-detección de columnas
- [ ] IMP-003: Validación de fechas
- [ ] IMP-004: Detección de duplicados
- [ ] IMP-005: Duplicados dentro del CSV
- [ ] IMP-006: Importación de cuotas
- [ ] IMP-007: Validación de rango

## Ingresos Clientes
- [ ] CP-001: Crear ingreso
- [ ] CP-002: Cálculo de IVA
- [ ] CP-003: Rechazo monto negativo
- [ ] CP-004: Crear cliente sobre la marcha
- [ ] CP-005: Cambiar a "Pagado"
- [ ] CP-006: Editar ingreso pagado

## Presupuestos
- [ ] BUD-001: Crear presupuesto
- [ ] BUD-002: Presupuesto recurrente
- [ ] BUD-003: Rechazo monto negativo
- [ ] BUD-004: Reordenar presupuestos

## Reportes
- [ ] REP-001: P&L por workspace
- [ ] REP-002: Cash flow semanal
- [ ] REP-003: Balance de apertura

## Settings
- [ ] SET-001: Cambiar tema
- [ ] SET-002: Limpiar datos

## Sincronización
- [ ] SYNC-001: Actualización en tiempo real
- [ ] SYNC-002: Tarjetas sincronizadas

## Responsividad
- [ ] RES-001: Mobile - Transacciones
- [ ] RES-002: Mobile - Formularios

## Performance
- [ ] PERF-001: 1,000 transacciones
- [ ] PERF-002: 1,000 categorías

## Edge Cases
- [ ] EDGE-001: Mes con 31 días
- [ ] EDGE-002: Año bisiesto
- [ ] EDGE-003: String largo
- [ ] EDGE-004: Cambio timezone

---

# 📌 INSTRUCCIONES DE USO

1. **Ejecuta cada test en orden**
2. **Documenta el "Resultado Actual"** - Escribe exactamente qué sucede
3. **Marca problemas encontrados** - Sección "Problemas Encontrados"
4. **Si algo falla:** Intenta reproducirlo 2 veces más (puede ser glitch)
5. **Prioridad:** Primero CRÍTICO (OV-002, OV-005, OV-006, IMP-004), luego ALTO

---

**Fecha de Testing:** ___________________
**Tester:** ___________________
**Navegador:** ___________________
**Versión:** ___________________
