# 📋 Reporte de Testing - Octopus Finance

**Fecha:** 20 de marzo de 2026  
**Tester:** Análisis de código exhaustivo  
**Estado General:** ⚠️ Varios problemas críticos y de riesgo encontrados

---

## 🔴 CRÍTICO - Problemas de Seguridad

### 1. **Credenciales Firebase Expuestas en Código** ⚠️ ALTO RIESGO
**Ubicación:** `client/src/lib/firebase.ts`
```typescript
const firebaseConfig = {
  apiKey: "AIzaSyDFkNHHxpcRNB_2n_JaDJxD0sCI_cY2skA",
  authDomain: "my-cash-flow-bcb24.firebaseapp.com",
  projectId: "my-cash-flow-bcb24",
  storageBucket: "my-cash-flow-bcb24.firebasestorage.app",
  messagingSenderId: "660839296094",
  appId: "1:660839296094:f0e9e5bd5a9518cf",
};
```

**Riesgo:** Las claves de Firebase están públicamente visibles en el código fuente, permitiendo a cualquiera:
- Acceder a la base de datos Firestore sin autenticación
- Intentar ataques de fuerza bruta
- Manipular o exfiltrar datos financieros

**Recomendación:**
- ✅ Mover credenciales a variables de entorno (`.env.local`)
- ✅ Usar `.env.local` en `.gitignore`
- ✅ Regenerar todas las claves de Firebase inmediatamente
- ✅ Implementar autenticación en Firestore (reglas de seguridad)

**Acción Inmediata:** Regenerar claves Firebase y proteger credenciales

---

## 🟠 ALTO RIESGO - Problemas de Validación de Entrada

