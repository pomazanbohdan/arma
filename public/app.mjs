import { candidates } from './candidates.mjs';
import { parseReport, summarize, trend } from './report.mjs';

const focusIds = [3, 5, 8, 13, 19, 23, 25, 27];
const focusColor = '#b71421';
const candidateIds = candidates.map(candidate => candidate.id);
const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
const seriesOrder = [...focusIds, ...candidateIds.filter(id => !focusIds.includes(id))];
const formatNumber = new Intl.NumberFormat('uk-UA');
const formatTime = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const formatHour = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
const $ = id => document.getElementById(id);

let report = null;
let selected = new Set(focusIds);
let range = '6h';
let mode = 'total';
let loading = false;
let overviewChart = null;
let trendChart = null;
let ranking = [];

const seriesName = id => `№${id} ${focusIds.includes(id) ? candidateById.get(id).name : candidateById.get(id).name.split(' ')[0]}`;
const seriesColor = id => {
  return focusIds.includes(id) ? focusColor : `hsl(${Math.round(id * 137.5) % 360} 50% 42%)`;
};
const legendSelection = () => Object.fromEntries(candidateIds.map(id => [seriesName(id), selected.has(id)]));

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
  trendChart.on('legendselectchanged', params => {
    selected = new Set(candidateIds.filter(id => params.selected[seriesName(id)]));
    renderCandidateList();
  });
  trendChart.on('click', params => {
    if (params.componentType !== 'series' || !Array.isArray(params.value)) return;
    const id = Number(params.seriesId);
    const unit = mode === 'pace' ? `за ${range === '6h' ? '5 хв' : range === '24h' ? '15 хв' : '1 год'}` : 'накопичено';
    $('point-detail').textContent = `${candidateById.get(id).name} · ${formatTime.format(params.value[0])} · ${formatNumber.format(params.value[1])} голосів ${unit}`;
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
  const bucketMs = range === '6h' ? 300_000 : range === '24h' ? 900_000 : 3_600_000;
  const points = trend(records, candidateIds, start, bucketMs);
  const narrow = $('trend-chart').clientWidth < 650;
  trendChart.setOption({
    animation: false,
    color: seriesOrder.map(seriesColor),
    grid: { left: narrow ? 46 : 64, right: narrow ? 16 : 25, top: 88, bottom: 92 },
    legend: { type: 'scroll', data: seriesOrder.map(seriesName), selected: legendSelection(), top: 4, left: 10, right: 10, height: 58, itemWidth: 16, itemHeight: 9, itemGap: 10, formatter: name => focusIds.some(id => seriesName(id) === name) ? `{focus|${name}}` : name, textStyle: { color: '#52616e', fontSize: narrow ? 10 : 11, rich: { focus: { color: focusColor, fontWeight: 800 } } } },
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'cross' }, valueFormatter: value => `${formatNumber.format(value)} голосів`, formatter: params => { if (!params.length) return ''; return `${formatTime.format(params[0].value[0])}<br>${params.map(item => `${item.marker} ${item.seriesName}: <b>${formatNumber.format(item.value[1])}</b>`).join('<br>')}`; } },
    xAxis: { type: 'time', min: points[0]?.time, max: Math.max(points.at(-1)?.time ?? 0, (points[0]?.time ?? 0) + bucketMs), axisLabel: { color: '#85929e', fontSize: 11, formatter: value => range === '6h' ? formatHour.format(value) : formatTime.format(value) }, axisLine: { lineStyle: { color: '#bdc8d3' } }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, axisLabel: { color: '#85929e', fontSize: 11, formatter: value => formatNumber.format(value) }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#edf0f4' } } },
    dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'slider', xAxisIndex: 0, bottom: 22, height: 19, borderColor: '#dce3ed', fillerColor: '#dce6fb', handleStyle: { color: '#5272c5' }, showDetail: false }],
    series: seriesOrder.map(id => ({ id: String(id), name: seriesName(id), type: 'line', smooth: false, showSymbol: false, symbolSize: 7, lineStyle: { width: focusIds.includes(id) ? 2.7 : 2, type: focusIds.includes(id) ? ['solid', 'dashed', 'dotted'][focusIds.indexOf(id) % 3] : 'solid' }, itemStyle: { color: seriesColor(id) }, emphasis: { focus: 'series' }, data: points.map(point => [point.time, mode === 'total' ? point.values.get(id) : point.increments.get(id)]) })),
  }, true);
  const unit = mode === 'total' ? 'накопичені голоси' : `голоси за ${range === '6h' ? '5 хв' : range === '24h' ? '15 хв' : '1 год'}`;
  $('trend-chart').setAttribute('aria-label', `Динаміка: ${unit}. Початково показані кандидати №${focusIds.join(', ')}. Імена в легенді вмикають і вимикають лінії.`);
}

function toggleCandidate(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  if (trendChart) trendChart.setOption({ legend: { selected: legendSelection() } });
  renderCandidateList();
  $('point-detail').textContent = `${candidateById.get(id).name}: ${selected.has(id) ? 'показано' : 'приховано'} на графіку.`;
}

function renderAll() {
  $('ballots').textContent = formatNumber.format(report.summary.ballots);
  $('selections').textContent = formatNumber.format(report.summary.selections);
  $('latest-time').textContent = formatTime.format(report.summary.latestTime);
  renderOverview();
  renderTrend();
  renderCandidateList();
}

async function loadReport() {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  const version = Math.floor(Date.now() / 60_000);
  try {
    const [dataResponse, metaResponse] = await Promise.all([
      fetch(`./data/hashed_report.txt?v=${version}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }),
      fetch(`./data/meta.json?v=${version}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }),
    ]);
    if (!dataResponse.ok || !metaResponse.ok) throw new Error(`HTTP ${dataResponse.status}/${metaResponse.status}`);
    const [raw, meta] = await Promise.all([dataResponse.text(), metaResponse.json()]);
    const parsed = parseReport(raw);
    if (!parsed.records.length || parsed.rejected.length || parsed.records.length !== meta.recordCount) throw new Error('Некоректний або неповний протокол');
    report = { parsed, meta, summary: summarize(parsed.records) };
    renderAll();
    $('status-dot').classList.remove('error');
    $('status-text').textContent = 'Дані завантажено';
    $('status-detail').textContent = `Копія: ${formatTime.format(Date.parse(meta.fetchedAt))} (Київ) · перевірка щохвилини${window.echarts ? '' : ' · графіки недоступні'}`;
  } catch (error) {
    $('status-dot').classList.add('error');
    $('status-text').textContent = report ? 'Оновлення недоступне' : 'Дані недоступні';
    $('status-detail').textContent = report ? 'Показуємо останню успішну копію.' : 'Повторіть спробу пізніше.';
    console.error('Report load failed:', error);
  } finally {
    loading = false;
    $('refresh').disabled = false;
  }
}

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
$('refresh').addEventListener('click', loadReport);
loadReport();
setInterval(loadReport, 60_000);
