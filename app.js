// app.js — Adventure Works Sales Dashboard
// Dataset: Sales_BY_Category (Bikes, Accessories, Clothing)
// Filter interaktif: semua chart re-render saat filter berubah

// ── Helper parse ──────────────────────────────────────────────
function parseNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  const n = parseFloat(String(val).trim());
  return isNaN(n) ? 0 : n;
}

function parseISODate(str) {
  if (!str) return null;
  // Format: "2001-07-01 00:00:00.000" atau "2001-07-01"
  const d = new Date(str.trim().substring(0, 10));
  return isNaN(d.getTime()) ? null : d;
}

// ── State global ──────────────────────────────────────────────
let rawData          = [];
let filteredData     = [];
let summaryStats     = {};
let currentAnomalies = {};

// Filter state
const filterState = {
  year:     'all',
  category: 'all',
  segment:  'all',
  territory:'all'
};

// ── Entry point ───────────────────────────────────────────────
d3.csv('sales.csv').then(async function(data) {

  // == FASE 1: PARSE DATA ==
  rawData = data.map(d => ({
    orderId:   d['SalesOrderID'],
    orderDate: parseISODate(d['OrderDate']),
    customerId:d['CustomerID'],
    segment:   d['Segment'] || '',
    territory: d['Territory'] || '',
    country:   d['CountryRegion'] || '',
    product:   d['ProductName'] || '',
    subcat:    d['SubCategory'] || '',
    category:  d['Category'] || '',
    qty:       parseNum(d['Qty']),
    sales:     parseNum(d['Sales']),
    discount:  parseNum(d['Discount']),
    profit:    parseNum(d['Profit'])
  })).filter(d => d.orderDate !== null && !isNaN(d.sales));

  // Populate filter dropdowns
  populateFilters();

  // == FASE 2: RENDER AWAL ==
  applyFilters();

  // == FASE 3: AI ASINKON — pakai data penuh (tidak terpengaruh filter) ==
  const fullStats = computeSummary(rawData);
  const fullAnomalies = detectAllAnomalies(rawData);

  Promise.allSettled([
    generateTitle(fullStats, fullAnomalies),
    generateStory(fullStats, fullAnomalies),
    getInsight(fullStats, 'Berikan 3 insight paling penting dan rekomendasi konkret dalam Bahasa Indonesia.')
  ]).then(([titleRes, storyRes, insightRes]) => {

    if (titleRes.status === 'fulfilled') {
      const el = document.getElementById('narrative-title');
      if (el) { el.textContent = titleRes.value.trim(); el.classList.add('loaded'); }
    }

    if (storyRes.status === 'fulfilled') {
      const scr = parseStoryResponse(storyRes.value);
      fillZone('setup-text',      scr.setup);
      fillZone('conflict-text',   scr.conflict);
      fillZone('resolution-text', scr.resolution);
    }

    if (insightRes.status === 'fulfilled') {
      const el = document.getElementById('insight-output');
      if (el) el.innerHTML = formatInsight(insightRes.value);
    }
  });

  // Footer model name
  const fm = document.getElementById('footer-model');
  if (fm) fm.textContent = CONFIG.AI_PROVIDER === 'ollama' ? CONFIG.OLLAMA_MODEL : CONFIG.GROQ_MODEL;

  const mb = document.getElementById('model-badge');
  if (mb) mb.textContent = CONFIG.AI_PROVIDER === 'ollama' ? CONFIG.OLLAMA_MODEL : CONFIG.GROQ_MODEL;
});

// ── Populate filter dropdowns ─────────────────────────────────
function populateFilters() {
  const years      = [...new Set(rawData.map(d => d.orderDate.getFullYear()))].sort();
  const categories = [...new Set(rawData.map(d => d.category))].sort();
  const segments   = [...new Set(rawData.map(d => d.segment))].sort();
  const territories= [...new Set(rawData.map(d => d.territory))].sort();

  fillSelect('filter-year',      years,       'Semua Tahun');
  fillSelect('filter-category',  categories,  'Semua Kategori');
  fillSelect('filter-segment',   segments,    'Semua Segmen');
  fillSelect('filter-territory', territories, 'Semua Wilayah');
}

