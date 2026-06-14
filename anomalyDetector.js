// anomalyDetector.js — Adventure Works Sales Dashboard
// Semua fungsi deteksi anomali
// Depends on: D3.js

// ── Helper statistik ──────────────────────────────────────────
function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}
function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function zScore(value, arr) {
  const s = stdDev(arr);
  return s === 0 ? 0 : (value - mean(arr)) / s;
}
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  return sorted[lo] + (idx - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}

// ── Metode 1: Outlier profit margin per sub-kategori (Z-score) ─
function detectProfitOutliers(data, threshold = 1.5) {
  const bySubcat = d3.rollups(data,
    v => ({
      profit: d3.sum(v, d => d.profit),
      sales:  d3.sum(v, d => d.sales)
    }),
    d => d.subcat
  ).map(([name, v]) => ({
    name,
    profit: v.profit,
    sales:  v.sales,
    margin: v.sales > 0 ? v.profit / v.sales * 100 : 0
  }));

  const margins = bySubcat.map(d => d.margin);

  return bySubcat
    .map(d => {
      const z = zScore(d.margin, margins);
      return {
        type:      'profit_outlier',
        name:      d.name,
        margin:    d.margin.toFixed(1),
        profit:    d.profit.toFixed(0),
        zScore:    z.toFixed(2),
        direction: z > 0 ? 'high' : 'low',
        severity:  Math.abs(z) > 2 ? 'severe' : 'warning',
        isOutlier: Math.abs(z) > threshold
      };
    })
    .filter(d => d.isOutlier)
    .sort((a, b) => +a.zScore - +b.zScore);
}

// ── Metode 2: Perubahan MoM ekstrem ──────────────────────────
function detectMoMSpikes(data, threshold = 25) {
  const byMonth = d3.rollups(data,
    v => d3.sum(v, d => d.sales),
    d => `${d.orderDate.getFullYear()}-${String(d.orderDate.getMonth() + 1).padStart(2, '0')}`
  ).map(([m, s]) => ({ month: m, sales: s }))
   .sort((a, b) => a.month.localeCompare(b.month));

  const result = [];
  for (let i = 1; i < byMonth.length; i++) {
    if (byMonth[i - 1].sales === 0) continue;
    const pct = (byMonth[i].sales - byMonth[i - 1].sales) / Math.abs(byMonth[i - 1].sales) * 100;
    if (Math.abs(pct) >= threshold) {
      result.push({
        type:      'mom_spike',
        month:     byMonth[i].month,
        prevMonth: byMonth[i - 1].month,
        current:   byMonth[i].sales.toFixed(0),
        previous:  byMonth[i - 1].sales.toFixed(0),
        changePct: pct.toFixed(1),
        direction: pct > 0 ? 'spike' : 'drop',
        severity:  Math.abs(pct) >= 40 ? 'severe' : 'warning'
      });
    }
  }
  return result
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);
}

// ── Metode 3: IQR outlier per sub-kategori ────────────────────
function detectIQROutliers(data) {
  const salesVals = data.map(d => d.sales);
  const Q1    = percentile(salesVals, 25);
  const Q3    = percentile(salesVals, 75);
  const IQR   = Q3 - Q1;
  const lower = Q1 - 1.5 * IQR;
  const upper = Q3 + 1.5 * IQR;

  const outliers = data.filter(d => d.sales < lower || d.sales > upper);

  const bySubcat = d3.rollups(outliers,
    v => ({
      count:     v.length,
      avgSales:  +d3.mean(v, d => d.sales).toFixed(0),
      direction: v.filter(d => d.sales > upper).length > v.length / 2 ? 'high' : 'low'
    }),
    d => d.subcat
  ).map(([subcat, v]) => ({
    type: 'iqr_outlier',
    subcat,
    ...v,
    severity: v.count > 10 ? 'warning' : 'info'
  }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 5);

  return {
    fences:        { lower: lower.toFixed(2), upper: upper.toFixed(2) },
    totalOutliers: outliers.length,
    pctOutliers:   (outliers.length / data.length * 100).toFixed(1),
    bySubcat
  };
}

// ── Fungsi utama: jalankan semua deteksi sekaligus ────────────
function detectAllAnomalies(data) {
  const result = {
    profitOutliers: detectProfitOutliers(data),
    momSpikes:      detectMoMSpikes(data),
    iqrOutliers:    detectIQROutliers(data),
    severityCount:  { severe: 0, warning: 0, info: 0 }
  };
  result.severityCount = countSeverity(result);
  return result;
}

// ── Hitung severity count ─────────────────────────────────────
function countSeverity(anomalies) {
  const all = [
    ...anomalies.profitOutliers,
    ...anomalies.momSpikes,
    ...(anomalies.iqrOutliers?.bySubcat || [])
  ];
  return {
    severe:  all.filter(d => d.severity === 'severe').length,
    warning: all.filter(d => d.severity === 'warning').length,
    info:    all.filter(d => d.severity === 'info').length
  };
}
