# SBMS0 – Electrodacus Solar/BMS Monitoring-Stack

Automation & Monitoring für Electrodacus SBMS0 Komponenten.

## System

| Komponente | Wert |
|---|---|
| **Batterie** | **280 Ah / 24 V** (8s LiFePO4, ~6,72 kWh) |
| Logger | `sbms0-LiveLogger.py` – 1 Datapoint/Sekunde → InfluxDB 1.8 |
| Datenbank | InfluxDB, DB `SBMS`, RP `raw_1s` (365d, DEFAULT) + `downsampled_1m` |
| Visualisierung | **SBMS0 Live-Web** (Port 8090) – Grafana ist als Rückfallebene installiert, aber schlafend |

## Live-Web (eigene Kiosk-App)

| URL | Seite | Inhalt |
|---|---|---|
| `/` | START | Steuerzentrale mit Kacheln (Touch-Launcher) |
| `/live` | LIVE | 1-s-Aktualisierung: SOC, Leistung, Akku, 8 Zellbalken, Cell-Delta-Gauge, Flags, Today-Verlauf |
| `/calc` | BERECHNUNGEN | Today: Energy (kWh), Energy flow, Prognosen (Time to full/empty), Battery Levels, Cell-Verlauf |
| `/hist` | HISTORIE | Zeitraum frei wählbar (24 h–1 a, Default 30 d): Verläufe, Energie-Statistik, Zell-Minima, Cell-Delta |

- Technologie: Flask (Port 8090) + Influx-Query-Proxy + Vanilla-JS + uPlot
- Farben/Thresholds 1:1 aus den ehemaligen Grafana-Dashboards übernommen
- Die ehemaligen Grafana-Dashboard-JSONs liegen gesichert im Repo `mojomaxmojo/SBMS0`

## Performance (Wyse 3040, 2 GB RAM)

- Load wurde von ~9 auf ~0.2–0.5 gedrückt durch: Cells-Delta-Query (`last()`, 5-s-Fenster statt 1m-Gruppierung über 600 Rohpunkte), 5-s-Refresh, Chromium-Kiosk-Neustart.
- **Entscheidend: Grafana schlafen gelegt** (`systemctl disable --now grafana-server`) → ~700 MB RAM frei, Swap dauerhaft 0 statt 163 MB voll, Load dauerhaft < 1.
- Bei RAM-/Load-Anstieg über Tage: nächtlichen Reboot-Cron einplanen (z. B. `0 4 * * * /sbin/reboot`).
- Optional (noch nicht umgesetzt): Logger schreibt nur bei neuen Serial-Daten; Terminal-Render throtteln; `raw_1s`-Retention 365d → 60d (Verläufe laufen über `downsampled_1m`).

## Wichtige Berechnungs-Formeln (BERECHNUNGEN-Seite)

- Energie: `sum(<Power W>) / 3600 / 1000` → kWh (bei 1 Hz-Daten)
- Time to full: `280 × (100 − SOC)/100 ÷ Ladestrom(A) × 60` → Minuten
- Time to empty: `280 × SOC/100 ÷ Entladestrom(A) × 60` → Minuten
- Kapazität **280 Ah** ist in den Time-to-Queries hart hinterlegt (6 Stellen).

## Dienste

| Unit | Beschreibung |
|---|---|
| `SBMS-LiveLogger.service` | 1-Hz-Logger → InfluxDB (+ eigene 1-Min-Mittelwerte) — **DietPi-Standard, User `dietpi`** |
| `SBMS-Logger.service` | Legacy-Logger `sbms0-SerialToInfluxDB.py` (nur Pi-Installer, User `pi`) |

## Ziel-System

Primäres Zielsystem ist **DietPi (Debian Trixie) auf Dell Wyse 3040** — `install_dietpi.sh` deckt alles ab (Pakete, DB, Retention, Downsampling, Dienst, Grafana-Config inkl. 1-s-Refresh-Freischaltung). Die Pi-Installer sind nur Fallback für Raspberry-Pi-Hardware.

## Kiosk-Setup (DietPi / Dell Wyse 3040 Touchscreen)

- **Autostart:** `dietpi-autostart` → Option 11 „Chromium – Dedicated use without desktop"; URL-Abfrage schreibt `SOFTWARE_CHROMIUM_AUTOSTART_URL` in `/boot/dietpi.txt`.
- **Auflösung:** `SOFTWARE_CHROMIUM_RES_X/Y` in `/boot/dietpi.txt` (hier 1920×1200).
- **Chromium-Flags:** `/var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh` → `CHROMIUM_OPTS` um `--no-first-run --no-default-browser-check --disable-component-update --disable-infobars --disable-session-crashed-bubble --disable-features=Translate` ergänzt (kein `--disable-gpu`!). Wird ggf. von DietPi-Updates überschrieben → Flags bei Bedarf erneut setzen.
- **Git-Permissions:** Falls `git pull` als `dietpi` mit „insufficient permission" fehlschlägt: `sudo chown -R dietpi:dietpi /home/SBMS0` (einmalig; Ursache sind vorherige Root-Write-Zugriffe in `.git/objects`).

## Update-Ablauf (Live-Web-Änderungen)

```bash
cd /home/SBMS0 && git pull && sudo python3 install_liveweb.py
sudo systemctl restart SBMS-LiveWeb
```
Anschließend im Browser/Kiosk neu laden (Shift+F5 bzw. Kiosk-Neustart).

## Live-Web (eigene Kiosk-App, Ersatz für Grafana im Kiosk)

- **Port 8090** (8088 ist InfluxDB-RPC): `http://<dietpi-ip>:8090`
  - `/` = LIVE, `/calc` = BERECHNUNGEN, `/hist` = HISTORIE (Zeitraum frei wählbar, Default 30 d)
- **Installieren/Aktualisieren:**
  ```bash
  cd /home/SBMS0 && git pull && sudo python3 install_liveweb.py
  sudo systemctl restart SBMS-LiveWeb
  ```
- **Dienst:** `SBMS-LiveWeb.service` (User `dietpi`, Flask + Influx-Query-Proxy)
- **Grafana schlafen legen** (nicht deinstallieren – bleibt als Rückfallebene):
  ```bash
  sudo systemctl disable --now grafana-server   # aus + deaktiviert
  sudo systemctl enable --now grafana-server    # wieder aktivieren
  ```
- **Kiosk-URL** (in `/boot/dietpi.txt`, `SOFTWARE_CHROMIUM_AUTOSTART_URL`): `http://localhost:8090`
