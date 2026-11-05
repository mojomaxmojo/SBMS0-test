/* SBMS0 BERECHNUNGEN – 1:1 wie das Grafana-Dashboard (Reihenfolge, Farben) */
'use strict';

const FROM_TODAY = "time > now() - 24h"; // ~Today

/* ---------- Energie heute (Bargauge links) ---------- */
const Q_ENERGY = [
  { alias: 'Erzeugt',   color: '#73bf69', q: `SELECT sum("PV Power W") / 3600 / 1000 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY}` },
  { alias: 'Geladen',   color: '#f2cc0c', q: `SELECT sum("Battery Power W") / 3600 / 1000 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Power W" > 0 AND ${FROM_TODAY}` },
  { alias: 'Entladen',  color: '#f2495c', q: `SELECT sum("Battery Power W") / 3600 / 1000 * -1 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Power W" < 0 AND ${FROM_TODAY}` },
  { alias: 'Verbraucht',color: '#ff9830', q: `SELECT sum("Consumption Power W") / 3600 / 1000 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY}` },
];

// Statische Bar-Struktur (Label + LED-Bar + Wert), Farben wie Grafana-Overrides
const ENERGY_BARS = [];
{
  const box = $('energy-bars');
  for (const t of Q_ENERGY) {
    const row = document.createElement('div');
    row.className = 'cell-row';
    row.innerHTML =
      `<span class="cname wide">${t.alias}</span>` +
      `<div class="ledbar thin"></div>` +
      `<span class="cval">–</span>`;
    box.appendChild(row);
    const leds = buildLedBar(row.querySelector('.ledbar'), 60, 0, 7, [[0, [0x73,0xbf,0x69]], [7, [0xf2,0x49,0x5c]]]);
    ENERGY_BARS.push({ ...t, leds, val: row.querySelector('.cval'), barEl: row.querySelector('.ledbar') });
  }
}

function fmtKwh(v) { return v == null ? '–' : Number(v).toFixed(2) + ' kWh'; }

async function updateEnergy() {
  for (const b of ENERGY_BARS) {
    try {
      const row = await fetchRow(b.q);
      const v = row ? Object.values(row)[0] : null;
      if (v == null) { b.val.textContent = '–'; continue; }
      const num = Number(v);
      setLedBar(b.leds, 0, 7, [[0, [0x73,0xbf,0x69]], [7, [0xf2,0x49,0x5c]]], Math.min(num, 7),
        () => hexToRgbArr(b.color));
      b.val.textContent = fmtKwh(num);
    } catch (e) { b.val.textContent = 'Fehler'; }
  }
}
function hexToRgbArr(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

/* ---------- Energy flow (heute) – Chart rechts ---------- */
const Q_FLOW =
  `SELECT mean("PV Power W") AS pv, mean("Consumption Power W") AS cons, mean("Battery Power W") AS bat ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY} GROUP BY time(1m) fill(null)`;

let flowPlot = null;
async function updateFlow() {
  const s = await fetchSeries(Q_FLOW);
  if (!s) return;
  const data = [[], [], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Math.round(v[1]));
    data[2].push(v[2] == null ? null : Math.round(v[2]));
    data[3].push(v[3] == null ? null : Math.round(v[3]));
  }
  // Battery-Farbe dynamisch wie Grafana (thresholds, seriesBy last): >0 grün, <0 rot
  let batLast = null;
  for (let j = data[3].length - 1; j >= 0; j--) if (data[3][j] != null) { batLast = data[3][j]; break; }
  const batColor = batLast == null ? '#73bf69' : (batLast >= 0 ? '#73bf69' : '#f2495c');
  const opts = uplotBaseOpts(220,
    (u, vals) => vals.map((v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + ' kW' : v + ' W')));
  opts.width = $('flowchart').clientWidth;
  opts.series = [
    {},
    { label: 'PV power', stroke: '#73bf69', width: 1.5, fill: 'rgba(115,191,105,0.12)', spanGaps: true },
    { label: 'Consumption', stroke: '#ff9830', width: 1.5, fill: 'rgba(255,152,48,0.10)', spanGaps: true },
    { label: 'Battery', stroke: batColor, width: 1.5, spanGaps: true },
  ];
  if (!flowPlot) flowPlot = new uPlot(opts, data, $('flowchart'));
  else {
    // Farbe bei Richtungwechsel aktualisieren
    if (flowPlot.series[3].stroke !== batColor) {
      flowPlot.delSeries(3);
      flowPlot.addSeries({ label: 'Battery', stroke: batColor, width: 1.5, spanGaps: true }, 3);
    }
    flowPlot.setData(data);
  }
}

