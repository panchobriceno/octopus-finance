# 🔬 Validación de Lógica de Negocio - Octopus Finance

**Objetivo:** Verificar que la lógica de negocio está correctamente implementada en cada feature.

---

## 1️⃣ LÓGICA: TRANSACCIONES

### ✅ Información Esperada

Una transacción debe tener:
- **ID único** (UUID)
- **Nombre/Descripción** (max 255 caracteres)
- **Tipo:** income | expense
- **Monto:** número positivo
- **Categoría:** referencia a categoría válida
- **Fecha:** YYYY-MM-DD formato
- **Workspace:** business | family | dentist
- **Estado:** pending | paid | cancelled
- **Subtipo:** actual | planned
- **Método de pago:** cash | bank_account | credit_card (si aplica)

### 🔍 Validaciones a Verificar

| Validación | ¿Existe? | Ubicación | Resultado |
|-----------|---------|----------|-----------|
| Monto > 0 | ❌ NO | overview.tsx | ❌ FALLA |
| Monto es número válido | ❌ NO | overview.tsx | ❌ FALLA |
| Nombre no vacío | ✅ SÍ | overview.tsx | ✅ OK |
| Nombre tiene límite | ❌ NO | overview.tsx | ❌ FALLA |
| Fecha es válida | ✅ SÍ | overview.tsx | ✅ OK |
| Categoría existe | ✅ SÍ | overview.tsx | ✅ OK |
| Field status válido | ❌ PARCIAL | overview.tsx | ⚠️ PARCIAL |

### 🧮 Lógica de Cálculos

**Test: Cambiar monto de transacción**

Escenario:
- Transacción original: $10,000 (income)
- Dashboard muestra: Ingresos = $50,000
- Usuario edita monto a: $15,000
- Dashboard debería mostrar: Ingresos = $55,000

¿Cómo validar esto?
1. Abrir Overview
2. KPI "Ingresos" = X
3. Editar transacción, aumentar 5,000
4. KPI debería ser X + 5,000

**Estado Esperado:** ❌ PROBABLEMENTE FALLA (no hay re-cálculo visible)

---

## 2️⃣ LÓGICA: TRANSFERENCIAS INTERNAS

### ✅ Reglas de Negocio

1. **Validación de Circulación:**
   - ❌ NO EXISTE: Verificar que sourceAccountId !== destinationAccountId
   - **Impacto:** Permite transferencias A→A (sin sentido)

2. **Validación de Saldo:**
   - ❌ NO EXISTE: sourceAccount.balance >= monto
   - **Impacto:** Permite sobregiros

3. **Impacto en Balance:**
   - Cuenta origen: saldo DISMINUYE
   - Cuenta destino: saldo AUMENTA
   - ❌ NO VERIFICADO: ¿Se actualiza el balance actual de la cuenta?

### 🧪 Test Manual

```
Precondición:
- Cuenta A: $1,000
- Cuenta B: $500

Acción:
Transfer $800 de A → B

Resultado Esperado:
- Cuenta A: $200
- Cuenta B: $1,300

Resultado Actual:
[Verificar manualmente en la app]
```

---

## 3️⃣ LÓGICA: CÁLCULO DE IVA

### ❌ PROBLEMA DETECTADO

```typescript
function calculateVatAndTotal(netAmount: string) {
  const net = Number.parseFloat(netAmount || "0");
  const safeNet = Number.isFinite(net) ? net : 0;
  const vat = Math.round(safeNet * 0.19);  // ❌ BUG
  return {
    vatAmount: String(vat),
    totalAmount: String(safeNet + vat),
  };
}
```

### 🧮 Ejemplos donde falla:

| Neto | IVA Esperado | IVA Actual | Error |
|-----|--------------|-----------|-------|
| $1,000 | $190.00 | $190 | ✅ OK |
| $1,001 | $190.19 | $190 | ❌ -$0.19 |
| $10,526 | $2,000.00 (aprox) | $2,000 | ✅ OK |
| $10,527 | $2,000.13 | $2,000 | ❌ -$0.13 |

### 📊 Test: Validar IVA para 100 valores

Crear un script que verifique:
```javascript
for (let net of [1000, 1001, 5000, 5555, 10000, 10526, 10527]) {
  const app_vat = calculateVatAndTotal(net.toString()).vatAmount; // desde app
  const expected_vat = Math.floor(net * 0.19);
  console.log(`${net}: app=${app_vat}, expected=${expected_vat}, diff=${app_vat - expected_vat}`);
}
```

**Resultado Esperado:**
```
1000: app=190, expected=190, diff=0
1001: app=190, expected=190, diff=0  ← App falla here
5000: app=950, expected=950, diff=0
5555: app=1055, expected=1055, diff=0  ← Prob OK
10000: app=1900, expected=1900, diff=0
10526: app=2000, expected=2000, diff=0
10527: app=2000, expected=2000, diff=0  ← App falla here
```

---

