#!/usr/bin/env python3
"""
SBMS0 Live-Web – Install-Helper (DietPi)
========================================
- installiert flask (falls fehlt)
- kopiert sbms0-live/ nach /home/SBMS0/sbms0-live
- installiert + aktiviert systemd-Dienst SBMS-LiveWeb
Idempotent – kann mehrfach ausgeführt werden.

Aufruf: sudo python3 install_liveweb.py
"""

import os
import shutil
import subprocess
import sys

SRC = os.path.dirname(os.path.abspath(__file__))
DST = '/home/SBMS0/sbms0-live'
UNIT_SRC = os.path.join(SRC, 'SBMS-LiveWeb.service')
UNIT_DST = '/etc/systemd/system/SBMS-LiveWeb.service'


def run(cmd, **kw):
    print('  $', ' '.join(cmd))
    return subprocess.run(cmd, check=False, **kw).returncode


def main():
    if os.geteuid() != 0:
        sys.exit('Bitte mit sudo ausführen.')

    print('== 1/4 flask prüfen/installieren ==')
    if run(['python3', '-c', 'import flask']) != 0:
        run([sys.executable, '-m', 'pip', 'install', 'flask'])

    print('== 2/4 Dateien nach %s == ' % DST)
    os.makedirs(DST, exist_ok=True)
    for item in ('app.py', 'static', 'templates'):
        src = os.path.join(SRC, item)
        dst = os.path.join(DST, item)
        if os.path.isdir(src):
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    run(['chown', '-R', 'dietpi:dietpi', DST])

    print('== 3/4 systemd-Dienst ==')
    shutil.copy2(UNIT_SRC, UNIT_DST)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'SBMS-LiveWeb'])

    print('== 4/4 Selbsttest ==')
    import time
    time.sleep(2)
    rc = run(['curl', '-sf', 'http://localhost:8088/health'])
    if rc == 0:
        print('\nOK  ->  Live-Web läuft auf http://<dietpi-ip>:8088')
        print('     Kiosk-URL (dietpi.txt): http://localhost:8088')
    else:
        print('\nWARNUNG: /health nicht erreichbar – Logs mit:')
        print('  journalctl -u SBMS-LiveWeb -n 30')


if __name__ == '__main__':
    main()
