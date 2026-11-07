#!/usr/bin/env python3
"""
Draft sign-in emails for client account managers (CAMs), as .eml files that open unsent in a mail app, like rep_email_drafts.

  python3 scripts/make-cam-email-drafts.py --csv ~/Downloads/cam-logins.csv --cams cams.json --out email-templates/cam_email_drafts

  --csv   the file scripts/cam-logins.mjs --generate wrote: name, email, one_time_password, reps
  --cams  the JSON from GET <service>/admin/cams (the CAMs and their reps); used for the "Your reps" list. Optional: without it the
          email says the reps will show on the first screen after sign-in.
  --out   where the drafts go. They hold real passwords, so this must be a folder git ignores; the script refuses otherwise.
  --link  the dashboard address (default https://vw-rca.vercel.app)
  --preview-to  also write 00_preview_to_me.eml to this address, with a sample password

The wording lives in email-templates/cam_email.txt and cam_email.html (placeholders only, safe to commit). Standard library only.
Passwords are never printed.
"""
import argparse
import csv
import html as H
import json
import re
import subprocess
import sys
import unicodedata
from email.message import EmailMessage
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SUBJECT = "Your Sales KPI dashboard login is ready"
SAMPLE_PASSWORD = "k7Qm-xT4p-Wn8c"


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"\([^)]*\)", "", s)  # "Jessica Falvo (Gold)" -> "Jessica Falvo"
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "cam"


def first_name(name: str) -> str:
    return re.sub(r"\([^)]*\)", "", name).split()[0] if name.split() else "there"


def reps_blocks(reps):
    """[(team lead, [rep names])] sorted by team lead; reps is a list of {name, teamLead}."""
    by = {}
    for r in reps or []:
        by.setdefault(r.get("teamLead") or "Other", []).append(r["name"])
    return sorted((k, sorted(v)) for k, v in by.items())


def reps_text(reps):
    if not reps:
        return "  Your reps will show on the first screen after you sign in."
    return "\n".join(f"  {', '.join(names)}  ({lead}'s team)" if lead != "Other" else f"  {', '.join(names)}" for lead, names in reps_blocks(reps))


def reps_html(reps):
    if not reps:
        return '<p style="margin:0;font-size:15px;line-height:1.55;color:#374151;">Your reps will show on the first screen after you sign in.</p>'
    rows = []
    for lead, names in reps_blocks(reps):
        who = ", ".join(H.escape(n) for n in names)
        tail = f' <span style="color:#6b7280;">({H.escape(lead)}\'s team)</span>' if lead != "Other" else ""
        rows.append(f'<p style="margin:0 0 4px 0;font-size:15px;line-height:1.55;color:#111827;"><b>{who}</b>{tail}</p>')
    return "\n              ".join(rows)


def fill(tpl: str, values: dict, escape: bool) -> str:
    def val(k):
        v = values[k]
        return v if k in ("REPS_HTML", "REPS_TEXT") or not escape else H.escape(v)
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: val(m.group(1)), tpl)


def build(to: str, subject: str, values: dict, txt_tpl: str, html_tpl: str) -> bytes:
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg["X-Unsent"] = "1"  # opens as an unsent draft in Outlook / Apple Mail
    msg.set_content(fill(txt_tpl, values, escape=False), subtype="plain", charset="utf-8", cte="quoted-printable")
    msg.add_alternative(fill(html_tpl, values, escape=True), subtype="html", charset="utf-8", cte="quoted-printable")
    return bytes(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--cams")
    ap.add_argument("--out", required=True)
    ap.add_argument("--link", default="https://vw-rca.vercel.app")
    ap.add_argument("--preview-to")
    a = ap.parse_args()

    out = Path(a.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    # The drafts hold real passwords: never write them anywhere git would commit.
    ignored = subprocess.run(["git", "-C", str(out), "check-ignore", "-q", str(out / "x.eml")], capture_output=True).returncode == 0
    if not ignored:
        sys.exit(f"Refusing to write: {out} is not ignored by git, and these drafts contain passwords. Add it to .git/info/exclude first.")

    txt_tpl = (HERE / "email-templates" / "cam_email.txt").read_text()
    html_tpl = (HERE / "email-templates" / "cam_email.html").read_text()
    reps_by_email = {}
    if a.cams:
        for c in json.load(open(Path(a.cams).expanduser()))["cams"]:
            reps_by_email[(c.get("email") or "").lower()] = c.get("reps", [])

    rows = list(csv.DictReader(open(Path(a.csv).expanduser())))
    made, no_reps = 0, []
    for r in rows:
        email, name, pw = r["email"].strip().lower(), r["name"].strip(), r["one_time_password"].strip()
        if not (email and pw):
            continue
        reps = reps_by_email.get(email)
        if a.cams and not reps:
            no_reps.append(name)
        v = {"FIRST_NAME": first_name(name), "EMAIL": email, "PASSWORD": pw, "LINK": a.link, "REPS_HTML": reps_html(reps), "REPS_TEXT": reps_text(reps)}
        (out / f"{slug(name)}.eml").write_bytes(build(email, SUBJECT, v, txt_tpl, html_tpl))
        made += 1

    if a.preview_to and rows:
        r = rows[0]
        email = r["email"].strip().lower()
        reps = reps_by_email.get(email)
        v = {"FIRST_NAME": first_name(r["name"]), "EMAIL": email, "PASSWORD": SAMPLE_PASSWORD, "LINK": a.link, "REPS_HTML": reps_html(reps), "REPS_TEXT": reps_text(reps)}
        (out / "00_preview_to_me.eml").write_bytes(build(a.preview_to, "[Preview] " + SUBJECT, v, txt_tpl, html_tpl))
    print(f"{made} drafts in {out}" + (" (+ preview)" if a.preview_to else ""))
    if no_reps:
        print("No reps found in Cube for: " + ", ".join(no_reps) + " (their email says reps show after sign-in)")


if __name__ == "__main__":
    main()