## 4️⃣ LÓGICA: PRESUPUESTOS RECURRENTES

### ✅ Flujo Esperado

1. Usuario crea presupuesto recurrente:
   - Categoría: "Arriendo"
   - Monto: $500,000
   - Mes: Marzo 2026
   - ¿Recurrente? SÍ

2. Sistema almacena: isRecurring = true

3. Usuario va a "Generar Transacciones Recurrentes"

4. Selecciona: Abril 2026

5. Sistema genera transacciones para Abril:
   - Nombre: "Arriendo"
   - Monto: $500,000
   - Estado: "pending" / "planned"

### ⚠️ Problemas Identificados

1. **Sin validación de límite:**
   - ✅ Código crea batch de máximo 450 transacciones por vez
   - ✅ Loop infinito protegido
   - ⚠️ PERO: Si isRecurring tiene "glitch", podría generar infinitamente

2. **Validación incompleta de dayOfMonth:**
   ```typescript
   // Falta validar:
   if (dayOfMonth < 1 || dayOfMonth > 31) reject();
   ```

3. **Año bisiesto:**
   ```typescript
   // Si dayOfMonth = 29 y mes = Febrero de año NO bisiesto
   // ¿Qué pasa?
   // ESPERADO: Sistema ajusta a 28 o rechaza
   // ACTUAL: [Desconocido, requiere test manual]
   ```

### 🧪 Test Manual

```
Paso 1: Crear presupuesto recurrente
- Mes: Marzo 2026
- Categoría: Testeadora
- Monto: $1,000
- ¿Recurrente? SÍ
- Guardar

Resultado: [Verificar en BD]
- isRecurring debe ser TRUE

Paso 2: Generar para Abril
- Click "Generar transacciones" (si existe)
- Mes: Abril 2026

Resultado Esperado:
- Nuevo presupuesto para Abril creado
- O: Transacción "planned" creada para Abril

Resultado Actual:
[Verificar manualmente]
```

---

## 5️⃣ LÓGICA: IMPORTACIÓN CSV

### 🔍 Flujo de Deduplicación

Código actual detecta duplicados por clave:
```typescript
const key = `${tx.date}__${tx.name.toLowerCase()}__${tx.type}__${tx.amount}`;
```

### ⚠️ Problema: Demasiado Estricto

**Escenario 1: Transacción legítima duplicada**
```
Transacción 1: [2026-01-05 | Venta | expense | 1000]
Transacción 2: [2026-01-05 | Venta | expense | 1000]

¿Son iguales?
Sistema: SÍ (misma clave)
Realidad: Podrían ser 2 transacciones diferentes el MISMO DÍA

Problema: Sistema rechaza la segunda
```

### ⚠️ Problema: Demasiado Laxo

**Escenario 2: Transacción duplicada real**
```
Transacción 1: [2026-01-05 | Venta Cliente A | income | 5000]
Transacción 2: [2026-01-05 | Venta a Cliente A | income | 5000]

¿Son iguales?
Sistema: NO (nombre diferente por una letra)
Realidad: Probablemente SÍ (error de tipeo)

Problema: Sistema permite ambas
```

### 🧪 Test: Importación Múltiple

1. CSV con 5 transacciones (todas válidas, sin duplicados)
2. Importar una vez ✓
3. Importar el MISMO CSV nuevamente

**Resultado Esperado:**
- Sistema detecta todas como duplicados
- Toast: "5 duplicados detectados, 0 importados"

**Resultado Actual:**
- ❌ PROBABLEMENTE: Sistema permite importar de nuevo
- BD tendrá transacciones duplicadas

---

## 6️⃣ LÓGICA: ESTADOS DE CLIENTE PAYMENT

### ✅ Estados Válidos

```
projected  → receivable → invoiced → paid ✓
                                   ↓
                            cancelled (cualquier momento)
```

### ⚠️ Transiciones No Permitidas

- ❌ paid → receivable (no debería ser posible)
- ❌ cancelled → paid (no debería revertirse)

### 🧪 Test: Intentar Transición Inválida

1. ClientPayment en estado "paid"
2. Intentar cambiar a "receivable" (inverso)

**Resultado Esperado:**
- Sistema rechaza o no permite cambio
- UI deshabilita opciones inválidas

**Resultado Actual:**
[Verificar manualmente]

---

## 7️⃣ LÓGICA: WORKSPACE SEPARATION

### ✅ Requisito

- Transacciones de "Familia" NO deben afectar saldos de "Empresa"
- Presupuestos de "Family" NO deben afectar "Business"
- Reportes por workspace deben ser independientes

### 🧪 Test: Separación de Workspaces

```
Paso 1: Overview - Empresa
- KPI Ingresos: $50,000

Paso 2: Crear transacción en Familia
- +$100,000 ingreso

Paso 3: Volver a Overview - Empresa
- KPI Ingresos: ¿$50,000 (correcto) o $150,000 (ERROR)?

Resultado Esperado: $50,000 (sin cambios)
Resultado Actual: [Verificar]
```