/* ---------- Prognosen (Time to full/empty) ---------- */
const TTF_STOPS = [[0, [0x73,0xbf,0x69]], [480, [0xea,0xb8,0x39]], [1440, [0xf2,0x49,0x5c]]];
const TTE_STOPS = [[0, [0xf2,0x49,0x5c]], [7, [0xea,0xb8,0x39]], [100, [0x73,0xbf,0x69]]];

function fmtMin(v) {
  if (v == null) return '–';
  const m = Math.round(v);
  if (m >= 1440) return (m / 1440).toFixed(1) + ' d';
  if (m >= 60) return (m / 60).toFixed(1) + ' h';
  return m + ' min';
}

function buildProgBars(boxId, defs) {
  const box = $(boxId);
  const out = [];
  for (const d of defs) {
    const row = document.createElement('div');
    row.className = 'cell-row';
    row.innerHTML =
      `<span class="cname wide">${d.alias}</span>` +
      `<div class="ledbar thin"></div>` +
      `<span class="cval">–</span>`;
    box.appendChild(row);
    out.push({ ...d, leds: buildLedBar(row.querySelector('.ledbar'), 60, 0, d.max, d.stops), val: row.querySelector('.cval') });
  }
  return out;
}

const TTF_BARS = buildProgBars('ttf-bars', [
  { alias: 'Current (5m)', max: 2880, stops: TTF_STOPS,
    q: `SELECT (280 *(100 - "State of Charge") / 100) / (("Battery Current" + ABS("Battery Current")) / 2) * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" > 0 AND time > now() -5m` },
  { alias: 'Last 1h', max: 2880, stops: TTF_STOPS,
    q: `SELECT (280 *(100 - "State of Charge") / 100) / (("Battery Current" + ABS("Battery Current")) / 2) * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" > 0 AND time > now() -1h` },
]);
const TTE_BARS = buildProgBars('tte-bars', [
  { alias: 'Current (5m)', max: 14400, stops: TTE_STOPS,
    q: `SELECT (280 * "State of Charge" / 100) / ((-"Battery Current" + ABS("Battery Current")) / 2) * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" < 0 AND time > now() -5m` },
  { alias: 'Last 1h', max: 14400, stops: TTE_STOPS,
    q: `SELECT (280 * "State of Charge" / 100) / ("PV Total Current" - "Battery Current") * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ("PV Total Current" - "Battery Current") > 0 AND time > now() -1h` },
  { alias: 'Last 24h', max: 14400, stops: TTE_STOPS,
    q: `SELECT (280 * "State of Charge" / 100) / ("PV Total Current" - "Battery Current") * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ("PV Total Current" - "Battery Current") > 0 AND time > now() -24h` },
]);

// Status-Zeile (Hinweistext wie Grafana-Value-Mapping)
const Q_TTF_STATUS = `SELECT last("State of Charge") - last("State of Charge") AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" <= 0 AND time > now() - 1m`;
const Q_TTE_STATUS = `SELECT last("State of Charge") - last("State of Charge") AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" >= 0 AND time > now() - 1m`;

function statusText(el, text) {
  let line = el.querySelector('.status-line');
  if (!line) {
    line = document.createElement('div');
    line.className = 'status-line';
    el.appendChild(line);
  }
  line.textContent = text;
}

async function updateProg(bars, statusQ, statusMsg, panelId) {
  let anyData = false;
  for (const b of bars) {
    try {
      const row = await fetchRow(b.q);
      const v = row ? row.v : null;
      if (v == null) { b.val.textContent = '–'; continue; }
      anyData = true;
      const num = Number(v);
      setLedBar(b.leds, 0, b.max, b.stops, Math.min(num, b.max));
      b.val.textContent = fmtMin(num);
    } catch (e) { b.val.textContent = 'Fehler'; }
  }
  // Status-Hinweis nur wenn keine echten Daten (wie Grafana-Value-Mapping)
  if (!anyData) {
    try {
      const row = await fetchRow(statusQ);
      if (row && row.v != null) statusText($(panelId), statusMsg);
      return;
    } catch (e) { /* ignore */ }
  }
  statusText($(panelId), '');
}

/* ---------- Battery Levels (heute) – 2 Achsen ---------- */
const Q_BATLEVELS =
  `SELECT mean("Battery Voltage") AS volt, mean("State of Charge") AS soc ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY} GROUP BY time(1m) fill(null)`;

