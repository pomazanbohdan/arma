import { candidates } from './candidates.mjs';
import { parseReport, summarize, trend, trendBucketMs } from './report.mjs';

const focusIds = [3, 5, 8, 13, 19, 23, 25, 27];
const focusColor = '#b71421';
const candidateIds = candidates.map(candidate => candidate.id);
const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
const seriesOrder = [...focusIds, ...candidateIds.filter(id => !focusIds.includes(id))];
const formatNumber = new Intl.NumberFormat('uk-UA');
const formatTime = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const formatDateTime = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatHour = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
const $ = id => document.getElementById(id);
let deferredInstallPrompt = null;

let report = null;
let selected = new Set(candidateIds);
let range = '6h';
let mode = 'total';
let overviewChart = null;
let trendChart = null;
let ranking = [];

const seriesName = id => `№${id} ${focusIds.includes(id) ? candidateById.get(id).name : candidateById.get(id).name.split(' ')[0]}`;
const seriesColor = id => {
  return focusIds.includes(id) ? focusColor : `hsl(${Math.round(id * 137.5) % 360} 50% 42%)`;
};
const legendSelection = () => Object.fromEntries(candidateIds.map(id => [seriesName(id), selected.has(id)]));
const trendInterval = () => {
  const minutes = trendBucketMs(range, mode) / 60_000;
  return minutes % 60 === 0 ? (minutes / 60) + ' год' : minutes + ' хв';
};

function updateTrendDescription() {
  const interval = trendInterval();
  const unit = mode === 'total'
    ? `накопичені голоси, крок ${interval}`
    : `голоси за ${interval}; останній інтервал неповний`;
  $('trend-chart').setAttribute('aria-label', `Динаміка: ${unit}. Показано ${selected.size} із ${candidateIds.length} кандидатів. Список нижче вмикає і вимикає лінії.`);
}

function rankedCandidates() {
  return candidates.map(candidate => ({ ...candidate, count: report.summary.counts[candidate.id] }))
    .sort((a, b) => b.count - a.count || a.id - b.id);
}

function renderCandidateList() {
  const list = $('candidate-list');
  list.replaceChildren();
  for (const candidate of candidates) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `candidate-row${focusIds.includes(candidate.id) ? ' focus' : ''}`;
    row.dataset.candidate = candidate.id;
    row.setAttribute('aria-pressed', String(selected.has(candidate.id)));
    row.setAttribute('aria-label', `№${candidate.id}, ${candidate.name}, ${formatNumber.format(report.summary.counts[candidate.id])} голосів. ${selected.has(candidate.id) ? 'Прибрати з графіка' : 'Показати на графіку'}`);

    const identity = document.createElement('span');
    identity.className = 'candidate-table-name';
    const number = document.createElement('span');
    number.className = 'candidate-id';
    number.textContent = `${String(candidate.id).padStart(2, '0')}.`;
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'candidate-name';
    name.textContent = candidate.name;
    if (focusIds.includes(candidate.id)) {
      const pill = document.createElement('span');
      pill.className = 'focus-pill';
      pill.textContent = 'Виділено';
      name.append(pill);
    }
    const organization = document.createElement('span');
    organization.className = 'candidate-org';
    organization.textContent = candidate.organization;
    text.append(name, organization);
    const toggle = document.createElement('span');
    toggle.className = 'chart-toggle';
    toggle.setAttribute('aria-hidden', 'true');
    toggle.textContent = '✓';
    identity.append(number, text, toggle);

    const total = document.createElement('span');
    total.className = 'candidate-table-value';
    total.textContent = formatNumber.format(report.summary.counts[candidate.id]);
    const hour = document.createElement('span');
    hour.className = 'candidate-table-hour';
    hour.textContent = `+${formatNumber.format(report.summary.lastHour[candidate.id])}`;
    row.append(identity, total, hour);
    list.append(row);
  }
}

function initCharts() {
  if (!window.echarts) {
    $('overview-chart').textContent = 'Бібліотека графіків недоступна. Точні дані наведені у списку нижче.';
    $('trend-chart').textContent = 'Бібліотека графіків недоступна.';
    return false;
  }
  if (overviewChart) return true;
  overviewChart = window.echarts.init($('overview-chart'), null, { renderer: 'canvas' });
  trendChart = window.echarts.init($('trend-chart'), null, { renderer: 'canvas' });
  overviewChart.on('click', params => {
    if (params.componentType === 'series' && ranking[params.dataIndex]) toggleCandidate(ranking[params.dataIndex].id);
  });
  trendChart.on('click', params => {
    if (params.componentType !== 'series' || !Array.isArray(params.value)) return;
    const id = Number(params.seriesId);
    const interval = mode === 'pace'
      ? `за ${trendInterval()}${params.value[0] === report.summary.latestTime ? ' · неповний інтервал' : ''}`
      : 'накопичено';
    $('point-detail').textContent = `${candidateById.get(id).name} · ${formatTime.format(params.value[0])} · ${formatNumber.format(params.value[1])} голосів ${interval}`;
  });
  window.addEventListener('resize', () => { overviewChart.resize(); trendChart.resize(); });
  return true;
}

