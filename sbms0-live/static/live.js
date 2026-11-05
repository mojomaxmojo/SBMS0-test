/* SBMS0 Live-Web – Grafana-Look: LED-Bargauges, Stats, Gauge, uPlot-Chart */
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

// Today-Chart: 1-Min-Mittelwerte aus downsampled_1m (wie Grafana-Panel)
const Q_TODAY =
  "SELECT mean(\"Battery Power W\") AS bat, mean(\"PV Power W\") AS pv, " +
  "mean(\"Consumption Power W\") AS cons " +
  "FROM \"downsampled_1m\".\"SBMS_Metrics\" WHERE \"Name\" = 'SBMS0a' AND time > now() - 24h " +
  "GROUP BY time(1m) fill(null)";

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (v == null ? '–' : Number(v).toFixed(d));

/* ---------- Farblogik: Grafana-Thresholds ---------- */
const SOC_STOPS = [
  [0, [0x66, 0x0e, 0x0e]],   // dark-red
  [10, [0xf2, 0x49, 0x5c]],  // light-red
  [20, [0xff, 0xb3, 0x57]],  // super-light-orange
  [30, [0x96, 0xd9, 0x8d]],  // super-light-green
  [40, [0x73, 0xbf, 0x69]],  // green
  [80, [0x56, 0xa6, 0x4b]],  // semi-dark-green
  [100, [0x37, 0x92, 0x6c]], // dark-green
];

const CELL_STOPS = [
  [2.8, [0xf2, 0xcc, 0x0c]],  // yellow
  [3.0, [0x96, 0xd9, 0x8d]],  // light-green
  [3.2, [0x73, 0xbf, 0x69]],  // green
  [3.65, [0xf2, 0x49, 0x5c]], // red
];
const CELL_BASE = [0xf2, 0x49, 0x5c]; // Base: rot – unter 2.8 V solid rot (auch < 2.5 V)

function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
      const t = (v - v0) / (v1 - v0);
      return c0.map((c, j) => Math.round(c + t * (c1[j] - c)));
    }
  }
  return stops[stops.length - 1][1];
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const dim = (c, f = 0.28) => c.map((x) => Math.round(x * f + 0x22 * (1 - f)));
const cellColorRaw = (v) => (v < 2.8 ? CELL_BASE : ramp(CELL_STOPS, v));
const cellColor = (v) => rgb(cellColorRaw(v));

/* ---------- LED-Bargauge ---------- */
function buildLedBar(el, n, min, max, stops) {
  el.innerHTML = '';
  const leds = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'led';
    const v = min + (i + 0.5) * (max - min) / n;
    const c = ramp(stops, v);
    d.style.background = rgb(dim(c));
    el.appendChild(d);
    leds.push(d);
  }
  return leds;
}

function setLedBar(leds, min, max, stops, value, colorFn) {
  if (value == null) return;
  const cfn = colorFn || ((v) => ramp(stops, v));
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const on = Math.round(frac * leds.length);
  for (let i = 0; i < leds.length; i++) {
    // Farbe immer aus der Gradient-Skala (wie Grafana-LED-Bargauge):
    // gefüllte Segmente hell, ungefüllte nur abgedunkelt
    const c = cfn(min + (i + 0.5) * (max - min) / leds.length);
    if (i < on) {
      leds[i].classList.add('on');
      leds[i].style.background = rgb(c);
    } else {
      leds[i].classList.remove('on');
      leds[i].style.background = rgb(dim(c));
    }
  }
}

const SOC_LEDS = buildLedBar($('soc-bar'), 100, 0, 100, SOC_STOPS);
const CELL_LEDS = [];
for (let i = 1; i <= 8; i++) {
  const row = document.createElement('div');
  row.className = 'cell-row';
  row.innerHTML =
    `<span class="cname">Cell ${i}</span>` +
    `<div class="ledbar"></div>` +
    `<span class="cval">–</span>`;
  $('cells').appendChild(row);
  CELL_LEDS.push({
    leds: buildLedBar(row.querySelector('.ledbar'), 60, 2.5, 3.8, CELL_STOPS),
    val: row.querySelector('.cval'),
  });
}

/* ---------- Delta-Gauge (SVG-Arc) ---------- */
const GAUGE_MAX = 100; // mV
function buildGauge() {
  const size = 150, cx = size / 2, cy = size / 2, r = size / 2 - 8;
  const start = 135, sweep = 270; // Grad
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = `
    <path id="g-bg" fill="none" stroke="#22252b" stroke-width="12"
      stroke-linecap="round"/>
    <path id="g-fill" fill="none" stroke="${'var(--green)'}" stroke-width="12"
      stroke-linecap="round"/>
    <text x="50%" y="52%" text-anchor="middle" id="g-val">–</text>
    <text x="50%" y="66%" text-anchor="middle" class="gunit">mV</text>`;
  const arc = (deg) => {
    const a0 = (start * Math.PI) / 180;
    const a1 = ((start + deg) * Math.PI) / 180;
    const large = deg > 180 ? 1 : 0;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} ` +
      `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };
  svg.querySelector('#g-bg').setAttribute('d', arc(sweep));
  $('gauge').appendChild(svg);
  return {
    set(mv) {
      const fill = svg.querySelector('#g-fill'), val = svg.querySelector('#g-val');
      if (mv == null) { val.textContent = '–'; fill.setAttribute('d', ''); return; }
      const frac = Math.max(0, Math.min(1, mv / GAUGE_MAX));
      fill.setAttribute('d', frac < 0.005 ? '' : arc(frac * sweep));
      fill.setAttribute('stroke', mv <= 20 ? 'var(--green)' : mv <= 50 ? 'var(--orange)' : 'var(--red)');
      val.textContent = mv.toFixed(0);
    },
  };
}
const gauge = buildGauge();