---

## 8️⃣ LÓGICA: CURRENCY FORMAT

### ✅ Formato

Todas las transacciones usan **CLP** (pesos chilenos)

```typescript
export function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
```

### ✅ Requisito

- No debe haber decimales en CLP
- $1,000 → $1.000 (con punto como separador)

### 🧪 Test: Formato de Moneda

1. Crear transacción con monto $1,234,567.89
2. Verificar que se muestra: **$1.234.568** (redondeado, sin decimales)

**Resultado Esperado:** Correcto
**Resultado Actual:** [Verificar]

---

## 9️⃣ LÓGICA: DATES & TIMEZONES

### ⚠️ Potencial Bug

Código usa `.split("T")` y `.slice(0, 10)` para formato YYYY-MM-DD:

```typescript
new Date().toISOString().split("T")[0]  // "2026-03-20"
```

### ⚠️ Problema: Timezone

Si usuario está en UTC-8:
```
Hora actual: 2026-03-20 23:00 (UTC-8)
toISOString(): 2026-03-21 07:00 (UTC)
.split("T")[0]: 2026-03-21 ← ¡WRONG DATE!
```

### 🧪 Test: Timezone

1. Cambiar timezone de sistema a UTC+12
2. Crear transacción "hoy"
3. Verificar fecha en BD

**Resultado Esperado:** Fecha local correcta
**Resultado Actual:** [Verificar]

---

## 🔟 LÓGICA: NULL vs UNDEFINED

### ⚠️ Inconsistencia Detectada

```typescript
// Método 1: || (logical OR)
account.currentBalance || 0
// Problema: Si balance = 0, usa 0 ✓ OK

// Método 2: ?? (nullish coalescing)
account.currentBalance ?? 0
// Correcto: Si balance = 0, usa 0 ✓ OK

// Método 3: if statement
if (account.currentBalance) // Problema si balance = 0!
```

### 🧪 Test: Balance = 0

1. Crear cuenta con balance inicial = $0
2. Verificar en cash-flow y reportes

**Resultado Esperado:**
- Saldo debería ser $0 (incluido en cálculos)
- No debería ignorarse

**Resultado Actual:** [Verificar]

---

## 📋 CHECKLIST DE LÓGICA

Marca cada validación:

### Transacciones
- [ ] Rechaza montos negativos
- [ ] Rechaza montos = 0
- [ ] Rechaza montos inválidos (NaN)
- [ ] Rechaza categorías inexistentes
- [ ] Rechaza nombres vacíos

### Transferencias
- [ ] Rechaza origen = destino
- [ ] Rechaza si saldo insuficiente
- [ ] Actualiza balance de ambas cuentas

### IVA
- [ ] Cálculo es preciso (sin redondeo de píos)
- [ ] Total = neto + IVA
- [ ] No hay pérdida de centavos

### Presupuestos
- [ ] isRecurring se guarda correctamente
- [ ] Generación de transacciones funciona
- [ ] Sin loops infinitos
- [ ] Validación de dayOfMonth

### Importación
- [ ] Detecta duplicados con BD
- [ ] Detecta duplicados dentro del archivo
- [ ] Rechaza filas con errores

### Workspaces
- [ ] Transacciones no se mezclan
- [ ] Reportes por workspace son correctos
- [ ] KPIs son independientes

### Formatos
- [ ] Moneda es CLP sin decimales
- [ ] Fechas son YYYY-MM-DD
- [ ] Timezone es correcto

### Null/Undefined
- [ ] Balance = 0 se incluye en cálculos
- [ ] Campos opcionales se manejan correctamente

---

## 🚨 PROBLEMAS CONFIRMADOS HASTA AHORA

| Problema | Severidad | Ubicación | Estado |
|----------|-----------|----------|--------|
| Credenciales Firebase expuestas | CRÍTICA | firebase.ts | ⚠️ NO REPARADO |
| Sin validación de montos < 0 | ALTA | overview.tsx, client-payments.tsx | ⚠️ NO REPARADO |
| Sin validación de NaN | ALTA | overview.tsx, client-payments.tsx | ⚠️ NO REPARADO |
| Transferencia A→A permitida | MEDIA | overview.tsx | ⚠️ NO REPARADO |
| Sin validación de saldo | MEDIA | overview.tsx | ⚠️ NO REPARADO |
| IVA con Math.round() | MEDIA | client-payments.tsx | ⚠️ NO REPARADO |
| Importación permite duplicados | MEDIA | import-data.tsx | ⚠️ NO REPARADO |
| Sin error handling en mutaciones | MEDIA | hooks.ts | ⚠️ NO REPARADO |

---

## 📊 RESUMEN

**Total de validaciones:** 50+
**Validaciones que faltan:** ~30
**Severidad promedio:** ALTA

**Conclusión:** La lógica de negocio tiene gaps significativos que deben ser reparados antes de usar en producción con datos reales.
