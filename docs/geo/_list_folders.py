# -*- coding: utf-8 -*-
"""List IMAP folders of 163 mailbox."""
import json, imaplib

cfg = json.load(open(r"C:\Users\Zhang\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.user_skills\mail-163\scripts\config.json", encoding="utf-8"))
acc = cfg["accounts"][cfg.get("default_account", "163")]
c = imaplib.IMAP4_SSL(acc["imap_host"], acc["imap_port"])
c.login(acc["email"], acc["auth_code"])
# send IMAP ID via raw command (imaplib has no built-in)
typ, dat = c._simple_command("ID", '("name" "doubao-agent" "version" "1.0")')
c._untagged_response(typ, dat, "ID")
status, folders = c.list()
for f in folders:
    print(f.decode(errors="replace"))
