# Plan: Bot de movimientos bancarios → app (Edwards primero)

> Estado: aprobado por Pancho + revisado por Codex (gpt-5.5) el 2026-06-28.
> Construcción por etapas. Edwards primero; Santander Office Banking es etapa 2.

## Objetivo
Una vez al día, en el Mac de Pancho, entrar a Banco Edwards, leer los movimientos
(Cuenta Corriente 00-310-10777-06 + tarjeta de crédito facturados/no facturados) y
dejarlos en la bandeja de importación de la app (`importBatches` + `importedMovements`,
estado `pending`) para que Pancho los revise y convierta. **Sin auto-convertir.** Aviso por correo.

## Decisiones tomadas
- Solo Cuenta Corriente (term. 06) + tarjeta. Sin Cuenta Vista.
- Corre 9:00 AM, o al despertar el Mac si estaba apagado.
- Aviso por correo (futuro: PWA push).
- Cae en bandeja de revisión, Pancho confirma.
- Clave en macOS Keychain (`octopus-finance-edwards`), leída en runtime. Sin texto plano.
- Corre en el Mac (no nube): el banco no pide 2FA desde su IP/equipo; en la nube probablemente sí.

## Arquitectura
- Script TS corrido con `tsx` (como `scripts/firestore-audit.ts`). Vive en `scripts/bank-bot/`.
- Firestore: init propio con `firebase/firestore/lite` + `.env.local` (VITE_FIREBASE_*),
  igual que los scripts existentes. **No** importar `client/src/lib/firestore.ts` entero
  (deps de browser/aliases); reusar solo helpers puros de `domain/` o replicar los mínimos.
- Scraping: Playwright Chromium, perfil persistente (dispositivo estable). Login RUT+clave, sin 2FA.

## Correcciones de Codex incorporadas
1. **Duplicados:** `createImportedMovementBatch` NO saltea duplicados (los marca y los inserta).
   → El bot filtra lo ya visto ANTES de cargar, usa **doc id determinístico derivado del dedupeKey**
   (re-cargar pisa, no duplica), y **no crea lote si no hay filas nuevas**.
2. **dedupeKey débil** (fuente/fecha/monto/descripción). Reforzar con id de fila del banco si existe;
   normalizar descripción; incluir cuenta/tarjeta. Aceptamos imperfección: la bandeja es revisada igual.
3. **Pago de tarjeta:** clasificar como `credit_card_payment` para no doble-contar
   (el mismo evento aparece en cuenta corriente y tarjeta).
4. **Parser robusto:** montos CLP ("$ 1.520.000" → 1520000), fechas dd/mm/aaaa → ISO,
   signo/dirección, cuotas "01/12". Validar; lo dudoso se aparta, no se carga basura.
5. **DESCARGAR vs DOM:** si el botón "DESCARGAR" de Edwards da CSV/Excel estable, preferirlo
   (Playwright `waitForEvent('download')` + `saveAs()` resuelve el tema del nombre UUID).
   Si no, scraping DOM (probado que funciona).
6. **Ventana de scrape definida:** ej. cuenta corriente últimos ~14 días; tarjeta ciclo actual+anterior.
   Manejar paginación/carga diferida.
7. **launchd:** `StartCalendarInterval` 9:00 + guardar "última corrida exitosa" + candado atómico
   (`mkdir`/`flock`), no "chequear y crear". Probar de verdad el comportamiento al despertar.
8. **Keychain bajo LaunchAgent:** validar temprano desde el agente real (no terminal); puede pedir
   permiso/fallar. Configurar ACL del ítem para lectura no interactiva. Fallar con aviso claro.
9. **Playwright:** perfil persistente sí; "stealth" no es bala de plata. Estado explícito
   "necesita login humano" en vez de reintentar infinito. Capturas/HTML en fallo, **redactados**.
10. **Correo:** reusar el envío de OM Ops (Gmail API + cuenta de servicio + delegación).
11. **Logs:** sin clave/cookies/HTML post-login/números de tarjeta completos. Dir `chmod 700`, logs `chmod 600`.

## Alerta de seguridad aparte (de la app, no del bot)
Las reglas de Firestore permiten escritura sin autenticación. El bot no lo empeora (usa el mismo
mecanismo que la app), pero conviene revisar las reglas / auth por separado en algún momento.

## Etapas de construcción (nada riesgoso hasta el final)
1. **Parser + prueba en seco** con datos ya capturados (NO toca Firestore). ← empezamos acá.
2. Cargar a un lote de prueba con una fuente; revisar en la app.
3. Correr Playwright a la vista (manual) una vez.
4. Una corrida desde launchd, sin enviar correos.
5. Activar correo.
6. Programar diario.

## Pendientes (mejoras detectadas)
- **Auto-categorizacion (alta prioridad):** el cargador NO aplica las MovementRules del usuario,
  por eso todo cae como "Sin categoria". Fix: en load-edwards.ts, cargar `movementRules` y correr
  `findBestMovementRule` + `applyMovementRule` (puros, en domain/bank-imports.ts) sobre cada
  movimiento antes de escribir, igual que hace `createImportedMovementBatch`. Asi llega con
  categoria/ambito sugeridos (ej. Uber Eats -> Familia/Comida) como en la importacion manual.
  Verificado por Pancho 2026-06-28: la carga funciona y se ve en la app, pero sin categorias.
- **Cuota: confirmar mapeo de columnas Cargos/Abono en cuenta corriente** con el scraper real.

## Validar en la primera corrida real antes de confiar diario
- Que el dedupe no duplique ni pierda.
- Que no cree lotes vacíos.
- Que el Keychain se lea desde el LaunchAgent.
- Que el login no pida 2FA desde el Mac.
- Que los artefactos de fallo estén redactados.