function fillSelect(id, values, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="all">${placeholder}</option>` +
    values.map(v => `<option value="${v}">${v}</option>`).join('');
  el.onchange = () => {
    filterState[id.replace('filter-', '')] = el.value;
    applyFilters();
  };
}

// ── Apply filters + re-render semua chart ────────────────────
function applyFilters() {
  filteredData = rawData.filter(d => {
    if (filterState.year      !== 'all' && String(d.orderDate.getFullYear()) !== filterState.year)     return false;
    if (filterState.category  !== 'all' && d.category  !== filterState.category)  return false;
    if (filterState.segment   !== 'all' && d.segment   !== filterState.segment)   return false;
    if (filterState.territory !== 'all' && d.territory !== filterState.territory) return false;
    return true;
  });

  summaryStats     = computeSummary(filteredData);
  currentAnomalies = detectAllAnomalies(filteredData);

  // Render semua bagian
  displaySummaryCards(summaryStats);
  dispatchDataReady(summaryStats);

  renderSubcatChart(filteredData, buildAnomalyMap(currentAnomalies));
  renderCategoryChart(filteredData);
  renderTerritoryChart(filteredData);
  renderTrendChart(filteredData);
  renderSegmentChart(filteredData);
  renderScatterChart(filteredData);

  // Alert panel
  const sevCount = countSeverity(currentAnomalies);
  const bs = document.getElementById('badge-severe');
  const bw = document.getElementById('badge-warning');
  if (bs) bs.textContent = sevCount.severe  + ' Kritis';
  if (bw) bw.textContent = sevCount.warning + ' Peringatan';
  renderRawAnomalies(currentAnomalies);

  // Reset alert narasi tab ke raw saat filter berubah
  switchAlertTab('raw', document.querySelector('.alert-tab'));
}

// ── computeSummary ────────────────────────────────────────────
function computeSummary(data) {
  const totalSales   = d3.sum(data, d => d.sales);
  const totalProfit  = d3.sum(data, d => d.profit);
  const totalQty     = d3.sum(data, d => d.qty);
  const totalOrders  = new Set(data.map(d => d.orderId)).size;
  const totalCust    = new Set(data.map(d => d.customerId).filter(Boolean)).size;
  const margin       = totalSales > 0 ? (totalProfit / totalSales * 100).toFixed(1) : '0.0';

  // Per kategori
  const byCategory = d3.rollup(data,
    v => ({ sales: d3.sum(v, d => d.sales), profit: d3.sum(v, d => d.profit) }),
    d => d.category
  );
  const catArray = [...byCategory.entries()].map(([cat, v]) => ({
    category: cat,
    sales:    v.sales,
    profit:   v.profit,
    margin:   v.sales > 0 ? (v.profit / v.sales * 100).toFixed(1) : '0.0'
  })).sort((a, b) => b.margin - a.margin);

  // Per territory
  const byTerr = d3.rollup(data,
    v => ({ sales: d3.sum(v, d => d.sales), profit: d3.sum(v, d => d.profit) }),
    d => d.territory
  );
  const terrArray = [...byTerr.entries()].map(([t, v]) => ({
    territory: t, sales: v.sales, profit: v.profit,
    margin: v.sales > 0 ? (v.profit / v.sales * 100).toFixed(1) : '0.0'
  })).sort((a, b) => b.sales - a.sales);

  return {
    totalSales:     totalSales.toFixed(0),
    totalProfit:    totalProfit.toFixed(0),
    totalQty:       totalQty,
    overallMargin:  margin,
    totalOrders:    totalOrders,
    totalCustomers: totalCust,
    categories:     catArray,
    territories:    terrArray,
    bestCategory:   catArray[0]  || { category: '-', margin: '0' },
    worstCategory:  catArray[catArray.length - 1] || { category: '-', margin: '0' }
  };
}

// ── displaySummaryCards ───────────────────────────────────────
function displaySummaryCards(stats) {
  const cards = [
    { label: 'Total Sales',   value: `$${(stats.totalSales/1000000).toFixed(2)}M`,   cls: 'kpi-purple' },
    { label: 'Total Profit',  value: `$${(stats.totalProfit/1000).toFixed(0)}K`,     cls: stats.totalProfit >= 0 ? 'kpi-green' : 'kpi-red' },
    { label: 'Profit Margin', value: `${stats.overallMargin}%`,                      cls: +stats.overallMargin >= 15 ? 'kpi-green' : +stats.overallMargin >= 5 ? 'kpi-amber' : 'kpi-red' },
    { label: 'Total Qty',     value: Number(stats.totalQty).toLocaleString(),        cls: 'kpi-blue' },
    { label: 'Total Orders',  value: Number(stats.totalOrders).toLocaleString(),     cls: 'kpi-indigo' },
    { label: 'Customers',     value: Number(stats.totalCustomers).toLocaleString(),  cls: 'kpi-teal' }
  ];
  const el = document.getElementById('summary-cards');
  if (!el) return;
  el.innerHTML = cards.map(c => `
    <div class="summary-card ${c.cls}">
      <div class="sc-label">${c.label}</div>
      <div class="sc-value">${c.value}</div>
    </div>`).join('');
}

// ── fillZone ──────────────────────────────────────────────────
function fillZone(id, text) {
  const el = document.getElementById(id);
  if (!el || !text) return;
  el.textContent = text;
  el.classList.add('ai-loaded');
}

// ── dispatchDataReady ─────────────────────────────────────────
function dispatchDataReady(stats) {
  window.dispatchEvent(new CustomEvent('capstone-data-ready', { detail: stats }));
}

// ── buildAnomalyMap ───────────────────────────────────────────
function buildAnomalyMap(anomalies) {
  const map = new Map();
  anomalies.profitOutliers.forEach(a => {
    map.set(a.name, { severity: a.severity, zScore: a.zScore, direction: a.direction });
  });
  return map;
}

// ============================================================
// CHART RENDERERS — semua reactive terhadap filteredData
// ============================================================

// ── Shared color palette ──────────────────────────────────────
const CHART_COLORS = {
  primary:   '#7c3aed',  // ungu utama
  secondary: '#a78bfa',  // ungu muda
  accent:    '#c4b5fd',  // lilac
  green:     '#059669',
  red:       '#dc2626',
  amber:     '#d97706',
  blue:      '#2563eb',
  teal:      '#0891b2',
  muted:     '#94a3b8',
  text:      '#4b5563'
};

const AXIS_STYLE = { color: '#6b7280', fontSize: 11 };

function styleAxis(g) {
  g.selectAll('text').attr('fill', AXIS_STYLE.color).attr('font-size', AXIS_STYLE.fontSize);
  g.select('.domain').attr('stroke', '#e5e7eb');
  g.selectAll('.tick line').attr('stroke', '#e5e7eb');
}

// ── renderSubcatChart: profit margin per subkat (anomaly highlight) ─
function renderSubcatChart(data, anomalyMap) {
  const margin = { top: 20, right: 60, bottom: 20, left: 140 };
  const w = 560 - margin.left - margin.right;
  const h = Math.max(160, data.length > 0 ? 220 : 160) - margin.top - margin.bottom;

  const bySubcat = d3.rollups(data,
    v => ({ profit: d3.sum(v, d => d.profit), sales: d3.sum(v, d => d.sales) }),
    d => d.subcat
  ).map(([name, v]) => ({
    name,
    margin: v.sales > 0 ? +(v.profit / v.sales * 100).toFixed(1) : 0
  })).sort((a, b) => a.margin - b.margin);

  d3.select('#chart-subcat').selectAll('*').remove();
  if (bySubcat.length === 0) return;

  const svg = d3.select('#chart-subcat').append('svg')
    .attr('viewBox', `0 0 ${w + margin.left + margin.right} ${h + margin.top + margin.bottom}`)
    .style('width', '100%').style('height', 'auto')
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const ext = d3.extent(bySubcat, d => d.margin);
  const xMin = Math.min(ext[0] * 1.1, -5);
  const xMax = Math.max(ext[1] * 1.1,  5);
  const x = d3.scaleLinear().domain([xMin, xMax]).range([0, w]);
  const y = d3.scaleBand().domain(bySubcat.map(d => d.name)).range([0, h]).padding(0.3);

  // Grid lines
  svg.append('g').attr('class', 'grid')
    .selectAll('line').data(x.ticks(5)).enter().append('line')
    .attr('x1', d => x(d)).attr('x2', d => x(d))
    .attr('y1', 0).attr('y2', h)
    .attr('stroke', '#f0eefb').attr('stroke-width', 1);

  // Zero line
  svg.append('line')
    .attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h)
    .attr('stroke', '#9ca3af').attr('stroke-dasharray', '4,3').attr('stroke-width', 1.5);

  function getBarColor(d) {
    if (!anomalyMap.has(d.name)) return d.margin >= 0 ? CHART_COLORS.secondary : CHART_COLORS.red;
    const a = anomalyMap.get(d.name);
    return a.severity === 'severe' ? CHART_COLORS.red : CHART_COLORS.amber;
  }

  svg.selectAll('.bar').data(bySubcat).enter().append('rect')
    .attr('x',      d => d.margin >= 0 ? x(0) : x(d.margin))
    .attr('y',      d => y(d.name))
    .attr('width',  d => Math.max(2, Math.abs(x(d.margin) - x(0))))
    .attr('height', y.bandwidth())
    .attr('fill',   d => getBarColor(d))
    .attr('rx', 3)
    .append('title').text(d => {
      const tag = anomalyMap.has(d.name) ? ` [ANOMALI Z=${anomalyMap.get(d.name).zScore}]` : '';
      return `${d.name}: ${d.margin}%${tag}`;
    });

  // Labels
  svg.selectAll('.bar-lbl').data(bySubcat).enter().append('text')
    .attr('x', d => d.margin >= 0 ? x(d.margin) + 4 : x(d.margin) - 4)
    .attr('y', d => y(d.name) + y.bandwidth() / 2)
    .attr('dominant-baseline', 'middle')
    .attr('text-anchor', d => d.margin >= 0 ? 'start' : 'end')
    .attr('font-size', 10)
    .attr('fill', d => anomalyMap.has(d.name) ? CHART_COLORS.red : CHART_COLORS.text)
    .attr('font-weight', d => anomalyMap.has(d.name) ? '700' : '400')
    .text(d => `${d.margin}%`);

  // Anomaly markers
  bySubcat.filter(d => anomalyMap.has(d.name)).forEach(d => {
    svg.append('text')
      .attr('x', w + 8)
      .attr('y', y(d.name) + y.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 11)
      .text(anomalyMap.get(d.name).severity === 'severe' ? '🔴' : '🟠');
  });

  const yAxis = svg.append('g').call(d3.axisLeft(y).tickSize(0));
  yAxis.select('.domain').remove();
  yAxis.selectAll('text').attr('fill', CHART_COLORS.text).attr('font-size', 11).attr('font-weight', d => anomalyMap.has(d) ? '700' : '400');

  const xAxis = svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(d => `${d}%`));
  styleAxis(xAxis);
}

// ── renderCategoryChart: sales per kategori ───────────────────
function renderCategoryChart(data) {
  const margin = { top: 16, right: 20, bottom: 40, left: 100 };
  const w = 340 - margin.left - margin.right;
  const h = 200 - margin.top  - margin.bottom;

  const byCategory = d3.rollups(data,
    v => d3.sum(v, d => d.sales), d => d.category
  ).map(([cat, val]) => ({ category: cat, sales: val }))
   .sort((a, b) => b.sales - a.sales);

  d3.select('#chart-category').selectAll('*').remove();
  if (byCategory.length === 0) return;

  const svg = d3.select('#chart-category').append('svg')
    .attr('viewBox', `0 0 ${w + margin.left + margin.right} ${h + margin.top + margin.bottom}`)
    .style('width', '100%').style('height', 'auto')
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const catColors = { Bikes: CHART_COLORS.primary, Accessories: CHART_COLORS.teal, Clothing: CHART_COLORS.amber };

  const x = d3.scaleLinear().domain([0, d3.max(byCategory, d => d.sales) * 1.1]).range([0, w]);
  const y = d3.scaleBand().domain(byCategory.map(d => d.category)).range([0, h]).padding(0.35);

  svg.selectAll('.bar').data(byCategory).enter().append('rect')
    .attr('x', 0).attr('y', d => y(d.category))
    .attr('width', d => x(d.sales)).attr('height', y.bandwidth())
    .attr('fill', d => catColors[d.category] || CHART_COLORS.primary)
    .attr('rx', 3)
    .append('title').text(d => `${d.category}: $${(d.sales/1000).toFixed(1)}K`);

  svg.selectAll('.bar-lbl').data(byCategory).enter().append('text')
    .attr('x', d => x(d.sales) + 4).attr('y', d => y(d.category) + y.bandwidth() / 2)
    .attr('dominant-baseline', 'middle').attr('font-size', 10).attr('fill', CHART_COLORS.text)
    .text(d => `$${(d.sales/1000).toFixed(0)}K`);

  const yAxis = svg.append('g').call(d3.axisLeft(y).tickSize(0));
  yAxis.select('.domain').remove();
  styleAxis(yAxis);

  const xAxis = svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
  styleAxis(xAxis);
}

// ── renderTerritoryChart: profit per territory ────────────────
function renderTerritoryChart(data) {
  const margin = { top: 16, right: 20, bottom: 40, left: 110 };
  const w = 340 - margin.left - margin.right;
  const h = 260 - margin.top  - margin.bottom;

  const byTerr = d3.rollups(data,
    v => d3.sum(v, d => d.profit), d => d.territory
  ).map(([t, p]) => ({ territory: t, profit: p }))
   .sort((a, b) => b.profit - a.profit);

  d3.select('#chart-territory').selectAll('*').remove();
  if (byTerr.length === 0) return;

  const svg = d3.select('#chart-territory').append('svg')
    .attr('viewBox', `0 0 ${w + margin.left + margin.right} ${h + margin.top + margin.bottom}`)
    .style('width', '100%').style('height', 'auto')
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const maxAbs = d3.max(byTerr, d => Math.abs(d.profit));
  const x = d3.scaleLinear().domain([-maxAbs * 0.1, maxAbs * 1.1]).range([0, w]);
  const y = d3.scaleBand().domain(byTerr.map(d => d.territory)).range([0, h]).padding(0.25);

  // Zero line
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h)
    .attr('stroke', '#9ca3af').attr('stroke-dasharray', '3,3').attr('stroke-width', 1);

  svg.selectAll('.bar').data(byTerr).enter().append('rect')
    .attr('x', d => d.profit >= 0 ? x(0) : x(d.profit))
    .attr('y', d => y(d.territory))
    .attr('width', d => Math.max(2, Math.abs(x(d.profit) - x(0))))
    .attr('height', y.bandwidth())
    .attr('fill', d => d.profit >= 0 ? CHART_COLORS.green : CHART_COLORS.red)
    .attr('rx', 3)
    .append('title').text(d => `${d.territory}: $${(d.profit/1000).toFixed(1)}K`);

  svg.selectAll('.bar-lbl').data(byTerr).enter().append('text')
    .attr('x', d => d.profit >= 0 ? x(d.profit) + 3 : x(d.profit) - 3)
    .attr('y', d => y(d.territory) + y.bandwidth() / 2)
    .attr('dominant-baseline', 'middle')
    .attr('text-anchor', d => d.profit >= 0 ? 'start' : 'end')
    .attr('font-size', 9).attr('fill', CHART_COLORS.text)
    .text(d => `$${(d.profit/1000).toFixed(0)}K`);

  const yAxis = svg.append('g').call(d3.axisLeft(y).tickSize(0));
  yAxis.select('.domain').remove();
  styleAxis(yAxis);

  const xAxis = svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
  styleAxis(xAxis);
}

// ── renderTrendChart: tren sales + profit bulanan ─────────────
function renderTrendChart(data) {
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const w = 700 - margin.left - margin.right;
  const h = 200 - margin.top  - margin.bottom;

  const byMonth = d3.rollups(data,
    v => ({ sales: d3.sum(v, d => d.sales), profit: d3.sum(v, d => d.profit) }),
    d => `${d.orderDate.getFullYear()}-${String(d.orderDate.getMonth()+1).padStart(2,'0')}`
  ).map(([m, v]) => ({ month: m, ...v }))
   .sort((a, b) => a.month.localeCompare(b.month));

  d3.select('#chart-trend').selectAll('*').remove();
  if (byMonth.length < 2) return;

  const svg = d3.select('#chart-trend').append('svg')
    .attr('viewBox', `0 0 ${w + margin.left + margin.right} ${h + margin.top + margin.bottom}`)
    .style('width', '100%').style('height', 'auto')
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const parseM = d3.timeParse('%Y-%m');
  const months = byMonth.map(d => parseM(d.month));

  const x = d3.scaleTime().domain(d3.extent(months)).range([0, w]);
  const yMax = d3.max(byMonth, d => Math.max(d.sales, d.profit));
  const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([h, 0]);

  // Grid
  svg.append('g').attr('class', 'grid')
    .selectAll('line').data(y.ticks(4)).enter().append('line')
    .attr('x1', 0).attr('x2', w)
    .attr('y1', d => y(d)).attr('y2', d => y(d))
    .attr('stroke', '#f0eefb').attr('stroke-width', 1);

  // Area sales
  const areaSales = d3.area()
    .x((d, i) => x(months[i])).y0(h).y1(d => y(d.sales))
    .curve(d3.curveMonotoneX);
  svg.append('path').datum(byMonth)
    .attr('fill', '#ede9fe').attr('opacity', 0.5).attr('d', areaSales);

  // Line sales
  const lineSales = d3.line()
    .x((d, i) => x(months[i])).y(d => y(d.sales))
    .curve(d3.curveMonotoneX);
  svg.append('path').datum(byMonth)
    .attr('fill', 'none').attr('stroke', CHART_COLORS.primary)
    .attr('stroke-width', 2).attr('d', lineSales);

  // Line profit
  const lineProfit = d3.line()
    .x((d, i) => x(months[i])).y(d => y(d.profit))
    .curve(d3.curveMonotoneX);
  svg.append('path').datum(byMonth)
    .attr('fill', 'none').attr('stroke', CHART_COLORS.green)
    .attr('stroke-width', 1.5).attr('stroke-dasharray', '5,3').attr('d', lineProfit);

  // Axes
  const xAxis = svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %Y')));
  xAxis.selectAll('text').attr('transform', 'rotate(-30)').attr('text-anchor', 'end').attr('font-size', 9).attr('fill', CHART_COLORS.text);
  xAxis.select('.domain').attr('stroke', '#e5e7eb');
  xAxis.selectAll('.tick line').attr('stroke', '#e5e7eb');

  const yAxis = svg.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
  styleAxis(yAxis);

  // Legend
  const lg = svg.append('g').attr('transform', `translate(${w - 140}, 0)`);
  [[CHART_COLORS.primary, 'Sales', false], [CHART_COLORS.green, 'Profit', true]].forEach(([col, lbl, dash], i) => {
    const gx = i * 70;
    lg.append('line').attr('x1', gx).attr('x2', gx+18).attr('y1', 6).attr('y2', 6)
      .attr('stroke', col).attr('stroke-width', 2).attr('stroke-dasharray', dash ? '4,3' : 'none');
    lg.append('text').attr('x', gx+22).attr('y', 10).attr('font-size', 10).attr('fill', CHART_COLORS.text).text(lbl);
  });
}

// ── renderSegmentChart: donut sales per segmen ────────────────
function renderSegmentChart(data) {
  const size = 180;
  const r    = size / 2 - 10;
  const ir   = r * 0.55;

  const bySeg = d3.rollups(data, v => d3.sum(v, d => d.sales), d => d.segment)
    .map(([seg, s]) => ({ seg, sales: s }));

  d3.select('#chart-segment').selectAll('*').remove();
  if (bySeg.length === 0) return;

  const svg = d3.select('#chart-segment').append('svg')
    .attr('viewBox', `0 0 ${size} ${size}`).style('width', '100%').style('height', 'auto')
    .append('g').attr('transform', `translate(${size/2},${size/2})`);

  const segColors = ['#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe', '#059669'];
  const pie = d3.pie().sort(null).value(d => d.sales);
  const arc = d3.arc().innerRadius(ir).outerRadius(r).cornerRadius(3).padAngle(0.02);

  svg.selectAll('.slice').data(pie(bySeg)).enter().append('path')
    .attr('d', arc)
    .attr('fill', (d, i) => segColors[i % segColors.length])
    .append('title').text(d => `${d.data.seg}: $${(d.data.sales/1000).toFixed(1)}K`);

  // Center text
  const total = d3.sum(bySeg, d => d.sales);
  svg.append('text').attr('text-anchor','middle').attr('y', -4).attr('font-size', 13).attr('font-weight', '700').attr('fill', '#1a1d23')
    .text(`$${(total/1000000).toFixed(1)}M`);
  svg.append('text').attr('text-anchor','middle').attr('y', 12).attr('font-size', 9).attr('fill', '#6b7280').text('Total');

  // Legend below — rendered in HTML
  const el = document.getElementById('chart-segment-legend');
  if (el) {
    el.innerHTML = bySeg.map((d, i) => `
      <span class="seg-leg-item">
        <span class="seg-leg-dot" style="background:${segColors[i % segColors.length]}"></span>
        ${d.seg}: <b>$${(d.sales/1000).toFixed(0)}K</b>
      </span>`).join('');
  }
}

// ── renderScatterChart: Sales vs Profit per subkat ────────────
function renderScatterChart(data) {
  const margin = { top: 20, right: 30, bottom: 50, left: 70 };
  const w = 500 - margin.left - margin.right;
  const h = 220 - margin.top  - margin.bottom;

  const bySubcat = d3.rollups(data,
    v => ({
      sales:  d3.sum(v, d => d.sales),
      profit: d3.sum(v, d => d.profit),
      qty:    d3.sum(v, d => d.qty),
      cat:    v[0].category
    }),
    d => d.subcat
  ).map(([name, v]) => ({ name, ...v }));

  d3.select('#chart-scatter').selectAll('*').remove();
  if (bySubcat.length === 0) return;

  const svg = d3.select('#chart-scatter').append('svg')
    .attr('viewBox', `0 0 ${w + margin.left + margin.right} ${h + margin.top + margin.bottom}`)
    .style('width', '100%').style('height', 'auto')
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const catColors = { Bikes: CHART_COLORS.primary, Accessories: CHART_COLORS.teal, Clothing: CHART_COLORS.amber };
  const x = d3.scaleLinear().domain([0, d3.max(bySubcat, d => d.sales) * 1.1]).range([0, w]);
  const y = d3.scaleLinear().domain([d3.min(bySubcat, d => d.profit) * 1.2, d3.max(bySubcat, d => d.profit) * 1.1]).range([h, 0]);
  const rScale = d3.scaleSqrt().domain([0, d3.max(bySubcat, d => d.qty)]).range([6, 30]);

  // Grid
  svg.append('g').selectAll('line').data(y.ticks(4)).enter().append('line')
    .attr('x1', 0).attr('x2', w).attr('y1', d => y(d)).attr('y2', d => y(d))
    .attr('stroke', '#f0eefb').attr('stroke-width', 1);
  svg.append('line').attr('x1',0).attr('x2',w).attr('y1',y(0)).attr('y2',y(0))
    .attr('stroke','#9ca3af').attr('stroke-dasharray','4,3').attr('stroke-width',1);

  svg.selectAll('.dot').data(bySubcat).enter().append('circle')
    .attr('cx', d => x(d.sales)).attr('cy', d => y(d.profit))
    .attr('r', d => rScale(d.qty))
    .attr('fill', d => catColors[d.cat] || CHART_COLORS.primary)
    .attr('opacity', 0.75).attr('stroke', '#fff').attr('stroke-width', 1.5)
    .append('title').text(d => `${d.name}\nSales: $${(d.sales/1000).toFixed(0)}K\nProfit: $${(d.profit/1000).toFixed(0)}K\nQty: ${d.qty.toLocaleString()}`);

  svg.selectAll('.dot-lbl').data(bySubcat).enter().append('text')
    .attr('x', d => x(d.sales)).attr('y', d => y(d.profit) - rScale(d.qty) - 3)
    .attr('text-anchor', 'middle').attr('font-size', 9).attr('fill', CHART_COLORS.text)
    .text(d => d.name);

  const xAxis = svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
  styleAxis(xAxis);
  svg.append('text').attr('x', w/2).attr('y', h + 38).attr('text-anchor','middle').attr('font-size',10).attr('fill',CHART_COLORS.text).text('Sales');

  const yAxis = svg.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
  styleAxis(yAxis);
  svg.append('text').attr('transform','rotate(-90)').attr('x',-h/2).attr('y',-52).attr('text-anchor','middle').attr('font-size',10).attr('fill',CHART_COLORS.text).text('Profit');
}

// ── renderRawAnomalies ────────────────────────────────────────
function renderRawAnomalies(anomalies) {
  const container = document.getElementById('alert-tab-raw');
  if (!container) return;

  const items = [];

  anomalies.profitOutliers.forEach(a => {
    items.push({
      severity: a.severity,
      label:    `Profit Margin Anomali — ${a.name}`,
      detail:   `Margin ${a.margin}%  |  Z-score ${a.zScore}  |  ${a.direction === 'low' ? 'jauh di bawah' : 'jauh di atas'} rata-rata  |  Profit total: $${Number(a.profit).toLocaleString()}`
    });
  });

  anomalies.momSpikes.forEach(a => {
    items.push({
      severity: a.severity,
      label:    `Revenue ${a.direction === 'drop' ? 'Turun' : 'Naik'} Drastis — ${a.month}`,
      detail:   `${a.changePct}% MoM  |  $${Number(a.current).toLocaleString()} vs $${Number(a.previous).toLocaleString()} bulan sebelumnya`
    });
  });

  (anomalies.iqrOutliers?.bySubcat || []).forEach(a => {
    items.push({
      severity: a.severity,
      label:    `Distribusi Tidak Normal — ${a.subcat}`,
      detail:   `${a.count} transaksi outlier  |  rata-rata $${Number(a.avgSales).toLocaleString()}  |  nilai ${a.direction === 'high' ? 'sangat tinggi' : 'sangat rendah'}`
    });
  });

  if (items.length === 0) {
    container.innerHTML = '<p class="placeholder-text">Tidak ada anomali signifikan pada data yang difilter.</p>';
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="alert-item ${item.severity}">
      <div class="ai-dot ${item.severity}"></div>
      <div>
        <div class="ai-label">${item.label}</div>
        <div class="ai-detail">${item.detail}</div>
      </div>
    </div>`).join('');
}

