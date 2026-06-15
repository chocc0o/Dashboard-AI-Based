// aiInsight.js — Adventure Works Sales Dashboard
// Modul komunikasi dengan LLM (Ollama / Groq)

// ── Build prompt dari ringkasan data ──────────────────────────
function buildPrompt(stats, focusQuestion = '') {
  const catLines = stats.categories
    .map(c => `  - ${c.category}: Sales $${(c.sales/1000).toFixed(1)}K, Profit $${(c.profit/1000).toFixed(1)}K, Margin ${c.margin}%`)
    .join('\n');

  const terrLines = stats.territories
    .map(r => `  - ${r.territory}: Sales $${(r.sales/1000).toFixed(1)}K, Margin ${r.margin}%`)
    .join('\n');

  const context = `
Berikut adalah ringkasan data penjualan Adventure Works (2001–2004):

KESELURUHAN:
  - Total Sales   : $${Number(stats.totalSales).toLocaleString()}
  - Total Profit  : $${Number(stats.totalProfit).toLocaleString()}
  - Profit Margin : ${stats.overallMargin}%
  - Total Orders  : ${stats.totalOrders}
  - Total Customers: ${stats.totalCustomers}

PERFORMA PER KATEGORI:
${catLines}

PERFORMA PER TERRITORY (diurutkan dari tertinggi):
${terrLines}

Kategori terbaik (margin): ${stats.bestCategory.category} (${stats.bestCategory.margin}%)
Kategori terburuk (margin): ${stats.worstCategory.category} (${stats.worstCategory.margin}%)
`;

  const question = focusQuestion ||
    'Berikan insight bisnis yang paling penting dari data ini dalam 3 poin singkat. ' +
    'Sertakan rekomendasi konkret untuk tiap poin. Gunakan Bahasa Indonesia.';

  return context + '\n---\nPertanyaan: ' + question;
}

// ── Panggil LLM dan dapatkan insight ─────────────────────────
async function getInsight(stats, focusQuestion = '') {
  const prompt = buildPrompt(stats, focusQuestion);
  if (CONFIG.AI_PROVIDER === 'ollama') return await callOllama(prompt);
  return await callGroq(prompt);
}

// ── Implementasi Groq ─────────────────────────────────────────
async function callGroq(prompt) {
  const res = await fetch(CONFIG.GROQ_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: CONFIG.GROQ_MODEL,
      messages: [
        {
          role:    'system',
          content: 'Kamu adalah analis bisnis yang memberi insight singkat, praktis, dan langsung ke poin. Gunakan Bahasa Indonesia.'
        },
        { role: 'user', content: prompt }
      ],
      max_tokens:  600,
      temperature: 0.3
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq error: ${err.error?.message || res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── narrateAlert: narasi satu anomali ────────────────────────
async function narrateAlert(anomaly) {
  const prompt = buildAlertPrompt(anomaly);
  if (CONFIG.AI_PROVIDER === 'ollama') return await callOllama(prompt);
  return await callGroq(prompt);
}

// ── Build prompt untuk satu anomali ──────────────────────────
function buildAlertPrompt(anomaly) {
  let context = '';
  if (anomaly.type === 'profit_outlier') {
    context = `Sub-kategori "${anomaly.name}" memiliki profit margin ${anomaly.margin}% yang sangat ${anomaly.direction === 'low' ? 'rendah' : 'tinggi'} (Z-score: ${anomaly.zScore}, severity: ${anomaly.severity}). Total profit: $${Number(anomaly.profit).toLocaleString()}.`;
  } else if (anomaly.type === 'mom_spike') {
    context = `Revenue bulan ${anomaly.month} mengalami ${anomaly.direction === 'drop' ? 'penurunan' : 'kenaikan'} ${Math.abs(anomaly.changePct)}% MoM. Nilai: $${Number(anomaly.current).toLocaleString()} vs $${Number(anomaly.previous).toLocaleString()} bulan lalu.`;
  } else if (anomaly.type === 'iqr_outlier') {
    context = `Sub-kategori "${anomaly.subcat}" memiliki ${anomaly.count} transaksi outlier (nilai ${anomaly.direction === 'high' ? 'sangat tinggi' : 'sangat rendah'}). Rata-rata nilai: $${Number(anomaly.avgSales).toLocaleString()}.`;
  }
  return `Kamu adalah analis data bisnis. Berikan ALERT singkat (maksimal 2 kalimat) dalam Bahasa Indonesia tentang anomali ini di data penjualan Adventure Works:\n${context}\n\nFormat: mulai dengan angka kunci yang mengejutkan, jelaskan implikasi, satu rekomendasi konkret. Jangan awali dengan kata "Alert:". Langsung ke poin.`;
}

// ── narrateAllAlerts: batch narasi semua anomali ──────────────
async function narrateAllAlerts(anomalies) {
  const allItems = [
    ...anomalies.profitOutliers,
    ...anomalies.momSpikes.slice(0, 3)
  ];
  if (allItems.length === 0) return 'Tidak ada anomali signifikan terdeteksi.';

  const itemLines = allItems.map((a, i) => {
    if (a.type === 'profit_outlier')
      return `${i+1}. [${a.severity.toUpperCase()}] Sub-kategori ${a.name}: margin ${a.margin}% (Z=${a.zScore})`;
    if (a.type === 'mom_spike')
      return `${i+1}. [${a.severity.toUpperCase()}] Revenue ${a.month}: ${a.changePct}% MoM`;
    return `${i+1}. [INFO] IQR outlier di ${a.subcat} (${a.count} transaksi)`;
  }).join('\n');

  const prompt = `Kamu adalah analis data bisnis yang memberi alert singkat dan actionable.
Berikut adalah daftar anomali di data penjualan Adventure Works (Bikes, Accessories, Clothing):

${itemLines}

Untuk setiap anomali, tulis satu kalimat alert dalam Bahasa Indonesia.
Format: "• [nama/bulan]: [fakta mengejutkan] — [rekomendasi singkat]"
Urutkan dari yang paling kritis. Langsung list tanpa preamble.`;

  if (CONFIG.AI_PROVIDER === 'ollama') return await callOllama(prompt);
  return await callGroq(prompt);
}
