#!/usr/bin/env python3
"""Vydá už nahraté AAB (podľa versionCode) do zvolenej stopy Google Play.

Použitie: play-release.py <stopa> <versionCode> <verzia>
  stopa: production | beta | alpha | internal
Servisný účet: JSON v premennej PLAY_JSON (secret PLAY_SERVICE_ACCOUNT_JSON).
AAB sa nenahráva znova — v Play už je z interného testovania (rovnaký versionCode).
Poznámky „Čo je nové“ (sk, max. 500 znakov) z releases/CHANGELOG.txt.
Ak Play vydanie neprijme ako hotové (appka ešte nie je zverejnená), uloží ho
ako koncept a skončí chybou s vysvetlením — nič sa nezverejní potichu.
"""
import json
import os
import re
import sys

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

PKG = 'sk.operatorsystem.mhdpresov'
API = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}/edits'


class PlayError(Exception):
    pass


def whatsnew(version):
    try:
        txt = open('releases/CHANGELOG.txt', encoding='utf-8').read()
    except OSError:
        return f'Verzia {version}.'
    m = re.search(r'^v' + re.escape(version) + r'\b.*?\n-+\n(.*?)(?=\n-{10,}\nv\d|\Z)', txt, re.S | re.M)
    body = m.group(1).strip() if m else f'Verzia {version}.'
    body = re.sub(r'[ \t]*\n[ \t]+', ' ', body)
    body = re.sub(r'\n{2,}', '\n', body).strip()
    if len(body) > 500:
        body = body[:497].rsplit(' ', 1)[0] + '…'
    return body


def main():
    track, code, version = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    info = json.loads(os.environ['PLAY_JSON'])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/androidpublisher'])
    creds.refresh(Request())
    H = {'Authorization': f'Bearer {creds.token}'}

    def call(method, url, **kw):
        r = requests.request(method, url, headers=H, timeout=60, **kw)
        if not r.ok:
            raise PlayError(f'{method} {url.split("/edits")[-1] or "/edits"}: {r.status_code} {r.text[:600]}')
        return r.json() if r.text.strip() else {}

    notes = whatsnew(version)
    print(f'{track}: verzia {version}, versionCode {code}\nČo je nové:\n{notes}\n')

    def release(status, not_for_review=False):
        edit = call('POST', API)['id']
        try:
            call('PUT', f'{API}/{edit}/tracks/{track}', json={'track': track, 'releases': [{
                'name': version, 'versionCodes': [str(code)], 'status': status,
                'releaseNotes': [{'language': 'sk', 'text': notes}],
            }]})
            q = '?changesNotSentForReview=true' if not_for_review else ''
            call('POST', f'{API}/{edit}:commit{q}')
        except PlayError:
            requests.delete(f'{API}/{edit}', headers=H, timeout=60)
            raise

    try:
        release('completed')
        print(f'✓ Vydanie {version} je v stope „{track}“ a ide na kontrolu Google.')
        return
    except PlayError as e:
        msg = str(e)
        print(f'Play odmietol hotové vydanie: {msg}')
    if 'changesNotSentForReview' in msg:
        # v Play Console je zapnuté „Spravované zverejňovanie“ alebo čakajú iné zmeny
        release('completed', not_for_review=True)
        print(f'✓ Vydanie {version} je pripravené v stope „{track}“ — na kontrolu ho treba odoslať v Play Console (Prehľad zverejnenia).')
        return
    if 'draft' in msg.lower():
        release('draft')
        print(f'::warning::Appka ešte nie je zverejnená — vydanie {version} je v stope „{track}“ uložené ako KONCEPT. '
              'Prvé vydanie do produkcie treba odoslať na kontrolu ručne v Play Console.')
        sys.exit(1)
    sys.exit(f'::error::{msg}')


if __name__ == '__main__':
    main()
