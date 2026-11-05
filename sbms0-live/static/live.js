/* SBMS0 Live-Web – 1s-Polling über /query-Proxy */
'use strict';

const Q_LAST =
  "SELECT last(\"State of Charge\") AS SOC, last(\"Battery Voltage\") AS Vbat, " +
  "last(\"Battery Current\") AS Ibat, last(\"PV Total Current\") AS IPV, " +
  "last(\"External Load\") AS Iload, last(\"Cell Delta\") AS delta, " +
  "last(\"Internal Temperature\") AS Tint, last(\"External Temperature\") AS Text, " +
  "last(\"Monitor Flags DE\") AS flags, last(\"Error Code\") AS errcode, " +
  "last(\"Error Active\") AS erractive " +
  "FROM \"raw_1s\".\"SBMS_Metrics\" WHERE \"Name\" = 'SBMS0a' AND time > now() - 30s";

const Q_CELLS =
  "SELECT last(\"Cell 1\") AS c1, last(\"Cell 2\") AS c2, last(\"Cell 3\") AS c3, " +
  "last(\"Cell 4\") AS c4, last(\"Cell 5\") AS c5, last(\"Cell 6\") AS c6, " +
  "last(\"Cell 7\") AS c7, last(\"Cell 8\") AS c8 " +
  "FROM \"raw_1s\".\"SBMS_Metrics\" WHERE \"Name\" = 'SBMS0a' AND time > now() - 30s";

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (v == null ? '–' : Number(v).toFixed(d));

function extract(res) {
  // Influx-1.8-Antwort: {results:[{series:[{columns:[],values:[[...]]}]}]}
  try {
    const s = res.results?.[0]?.series?.[0];
    if (!s || !s.values || !s.values.length) return null;
    const row = {};
    s.columns.forEach((c, i) => { row[c] = s.values[0][i]; });
    return row;
  } catch (e) { return null; }
}

async function fetchQ(q) {
  const r = await fetch('/query?q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return extract(await r.json());
}

// Farben exakt wie Grafana-Thresholds (SBMS-Dash-LIVE.json)
function socColor(soc) {
  // 0 dark-red, 10 light-red, 20 super-light-orange, 30 super-light-green,
  // 40 green, 80 semi-dark-green, 100 dark-green
  if (soc <= 10) return soc <= 5 ? '#5c1a1a' : '#f2495c';   // dark-red / light-red
  if (soc <= 20) return '#ffb357';                           // super-light-orange
  if (soc <= 30) return '#96d98d';                           // super-light-green
  if (soc <= 80) return soc <= 40 ? '#73bf69' : '#56a64b';   // green / semi-dark-green
  return '#37926c';                                          // dark-green
}

function cellColor(v) {
  // 0 dark-red, 2.8 light-yellow, 3.0 green, 3.2 dark-green, 3.65 dark-red
  if (v < 2.8) return v < 2.5 ? '#5c1a1a' : '#f2495c';
  if (v < 3.0) return '#f2cc0c';
  if (v <= 3.2) return '#73bf69';
  if (v <= 3.65) return '#37872d';
  return '#5c1a1a';
}

let firstRender = true;

function renderCells(cells) {
  const box = $('cells');
  if (firstRender) {
    // Zeilen einmalig anlegen – danach nur Werte/Breiten updaten (spart Rendern)
    box.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
      const row = document.createElement('div');
      row.className = 'cell-row';
      row.innerHTML =
        `<span class="cname">Cell ${i}</span>` +
        `<div class="cbar"><div class="cfill" id="cf${i}"></div></div>` +
        `<span class="cval" id="cv${i}">–</span>`;
      box.appendChild(row);
    }
  }
  for (let i = 1; i <= 8; i++) {
    const v = cells ? cells['c' + i] : null;
    const fill = $('cf' + i), val = $('cv' + i);
    if (v == null) { val.textContent = '–'; continue; }
    const pct = Math.max(0, Math.min(100, ((v - 2.5) / (3.8 - 2.5)) * 100));
    fill.style.width = pct.toFixed(1) + '%';
    fill.style.background = cellColor(v);
    val.textContent = v.toFixed(3) + ' V';
  }
}

function update(row, cells) {
  const err = !row;
  $('status').textContent = err ? 'KEINE DATEN / Influx unerreichbar' : 'Daten OK';
  $('status').classList.toggle('err', err);
  if (!row) return;

  // Clock
  $('clock').textContent = new Date().toLocaleTimeString('de-DE');

  // SOC
  const soc = Number(row.SOC);
  $('soc-fill').style.width = soc.toFixed(1) + '%';
  $('soc-fill').style.background = socColor(soc);
  $('soc-label').textContent = soc.toFixed(0) + ' %';

  // Leistungen (W)
  const vbat = Number(row.Vbat);
  const ibat = Number(row.Ibat), ipv = Number(row.IPV), ilo = Number(row.Iload);
  const pBat = ibat * vbat, pPv = ipv * vbat, pLoad = (ipv - ibat) * vbat;
  $('p-pv').textContent = fmt(pPv, 0) + ' W';
  $('p-pv').style.color = pPv > 0 ? 'var(--green)' : 'var(--txt)';
  $('p-bat').textContent = (pBat >= 0 ? '+' : '') + fmt(pBat, 0) + ' W';
  $('p-bat').style.color = pBat > 0 ? 'var(--blue)' : (pBat < 0 ? 'var(--orange)' : 'var(--txt)');
  $('p-load').textContent = fmt(pLoad, 0) + ' W';
  $('p-load').style.color = 'var(--orange)';
  $('p-currents').textContent =
    `PV ${fmt(ipv, 2)} A · Batt ${fmt(ibat, 2)} A · Last ${fmt(ilo, 2)} A`;

  // Akku
  $('v-bat').firstChild.textContent = fmt(vbat);
  $('v-current').textContent = ibat > 0.05 ? '▲ lädt (' + fmt(ibat) + ' A)'
    : ibat < -0.05 ? '▼ entlädt (' + fmt(-ibat) + ' A)' : '⏸ Ruhe';
  $('v-temp').textContent = `Int ${fmt(row.Tint, 1)} °C · Ext ${fmt(row.Text, 1)} °C`;

  // Zellen + Delta
  renderCells(cells);
  const dmv = row.delta == null ? null : Number(row.delta) * 1000;
  $('delta-value').textContent = dmv == null ? '–' : dmv.toFixed(1) + ' mV';
  $('delta-value').style.color = dmv == null ? 'var(--txt)'
    : dmv <= 20 ? 'var(--green)' : dmv <= 50 ? 'var(--orange)' : 'var(--red)';

  // Balancing-Hinweis: ECCF-Flag
  const balancing = String(row.flags || '').includes('ECCF');
  $('balancing').style.display = balancing ? 'inline' : 'none';

  // Flags
  const flags = String(row.flags || '') || '(keine)';
  const activeErr = Number(row.erractive) > 0;
  $('flags-de').textContent = activeErr
    ? `⚠ FEHLER ${row.errcode}: ${flags}` : flags;
  $('flags-de').classList.toggle('err', activeErr);
}

async function tick() {
  try {
    const [row, cells] = await Promise.all([fetchQ(Q_LAST), fetchQ(Q_CELLS)]);
    update(row, cells);
    firstRender = false;
  } catch (e) {
    $('status').textContent = 'FEHLER: ' + e.message;
    $('status').classList.add('err');
  }
}

tick();
setInterval(tick, 1000);