// ── requestAlertNarration ─────────────────────────────────────
async function requestAlertNarration() {
  const btn    = document.getElementById('btn-narrate');
  const output = document.getElementById('ai-narration-output');
  if (!btn || !output) return;

  btn.disabled = true; btn.textContent = '⏳ Memproses...';
  switchAlertTab('ai', document.querySelectorAll('.alert-tab')[1]);
  output.innerHTML = `<p class="loading-text"><span class="spinner-inline"></span>Mengirim anomali ke AI...</p>`;

  try {
    const narration = await narrateAllAlerts(currentAnomalies);
    output.innerHTML = narration.split('\n').filter(l => l.trim())
      .map(l => `<div class="narration-line">${l}</div>`).join('');
  } catch (err) {
    output.innerHTML = `<div class="insight-error">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '🤖 Narasi AI';
  }
}

// ── switchAlertTab ────────────────────────────────────────────
function switchAlertTab(tab, btnEl) {
  document.querySelectorAll('.alert-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.alert-tab-content').forEach(c => c.style.display = 'none');
  if (btnEl) btnEl.classList.add('active');
  const target = document.getElementById('alert-tab-' + tab);
  if (target) target.style.display = 'block';
}

// ── requestInsight ────────────────────────────────────────────
async function requestInsight() {
  const btn    = document.getElementById('btn-insight');
  const output = document.getElementById('insight-output');
  const qEl    = document.getElementById('custom-question');
  if (!btn || !output) return;

  btn.disabled = true; btn.textContent = '⏳ Memproses...';
  output.innerHTML = `<div class="insight-loading"><div class="spinner"></div><span>Mengirim data ke AI...</span></div>`;

  try {
    // Gunakan stats dari data yang sedang difilter
    const result = await getInsight(summaryStats, qEl ? qEl.value.trim() : '');
    output.innerHTML = formatInsight(result);
  } catch (err) {
    output.innerHTML = `<div class="insight-error"><strong>Error:</strong> ${err.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Minta Insight →';
  }
}

function quickAsk(q) {
  const el = document.getElementById('custom-question');
  if (el) el.value = q;
  requestInsight();
}

// ── formatInsight ─────────────────────────────────────────────
function formatInsight(text) {
  let t = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g,     '$1')
    .replace(/^#{1,3}\s*/gm,       '')
    .replace(/^---+$/gm,           '')
    .replace(/`(.+?)`/g,           '$1');

  const lines = t.split('\n');
  let html = '';
  for (const line of lines) {
    const l = line.trim();
    if (!l)            { html += '<div class="insight-gap"></div>'; continue; }
    if (/^\d+\.\s/.test(l)) { html += `<div class="insight-item">${l.replace(/^(\d+\.\s*)/, '<b>$1</b> ')}</div>`; continue; }
    if (/^[*\-]\s/.test(l)) { html += `<div class="insight-bullet">• ${l.replace(/^[*\-]\s+/, '')}</div>`; continue; }
    html += `<div class="insight-line">${l}</div>`;
  }
  return html;
}