function renderOverview() {
  ranking = rankedCandidates();
  if (!initCharts()) return;
  const narrow = $('overview-chart').clientWidth < 650;
  overviewChart.setOption({
    animation: false,
    grid: { left: narrow ? 130 : 330, right: narrow ? 50 : 78, top: 12, bottom: 42 },
    xAxis: { type: 'value', min: 0, axisLine: { show: true, lineStyle: { color: '#bdc8d3' } }, axisLabel: { color: '#7f8b95', fontSize: 11 }, splitLine: { lineStyle: { color: '#edf0f4' } } },
    yAxis: { type: 'category', inverse: true, data: ranking.map(candidate => `№${candidate.id}`), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { width: narrow ? 118 : 310, overflow: 'truncate', fontSize: narrow ? 11 : 12, fontWeight: 600, formatter: (_, index) => { const candidate = ranking[index]; const label = `№${candidate.id} ${narrow ? candidate.name.split(' ')[0] : candidate.name}`; return focusIds.includes(candidate.id) ? `{focus|${label}}` : `{normal|${label}}`; }, rich: { focus: { color: focusColor, fontWeight: 800 }, normal: { color: '#344456', fontWeight: 600 } } } },
    tooltip: { trigger: 'item', confine: true, formatter: params => { const candidate = ranking[params.dataIndex]; return `${candidate.name}<br><b>${formatNumber.format(candidate.count)} голосів</b>`; } },
    series: [{ type: 'bar', barWidth: 18, data: ranking.map(candidate => ({ value: candidate.count, itemStyle: { color: focusIds.includes(candidate.id) ? focusColor : '#bec9d2', borderRadius: [0, 4, 4, 0] }, label: { color: focusIds.includes(candidate.id) ? focusColor : '#344456' } })), label: { show: true, position: 'right', fontWeight: 700, fontSize: 11, formatter: params => formatNumber.format(params.value) }, emphasis: { itemStyle: { opacity: .75 } } }],
  }, true);
}

function renderTrend() {
  if (!initCharts()) return;
  const records = report.parsed.records;
  const last = report.summary.latestTime;
  const first = records[0].time;
  const start = range === 'all' ? first : Math.max(first, last - (range === '6h' ? 6 : 24) * 3_600_000);
  const bucketMs = trendBucketMs(range, mode);
  const points = trend(records, candidateIds, start, bucketMs);
  const narrow = $('trend-chart').clientWidth < 650;
  trendChart.setOption({
    animation: false,
    color: seriesOrder.map(seriesColor),
    grid: { left: narrow ? 46 : 64, right: narrow ? 16 : 25, top: 18, bottom: 92 },
    legend: { show: false, data: seriesOrder.map(seriesName), selected: legendSelection() },
    tooltip: { trigger: 'item', confine: true, formatter: params => {
      const partial = mode === 'pace' && params.value[0] === last ? '<br>Останній інтервал неповний' : '';
      return `${formatTime.format(params.value[0])}${partial}<br>${params.marker} ${params.seriesName}: <b>${formatNumber.format(params.value[1])}</b>`;
    } },
    xAxis: { type: 'time', min: points[0]?.time, max: Math.max(points.at(-1)?.time ?? 0, (points[0]?.time ?? 0) + bucketMs), axisLabel: { color: '#85929e', fontSize: 11, formatter: value => range === '6h' ? formatHour.format(value) : formatTime.format(value) }, axisLine: { lineStyle: { color: '#bdc8d3' } }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, axisLabel: { color: '#85929e', fontSize: 11, formatter: value => formatNumber.format(value) }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#edf0f4' } } },
    dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'slider', xAxisIndex: 0, bottom: 22, height: 19, borderColor: '#dce3ed', fillerColor: '#dce6fb', handleStyle: { color: '#5272c5' }, showDetail: false }],
    series: seriesOrder.map(id => ({ id: String(id), name: seriesName(id), type: 'line', smooth: false, showSymbol: false, symbolSize: 7, lineStyle: { width: focusIds.includes(id) ? 2.7 : 2, type: focusIds.includes(id) ? ['solid', 'dashed', 'dotted'][focusIds.indexOf(id) % 3] : 'solid' }, itemStyle: { color: seriesColor(id) }, emphasis: { focus: 'series' }, data: points.map(point => [point.time, mode === 'total' ? point.values.get(id) : point.increments.get(id)]) })),
  }, true);
  updateTrendDescription();
}