/* ---------- Heute-Chart (uPlot) ---------- */
let uplot = null;
async function updateChart() {
  let res;
  try {
    const r = await fetch('/query?q=' + encodeURIComponent(Q_TODAY));
    res = await r.json();
  } catch (e) { return; }
  const s = res?.results?.[0]?.series?.[0];
  if (!s) return;
  const data = [[], [], [], []]; // time, bat, pv, cons
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Math.round(v[1]));
    data[2].push(v[2] == null ? null : Math.round(v[2]));
    data[3].push(v[3] == null ? null : Math.round(v[3]));
  }
  const opts = {
    width: $('powerchart').clientWidth,
    height: 300,
    legend: { show: false },   // eigene Legende (Min/Max/Last) darunter
    scales: { x: { time: true } },
    series: [
      {},
      { label: 'Battery Power', stroke: '#5794f2', width: 1.5, fill: 'rgba(87,148,242,0.15)', spanGaps: true },
      { label: 'PV Power', stroke: '#73bf69', width: 1.5, fill: 'rgba(115,191,105,0.12)', spanGaps: true },
      { label: 'Load Power', stroke: '#ff9830', width: 1.5, fill: 'rgba(255,152,48,0.10)', spanGaps: true },
    ],
    axes: [
      { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' } },
      { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
        values: (u, vals) => vals.map((v) => (v >= 1000 ? (v / 1000).toFixed(1) + ' kW' : v + ' W')) },
    ],
  };
  if (!uplot) {
    uplot = new uPlot(opts, data, $('powerchart'));
  } else {
    uplot.setData(data);
  }
  renderLegend(data, s.columns);
}

// Grafana-Legende: Name | Min | Max | Last (unterm Chart)
function fmtW(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + ' kW';
  return v.toFixed(2) + ' W';
}

function renderLegend(data, columns) {
  const labels = ['Battery Power', 'PV Power', 'Load Power'];
  const colors = ['#5794f2', '#73bf69', '#ff9830'];
  let html = '<table class="legend-table"><tr><th>Name</th><th>Min</th><th>Max</th><th>Last*</th></tr>';
  for (let i = 1; i <= 3; i++) {
    const vals = data[i].filter((v) => v != null);
    const min = vals.length ? Math.min(...vals) : null;
    const max = vals.length ? Math.max(...vals) : null;
    let last = null;
    for (let j = data[i].length - 1; j >= 0; j--) {
      if (data[i][j] != null) { last = data[i][j]; break; }
    }
    html += `<tr>
      <td><span class="lg-dot" style="background:${colors[i - 1]}"></span>${labels[i - 1]}</td>
      <td>${fmtW(min)}</td><td>${fmtW(max)}</td><td>${fmtW(last)}</td></tr>`;
  }
  html += '</table>';
  $('legend').innerHTML = html;
}
// Chart nur alle 60 s aktualisieren (1-Min-Daten!)
updateChart();
setInterval(updateChart, 60000);
window.addEventListener('resize', () => uplot && uplot.setSize({ width: $('powerchart').clientWidth, height: 300 }));

/* ---------- 1s-Tick: Live-Werte ---------- */
function extract(res) {
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

function update(row, cells) {
  if (!row) {
    $('status').textContent = 'KEINE DATEN / Influx unerreichbar';
    $('status').classList.add('err');
    return;
  }
  $('status').textContent = 'Daten OK';
  $('status').classList.remove('err');

  const now = new Date().toLocaleTimeString('de-DE');
  $('clock').textContent = now;
  $('clock2').textContent = new Date().toLocaleString('de-DE');

  // SOC
  const soc = Number(row.SOC);
  setLedBar(SOC_LEDS, 0, 100, SOC_STOPS, soc);
  $('soc-num').textContent = soc.toFixed(0);

  // Leistungen
  const vbat = Number(row.Vbat);
  const ibat = Number(row.Ibat), ipv = Number(row.IPV);
  const pBat = ibat * vbat, pPv = ipv * vbat, pLoad = (ipv - ibat) * vbat;
  $('p-pv').textContent = fmt(pPv, 0);
  $('p-bat').textContent = fmt(pBat, 0);
  $('p-load').textContent = fmt(pLoad, 0);
  $('p-currents').textContent =
    `PV ${fmt(ipv, 2)} A · Batt ${fmt(ibat, 2)} A · Last ${fmt(row.Iload, 2)} A · ` +
    `Int ${fmt(row.Tint, 1)} °C · Ext ${fmt(row.Text, 1)} °C`;

  // Akku-Zeile in der Time/Flags-Karte
  $('akku-line').textContent =
    `${fmt(vbat)} V · ${ibat > 0.05 ? 'lädt ' + fmt(ibat) + ' A' : ibat < -0.05 ? 'entlädt ' + fmt(-ibat) + ' A' : 'Ruhe'}`;

  // Zellen
  for (let i = 1; i <= 8; i++) {
    const v = cells ? cells['c' + i] : null;
    const c = CELL_LEDS[i - 1];
    if (v == null) { c.val.textContent = '–'; continue; }
    setLedBar(c.leds, 2.5, 3.8, CELL_STOPS, Number(v), cellColorRaw);
    c.val.textContent = Number(v).toFixed(3) + ' V';
  }

  // Delta
  gauge.set(row.delta == null ? null : Number(row.delta) * 1000);

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
  } catch (e) {
    $('status').textContent = 'FEHLER: ' + e.message;
    $('status').classList.add('err');
  }
}

tick();
setInterval(tick, 1000);
