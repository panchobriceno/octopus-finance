#!/usr/bin/env python3
"""
Lector IMAP de Gmail para el bank-bot. Lee la app password del Keychain (no en texto plano).

Modos:
  list                       -> lista correos de Edwards (prueba)
  extract [dias]             -> imprime JSON [{date, subject, body}] de compras Edwards
                                de los ultimos N dias (default 7). Lo consume el loader TS.

Uso:  python3 scripts/bank-bot/read_gmail.py list
      python3 scripts/bank-bot/read_gmail.py extract 7
"""
import email
import html as html_lib
import imaplib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from email.header import decode_header

ACCT = "panchoesteban.br@gmail.com"
KEYCHAIN_SERVICE = "octopus-finance-gmail-edwards"
SENDER = "enviodigital@bancoedwards.cl"


def keychain(service):
    r = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-w"],
        capture_output=True, text=True,
    )
    return r.stdout.strip()


def connect():
    pw = keychain(KEYCHAIN_SERVICE)
    if not pw:
        print("ERROR: no se pudo leer la app password del Keychain", file=sys.stderr)
        sys.exit(1)
    M = imaplib.IMAP4_SSL("imap.gmail.com")
    M.login(ACCT, pw)
    M.select("INBOX", readonly=True)
    return M


def decode_hdr(raw):
    out = []
    for part, enc in decode_header(raw or ""):
        out.append(part.decode(enc or "utf-8", errors="replace") if isinstance(part, bytes) else part)
    return "".join(out)


def strip_html(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html_lib.unescape(h)).strip()


def plaintext(msg):
    parts = list(msg.walk()) if msg.is_multipart() else [msg]
    for part in parts:
        if part.get_content_type() == "text/plain":
            return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="replace")
    for part in parts:
        if part.get_content_type() == "text/html":
            raw = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="replace")
            return strip_html(raw)
    return ""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "list"
    M = connect()

    if mode == "list":
        typ, data = M.search(None, "FROM", SENDER)
        ids = data[0].split() if data and data[0] else []
        print(f"OK login {ACCT} | correos Edwards: {len(ids)}", file=sys.stderr)
        for i in ids[-5:]:
            typ, md = M.fetch(i, "(BODY.PEEK[HEADER.FIELDS (SUBJECT DATE)])")
            print("  -", md[0][1].decode(errors="replace").strip().replace("\r\n", " "), file=sys.stderr)
        M.logout()
        return

    if mode == "extract":
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
        since = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
        typ, data = M.search(None, "FROM", SENDER, "SINCE", since)
        ids = data[0].split() if data and data[0] else []
        out = []
        for i in ids:
            typ, md = M.fetch(i, "(RFC822)")
            msg = email.message_from_bytes(md[0][1])
            subject = decode_hdr(msg.get("Subject"))
            if "compra con tarjeta" not in subject.lower():
                continue
            out.append({
                "date": decode_hdr(msg.get("Date")),
                "subject": subject,
                "body": plaintext(msg),
            })
        M.logout()
        print(f"Extraidos {len(out)} correos Edwards desde {since}", file=sys.stderr)
        print(json.dumps(out, ensure_ascii=False))
        return


if __name__ == "__main__":
    main()
