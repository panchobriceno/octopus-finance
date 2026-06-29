#!/usr/bin/env python3
"""
Lector IMAP de Gmail para el bank-bot. Lee la app password del Keychain (no en texto plano).
Prueba: lista los correos de Edwards (enviodigital@bancoedwards.cl).

Uso:  python3 scripts/bank-bot/read_gmail.py
"""
import imaplib
import subprocess
import sys

ACCT = "panchoesteban.br@gmail.com"
KEYCHAIN_SERVICE = "octopus-finance-gmail-edwards"
SENDER = "enviodigital@bancoedwards.cl"


def keychain(service):
    r = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-w"],
        capture_output=True, text=True,
    )
    return r.stdout.strip()


def main():
    pw = keychain(KEYCHAIN_SERVICE)
    if not pw:
        print("ERROR: no se pudo leer la app password del Keychain")
        sys.exit(1)

    try:
        M = imaplib.IMAP4_SSL("imap.gmail.com")
        M.login(ACCT, pw)
    except imaplib.IMAP4.error as e:
        print(f"ERROR de login IMAP: {e}")
        print(">> Suele ser la app password con espacios o mal pegada. Regenerala/guardala SIN espacios.")
        sys.exit(2)

    print(f"OK login: {ACCT}")
    M.select("INBOX", readonly=True)
    typ, data = M.search(None, "FROM", SENDER)
    ids = data[0].split() if data and data[0] else []
    print(f"Correos de Edwards en INBOX: {len(ids)}")

    for i in ids[-5:]:
        typ, md = M.fetch(i, "(BODY.PEEK[HEADER.FIELDS (SUBJECT DATE)])")
        hdr = md[0][1].decode(errors="replace").strip().replace("\r\n", " ")
        print("  -", hdr)

    M.logout()


if __name__ == "__main__":
    main()