### 2. **Falta Validación de Valores Negativos en Montos**
**Ubicaciones Afectadas:**
- [client-payments.tsx](client/src/pages/client-payments.tsx#L91) - `calculateVatAndTotal()`
- [overview.tsx](client/src/pages/overview.tsx#L316) - Transferencias internas
- [accounts.tsx](client/src/pages/accounts.tsx#L100) - Balance inicial

**Problema:**
```typescript
const net = Number.parseFloat(netAmount || "0");
// NO hay validación que net >= 0
```

**Impacto:** Usuario puede ingresar montos negativos que generan inconsistencias en:
- Cálculos de IVA (puede resultar en IVA negativo)
- Saldo de cuentas
- Reportes de P&L

**Caso Edge:**
```
Input: -1000
VAT: -190
Total: -1190
```

**Recomendación:**
```typescript
const net = Number.parseFloat(netAmount || "0");
if (!Number.isFinite(net) || net < 0) {
  toast({ title: "El monto debe ser positivo", variant: "destructive" });
  return;
}
```

---

### 3. **No hay Validación de NaN en Conversiones Numéricas**
**Ubicaciones:**
- [client-payments.tsx](client/src/pages/client-payments.tsx#L316-L318) - Múltiples `Number.parseFloat()`
- [budget.tsx](client/src/pages/budget.tsx#L452) - `Number()` conversión
- [accounts.tsx](client/src/pages/accounts.tsx#L103) - Balance parsing

**Problema:**
```typescript
const net = Number.parseFloat(form.netAmount || "0");
const vat = Number.parseFloat(form.vatAmount || "0");
// Si form.netAmount = "abc", net = NaN
// Esto pasa silenciosamente sin error
```

**Caso Edge:**
```
Input: "notanumber"
Output: NaN
Resultado en BD: NaN (inválido)
```

**Recomendación:**
```typescript
const parseAmount = (value: string): number | null => {
  const num = Number.parseFloat(value || "0");
  return Number.isFinite(num) ? num : null;
};

const net = parseAmount(form.netAmount);
if (net === null) {
  toast({ title: "Monto inválido", variant: "destructive" });
  return;
}
```

---

### 4. **Falta Validación de Strings Largos (XSS Potencial)**
**Ubicaciones:**
- [categories.tsx](client/src/pages/categories.tsx) - `editName.trim()`
- [accounts.tsx](client/src/pages/accounts.tsx) - `newName`, `newBank`
- [client-payments.tsx](client/src/pages/client-payments.tsx) - `clientName`, `contactName`

**Problema:** No hay límite de caracteres en inputs de texto
```typescript
const handleCreate = (e: React.FormEvent) => {
  if (!newName.trim()) return; // Solo valida que NO esté vacío
  // ¿Qué pasa si newName tiene 100,000 caracteres?
};
```

**Recomendación:**
```typescript
const MAX_NAME_LENGTH = 255;
if (!newName.trim() || newName.length > MAX_NAME_LENGTH) {
  toast({ title: `Máximo ${MAX_NAME_LENGTH} caracteres` });
  return;
}
```

---

### 5. **Validación Incompleta en Importación de CSV**
**Ubicación:** [import-data.tsx](client/src/pages/import-data.tsx#L100)

**Problema:** La función `suggestExpenseCategory()` tiene múltiples validaciones string, pero:
- No valida duplicados de transacciones (puede importar 2 veces la misma)
- No valida rango de fechas válidas
- No valida montos máximos/mínimos razonables

**Caso de Prueba:**
```
Importar 2 veces el mismo CSV
→ Resultado: Duplicados en BD (misma transacción 2x)
```

---

## 🟡 MEDIO RIESGO - Problemas de Lógica de Negocio

### 6. **Transferencias Internas Entre Cuentas Sin Validación de Circularidad**
**Ubicación:** [overview.tsx](client/src/pages/overview.tsx#L300-L350)

**Problema:**
```typescript
if (movementType === "transfer" && !destinationAccountId) {
  toast({ title: "Selecciona la cuenta destino", variant: "destructive" });
  return;
}
```

Validación incompleta:
- ✅ Verifica que hay destino
- ❌ NO verifica que `sourceAccountId !== destinationAccountId`
- ❌ NO verifica que ambas cuentas existan

**Caso de Prueba:**
```
Transferencia de Cuenta A → Cuenta A
Resultado: Transacción crea ciclo lógico sin sentido
```

**Recomendación:**
```typescript
if (sourceAccountId === destinationAccountId) {
  toast({ title: "La cuenta origen y destino deben ser diferentes" });
  return;
}

const sourceExists = accounts.find(a => a.id === sourceAccountId);
const destExists = accounts.find(a => a.id === destinationAccountId);
if (!sourceExists || !destExists) {
  toast({ title: "Cuenta no encontrada" });
  return;
}
```

---

### 7. **Cálculo de IVA Usa Math.round() Causando Discrepancias**
**Ubicación:** [client-payments.tsx](client/src/pages/client-payments.tsx#L91-L94)

```typescript
function calculateVatAndTotal(netAmount: string) {
  const net = Number.parseFloat(netAmount || "0");
  const safeNet = Number.isFinite(net) ? net : 0;
  const vat = Math.round(safeNet * 0.19);  // ❌ Redondea hacia arriba/abajo
  return {
    vatAmount: String(vat),
    totalAmount: String(safeNet + vat),
  };
}
```

**Problema:** `Math.round()` puede causar:
- IVA inconsistente con cálculos manuales
- Discrepancias en reportes contables

**Ejemplo:**
```
Net: 1000
Expected VAT: 1000 * 0.19 = 190
Math.round(190): 190 ✓ OK

Net: 1001
Expected VAT: 1001 * 0.19 = 190.19
Math.round(190.19): 190 ❌ Pierde $0.19
```

**Recomendación:**
```typescript
const vat = Math.floor(safeNet * 0.19); // Redondea hacia abajo (más conservador)
// O mejor: usar biblioteca de precisión decimal (decimal.js)
```

---

### 8. **Pago de Tarjeta de Crédito Sin Validación de Saldo Disponible**
**Ubicación:** [overview.tsx](client/src/pages/overview.tsx) - `InternalMovementForm`

**Problema:** No verifica que la cuenta origen tenga saldo suficiente
```typescript
const handleSubmit = (e: React.FormEvent) => {
  if (!amount || Number(amount) <= 0) {
    toast({ title: "Ingresa un monto válido" });
    return;
  }
  // ✅ Valida monto > 0
  // ❌ NO valida que sourceAccount.balance >= amount
};
```

**Caso de Prueba:**
```
Saldo en cuenta: $100
Intento pagar tarjeta: $1,000
Resultado: Sistema permite (¡debe rechazar!)
```

---

### 9. **Presupuesto Recursivo Sin Límite de Profundidad**
**Ubicación:** [firestore.ts](client/src/lib/firestore.ts#L150) - `generateMonthlyRecurringTransactions()`

**Problema:** La función genera transacciones recursivas pero no tiene:
- ✅ Límite máximo de meses a generar
- ✅ Validación de año/mes válidos
- ✅ Protección contra loops infinitos

```typescript
for (const budget of recurringBudgets) {
  // Genera transacción para cada presupuesto recursivo
  // ¿Qué pasa si recurringBudgets.length = 1,000,000?
  // Puede causar timeout o crash
}
```

---

## 🔵 BAJO RIESGO - Problemas de UX/Robustez

### 10. **Sin Manejo de Errores en Mutaciones (No hay try-catch)**
**Ubicaciones Generales:**
- [hooks.ts](client/src/lib/hooks.ts) - Todas las mutaciones
- [firestore.ts](client/src/lib/firestore.ts) - Operaciones Firestore

**Problema:**
```typescript
export function useCreateTransaction() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    // ❌ NO tiene onError
  });
}
```

**Impacto:** Si Firestore falla:
- Usuario no recibe mensaje de error
- Query cache puede quedar inconsistente
- UI puede mostrar estado incorrecto

**Recomendación:**
```typescript
return useMutation({
  mutationFn: (data: Record<string, any>) => fs.createTransaction(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    toast({ title: "Transacción creada" });
  },
  onError: (error) => {
    toast({ 
      title: "Error al crear transacción",
      description: error.message,
      variant: "destructive"
    });
  }
});
```

---

### 11. **Manejo de Undefined/Null Inconsistente**
**Ubicaciones Varias:**
- [cash-flow.tsx](client/src/pages/cash-flow.tsx#L200) - `Number(account.currentBalance) || 0`
- [client-payments.tsx](client/src/pages/client-payments.tsx#L100) - Campos opcionales

**Problema:**
```typescript
const totalAccountsBalance = accounts.reduce(
  (sum, account) => sum + (Number(account.currentBalance) || 0),
  0,
);
```

¿Qué pasa si `currentBalance = 0`?
```
Number(0) || 0  // ¿Suma 0 o lo salta?
```

**Recomendación:**
```typescript
const totalAccountsBalance = accounts.reduce(
  (sum, account) => sum + (Number(account.currentBalance) ?? 0),
  0,
);
```

---

### 12. **Sincronización de Estado Entre Pestañas Sin Validación**
**Ubicación:** [overview.tsx](client/src/pages/overview.tsx), [credit-cards-panel.tsx](client/src/pages/credit-cards-panel.tsx)

```typescript
useEffect(() => {
  const sync = () => setCreditCards(getCreditCards());
  sync();
  window.addEventListener("octopus-credit-cards-updated", sync);
  return () => window.removeEventListener("octopus-credit-cards-updated", sync);
}, []);
```

**Problema:** Event listener global es frágil:
- Si el evento se dispara muy rápido, puede causar race conditions
- No hay validación del formato de datos del evento
- No hay rate limiting

---

### 13. **Formato de Fecha Hardcodeado (Error Potencial)**
**Ubicaciones:**
- [cash-flow.tsx](client/src/pages/cash-flow.tsx) - `column.start.toISOString().slice(0, 10)`
- [budget.tsx](client/src/pages/budget.tsx) - Múltiples conversiones de fecha
- [overview.tsx](client/src/pages/overview.tsx) - `new Date().toISOString().split("T")[0]`

**Problema:** Múltiples formas de formatear fechas sin función centralizada
```typescript
// 3 formas diferentes en el código:
new Date().toISOString().split("T")[0]
column.start.toISOString().slice(0, 10)
String(transaction.date ?? "")
```

**Riesgo:** Inconsistencias en comparación de fechas

**Recomendación:**
```typescript
// utils.ts
export function formatDateToYYYYMMDD(date: Date): string {
  return date.toISOString().split("T")[0];
}
```

---

### 14. **Botones de Acción Sin Confirmación**
**Ubicaciones:**
- [accounts.tsx](client/src/pages/accounts.tsx) - Delete sin confirmación
- [items-manager.tsx](client/src/pages/items-manager.tsx) - Delete items
- [budget.tsx](client/src/pages/budget.tsx) - Delete budgets

**Problema:** Delete puede ser accidental sin confirmación en algunos lugares

---

### 15. **Estado de Loading No Completo en Todas las Operaciones**
**Ubicación:** [client-payments.tsx](client/src/pages/client-payments.tsx#L300-L320)

```typescript
const handleSubmit = (e: React.FormEvent) => {
  createMutation.mutate({
    // payload
  });
  // ❌ Usuario puede hacer click múltiples veces
  // Bien sería: desactivar botón mientras isPending
};
```

---

## 📊 TESTS ESPECÍFICOS POR FEATURE

### Feature: Transacciones

**Casos Críticos Faltantes:**
- [ ] Crear transacción con monto = 0 → Debe rechazar
- [ ] Crear transacción con monto = -1000 → Debe rechazar
- [ ] Crear transacción con fecha futura (ej: 2030-01-01) → Debe aceptar pero marcar como "planned"
- [ ] Editar transacción y cambiar monto de 1000 a "abc123" → Debe rechazar
- [ ] Eliminar transacción que no existe (race condition) → Manejo de error
- [ ] Crear 10,000 transacciones en un mes → Performance test

### Feature: Cuentas Bancarias

**Casos Críticos Faltantes:**
- [ ] Crear cuenta con balance inicial = "9999999999999" → Validar límite
- [ ] Crear transferencia de Cuenta A → Cuenta A → Debe rechazar
- [ ] Transferencia cuando balance = 0 → Validar saldo disponible
- [ ] Eliminar cuenta con transacciones vinculadas → Cascada de eliminación

### Feature: Clientes

**Casos Críticos Faltantes:**
- [ ] Crear cliente con RUT inválido ("12345") → Validación de formato
- [ ] Cliente con nombre vacío ("") → Debe rechazar
- [ ] Email inválido ("notanemail") → Validación de formato

### Feature: Importación CSV

**Casos Críticos Faltantes:**
- [ ] CSV con 100,000 filas → Performance y manejo de batches
- [ ] Importar 2 veces el mismo CSV → Detección de duplicados
- [ ] CSV con fechas inválidas → Validación de formato
- [ ] CSV con montos extremos (< 1, > 999,999,999) → Validación de rango

### Feature: Presupuestos Recursivos

**Casos Críticos Faltantes:**
- [ ] Presupuesto recursivo con dayOfMonth = 0 → Debe ser 1-31
- [ ] Presupuesto recursivo con dayOfMonth = 32 → Debe rechazar
- [ ] Generar presupuesto recursivo para año 2050 → Validar límite temporal

---

## 📝 PROBLEMAS TÉCNICOS NO FUNCIONALES

### 16. **Tipos TypeScript Demasiado Genéricos**
**Ubicación:** [hooks.ts](client/src/lib/hooks.ts)

```typescript
export function useCreateTransaction() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createTransaction(data),
    // ^^^^^^^^ Record<string, any> es muy genérico
  });
}
```

**Recomendación:** Usar tipos específicos
```typescript
export function useCreateTransaction() {
  return useMutation({
    mutationFn: (data: InsertTransaction) => fs.createTransaction(data),
  });
}
```

---

### 17. **Falta de Logging/Debugging**
**Ubicación:** Toda la app

Ningún console.log o logger en puntos críticos:
- Cangas en BD
- Errores de cálculo
- Estado de mutaciones

**Recomendación:** Agregar logger simple para debugging

---

## ✅ COSAS QUE FUNCIONAN BIEN

- ✅ Arquitectura React + Query es sólida
- ✅ Uso de Zod para schemavalidación en backend (aunque no usado en client)
- ✅ Responsive design con Tailwind
- ✅ Componentes UI reutilizables Radix UI
- ✅ Drag-and-drop bien implementado (dnd-kit)
- ✅ Multi-workspace está bien separado

---

## 🎯 PLAN DE ACCIÓN RECOMENDADO

### Semana 1 - CRÍTICO
- [ ] Mover credenciales Firebase a `.env.local`
- [ ] Implementar reglas de seguridad Firestore
- [ ] Agregar validación de valores >= 0 en todos los montos
- [ ] Agregar manejo de errores en mutaciones

### Semana 2 - ALTO RIESGO
- [ ] Validación de NaN en conversiones numéricas
- [ ] Validar que sourceAccountId !== destinationAccountId
- [ ] Validar saldo disponible antes de transferencias
- [ ] Límites en strings (255 caracteres para nombres)

### Semana 3 - MEDIO RIESGO
- [ ] Crear función centralizada para parseo numérico
- [ ] Función centralizada para formato de fechas
- [ ] Tests automatizados para casos edge
- [ ] Tests de performance con grandes volúmenes

### Semana 4 - MEJORAS
- [ ] Logging/debugging
- [ ] Mejorar tipos TypeScript
- [ ] Tests E2E con Playwright
- [ ] Performance optimization

---

## 📌 CONCLUSIÓN

**Calificación General:** 6.5/10

La app está **funcionalmente completa** pero tiene **riesgos importantes** que deben ser corregidos antes de producción. Los problemas principales son:

1. 🔴 **SEGURIDAD:** Credenciales expuestas
2. 🟠 **VALIDACIÓN:** Falta validación de entrada en múltiples lugares
3. 🟡 **LÓGICA:** Algunos casos edge no manejados

Con los ajustes recomendados, la app sería **8.5/10** y lista para producción.

---

**Próximos pasos:** Retomar cuando las correcciones críticas (semana 1) estén implementadas.