let battPlot = null;
async function updateBatLevels() {
  const s = await fetchSeries(Q_BATLEVELS);
  if (!s) return;
  const data = [[], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Number(v[1]));
    data[2].push(v[2] == null ? null : Number(v[2]));
  }
  const opts = uplotBaseOpts(300,
    (u, vals) => vals.map((v) => v.toFixed(2) + ' V'));
  opts.width = $('battchart').clientWidth;
  opts.series = [
    {},
    { label: 'Voltage', stroke: '#5794f2', width: 2, spanGaps: true, scale: 'volt' },
    { label: 'SOC', stroke: '#73bf69', width: 2, spanGaps: true, scale: 'soc',
      dash: [0, 10], // gepunktet wie Grafana lineStyle dot
      points: { show: false } },
  ];
  opts.scales = { x: { time: true }, volt: { auto: true }, soc: { auto: true, range: [0, 100] } };
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => vals.map((v) => new Date(v).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })) },
    { scale: 'volt', stroke: '#5794f2', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3,
      values: (u, vals) => vals.map((v) => v.toFixed(2) + ' V') },
    { scale: 'soc', stroke: '#73bf69', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1,
      values: (u, vals) => vals.map((v) => v.toFixed(0) + ' %') },
  ];
  if (!battPlot) battPlot = new uPlot(opts, data, $('battchart'));
  else battPlot.setData(data);
  renderLegendTable($('battlegend'), [
    { label: 'Voltage', color: '#5794f2', values: data[1], fmt: (v) => v == null ? '–' : v.toFixed(2) + ' V' },
    { label: 'SOC', color: '#73bf69', values: data[2], fmt: (v) => v == null ? '–' : v.toFixed(1) + ' %' },
  ]);
}

/* ---------- Cell Voltages (Verlauf) ---------- */
const Q_CELLVERLAUF =
  `SELECT mean("Cell 1") AS c1, mean("Cell 2") AS c2, mean("Cell 3") AS c3, mean("Cell 4") AS c4, ` +
  `mean("Cell 5") AS c5, mean("Cell 6") AS c6, mean("Cell 7") AS c7, mean("Cell 8") AS c8 ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY} GROUP BY time(1m) fill(null)`;

// Grafana palette-classic Farben
const PALETTE = ['#73bf69', '#5794f2', '#ff9830', '#f2495c', '#b3d4ff', '#f2cc0c', '#c15ca8', '#8ab8ff'];
let cellsPlot = null;
async function updateCellsVerlauf() {
  const s = await fetchSeries(Q_CELLVERLAUF);
  if (!s) return;
  const data = [[], [], [], [], [], [], [], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    for (let i = 1; i <= 8; i++) data[i].push(v[i] == null ? null : Number(v[i]));
  }
  const opts = uplotBaseOpts(300,
    (u, vals) => vals.map((v) => v.toFixed(3) + ' V'));
  opts.width = $('cellschart').clientWidth;
  opts.series = [{}];
  const legendSeries = [];
  for (let i = 1; i <= 8; i++) {
    opts.series.push({
      label: `Cell ${i}`, stroke: PALETTE[i - 1], width: 1, spanGaps: true,
      scale: 'v', points: { show: false },
      value: (u, v) => v == null ? '–' : v.toFixed(3) + ' V',
    });
    legendSeries.push({ label: `Cell ${i}`, color: PALETTE[i - 1], values: data[i], fmt: (v) => v == null ? '–' : v.toFixed(3) + ' V' });
  }
  opts.scales = { x: { time: true }, v: { auto: true, range: [2.5, 3.8] } };
  if (!cellsPlot) cellsPlot = new uPlot(opts, data, $('cellschart'));
  else cellsPlot.setData(data);
  renderLegendTable($('cellslegend'), legendSeries);
}

/* ---------- Ticker ---------- */
async function tickSlow() {
  $('status').textContent = 'Daten OK';
  $('clock').textContent = new Date().toLocaleTimeString('de-DE');
  await Promise.all([updateEnergy(), updateFlow(), updateBatLevels(), updateCellsVerlauf()]);
}
async function tickFast() {
  await Promise.all([
    updateProg(TTF_BARS, Q_TTF_STATUS, '– lädt gerade nicht (entlädt)', 'ttf-panel'),
    updateProg(TTE_BARS, Q_TTE_STATUS, '– entlädt gerade nicht (lädt)', 'tte-panel'),
  ]);
}

Promise.all([tickSlow(), tickFast()]);
setInterval(tickSlow, 60000);  // 1-Min-Daten
setInterval(tickFast, 10000);  // Prognosen (Rohdaten) öfter

window.addEventListener('resize', () => {
  flowPlot && flowPlot.setSize({ width: $('flowchart').clientWidth, height: 220 });
  battPlot && battPlot.setSize({ width: $('battchart').clientWidth, height: 300 });
  cellsPlot && cellsPlot.setSize({ width: $('cellschart').clientWidth, height: 300 });
});
