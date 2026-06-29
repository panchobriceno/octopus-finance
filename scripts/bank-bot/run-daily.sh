#!/bin/zsh
# Orquestador diario del bank-bot. Lo dispara launchd a las 9am (y al prender el Mac).
# Por ahora corre el pipeline de Edwards por email (validado). Santander/Playwright se
# iran sumando aca cuando esten listos.

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="/Users/panchobriceno/Downloads/octopus-finance-source"
cd "$REPO" || exit 1

mkdir -p scripts/bank-bot/logs
LOG="scripts/bank-bot/logs/run-$(date +%Y%m%d).log"

# Candado por dia: no correr dos veces el mismo dia
STAMP="scripts/bank-bot/logs/.last-success-$(date +%Y%m%d)"
if [ -f "$STAMP" ]; then
  echo "$(date) ya corrio hoy con exito, salto." >> "$LOG"
  exit 0
fi

{
  echo "=== $(date) bank-bot run ==="
  echo "--- Edwards email (compras tarjeta) ---"
  npx tsx scripts/bank-bot/load-email-edwards.ts 3
  RC_EDW=$?
  echo "exit edwards-email: $RC_EDW"

  echo "--- Santander email (cuenta corriente: transferencias + pagos) ---"
  npx tsx scripts/bank-bot/load-email-santander.ts 3
  RC_SAN=$?
  echo "exit santander-email: $RC_SAN"

  # Solo marcamos el dia como exitoso si ambos corrieron sin error
  if [ "$RC_EDW" = "0" ] && [ "$RC_SAN" = "0" ]; then touch "$STAMP"; fi
  echo "=== fin $(date) ==="
} >> "$LOG" 2>&1