function toggleCandidate(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  if (trendChart) trendChart.setOption({ legend: { selected: legendSelection() } });
  renderCandidateList();
  updateTrendDescription();
  $('point-detail').textContent = `${candidateById.get(id).name}: ${selected.has(id) ? 'показано' : 'приховано'} на графіку.`;
}

function renderAll() {
  $('ballots').textContent = formatNumber.format(report.summary.ballots);
  $('selections').textContent = formatNumber.format(report.summary.selections);
  $('last-vote-time').textContent = formatDateTime.format(report.summary.latestTime);
  const updatedAt = Date.parse(report.meta?.fetchedAt ?? '');
  $('data-updated-time').textContent = Number.isFinite(updatedAt) ? formatDateTime.format(updatedAt) : '—';
  renderOverview();
  renderTrend();
  renderCandidateList();
}

function buildReport(raw, expectedCount = null) {
  const parsed = parseReport(raw);
  if (!parsed.records.length || parsed.rejected.length ||
      (expectedCount !== null && parsed.records.length !== expectedCount)) {
    throw new Error('Некоректний або неповний протокол');
  }
  return { parsed, summary: summarize(parsed.records) };
}

async function loadReport() {
  try {
    const [dataResponse, metaResponse] = await Promise.all([
      fetch('./data/hashed_report.txt', { cache: 'no-cache' }),
      fetch('./data/meta.json', { cache: 'no-cache' }),
    ]);
    if (!dataResponse.ok || !metaResponse.ok) {
      throw new Error(`Файл протоколу або метаданих недоступний: HTTP ${dataResponse.status}/${metaResponse.status}`);
    }
    const [raw, meta] = await Promise.all([dataResponse.text(), metaResponse.json()]);
    if (!Number.isSafeInteger(meta.recordCount) || typeof meta.sha256 !== 'string') {
      throw new Error('Метадані знімка некоректні');
    }
    const prepared = buildReport(raw, meta.recordCount);
    report = { ...prepared, meta };
    renderAll();
    $('status-dot').classList.remove('error');
    $('status-text').textContent = 'Зафіксований протокол';
    const fetchedAt = Date.parse(meta.fetchedAt);
    const digest = `SHA-256 ${meta.sha256.slice(0, 12)}`;
    $('status-detail').textContent = Number.isFinite(fetchedAt)
      ? `Артефакт GitHub Actions · ${formatDateTime.format(fetchedAt)} (Київ) · ${digest}`
      : `Локальний знімок · ${digest}`;
  } catch (error) {
    $('status-dot').classList.add('error');
    $('status-text').textContent = 'Дані недоступні';
    $('status-detail').textContent = 'Не вдалося прочитати локальний знімок протоколу.';
    console.error('Report load failed:', error);
  }
}

function isInstalledApp() {
  return (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
}

function isAppleMobileDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showInstallHelp() {
  const isAppleMobile = isAppleMobileDevice();
  const steps = isAppleMobile
    ? ['У Safari натисніть «Поділитися».', 'Виберіть «На початковий екран».', 'Увімкніть «Відкрити як вебзастосунок» і натисніть «Додати».']
    : ['Відкрийте меню браузера або кнопку встановлення біля адреси.', 'Виберіть «Встановити» чи «Додати на головний екран».', 'Підтвердіть дію у вікні браузера.'];
  $('install-help-text').textContent = isAppleMobile
    ? 'На iPhone та iPad додавання запускається з меню Safari; сайт не може натиснути це замість вас.'
    : 'Назва пункту залежить від браузера. Якщо встановлення недоступне, спробуйте Chrome на Android або Safari на iPhone та iPad.';
  const list = $('install-steps');
  list.replaceChildren(...steps.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  const dialog = $('install-help');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function initInstallControl() {
  const button = $('install-app');
  if (isInstalledApp()) {
    button.hidden = true;
    return;
  }
  if (isAppleMobileDevice()) button.textContent = 'На екран';
  button.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showInstallHelp();
      return;
    }
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') button.hidden = true;
      else button.textContent = 'Як встановити';
    } catch {
      showInstallHelp();
    }
  });
  $('close-install-help').addEventListener('click', () => {
    const dialog = $('install-help');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });
  $('install-help').addEventListener('click', event => {
    if (event.target !== event.currentTarget) return;
    const dialog = $('install-help');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('install-app').textContent = 'Встановити';
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  $('install-app').hidden = true;
});

document.addEventListener('click', event => {
  const candidate = event.target.closest('[data-candidate]');
  if (candidate && report) toggleCandidate(Number(candidate.dataset.candidate));
  const rangeButton = event.target.closest('[data-range]');
  if (rangeButton && report) {
    range = rangeButton.dataset.range;
    document.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button === rangeButton)));
    renderTrend();
  }
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton && report) {
    mode = modeButton.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button === modeButton)));
    renderTrend();
  }
});
initInstallControl();
loadReport();
