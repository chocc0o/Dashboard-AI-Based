// storyEngine.js — Adventure Works Sales Dashboard
// Menyusun narasi SCR dari summary + anomali

// ── Generate judul naratif ────────────────────────────────────
async function generateTitle(summary, anomalies) {
  const severeCount = anomalies.profitOutliers.filter(a => a.severity === 'severe').length
    + anomalies.momSpikes.filter(a => a.severity === 'severe').length;

  const worstProfit = anomalies.profitOutliers[0] || null;
  const worstMoM    = anomalies.momSpikes[0] || null;

  let anomalyHint = '';
  if (worstProfit) anomalyHint += `Anomali: ${worstProfit.name} margin ${worstProfit.margin}% (Z=${worstProfit.zScore}). `;
  if (worstMoM)    anomalyHint += `Revenue ${worstMoM.month} berubah ${worstMoM.changePct}% MoM.`;

  const prompt =
    `Data penjualan Adventure Works (Bikes, Accessories, Clothing):\n` +
    `- Total Sales: $${Number(summary.totalSales).toLocaleString()}, Margin: ${summary.overallMargin}%\n` +
    `- Anomali kritis: ${severeCount}\n` +
    `- ${anomalyHint}\n\n` +
    `Tulis SATU judul dashboard dalam Bahasa Indonesia.\n` +
    `Judul harus naratif (mengandung insight, bukan deskriptif).\n` +
    `Maksimal 12 kata. Format: fakta kunci + implikasi atau rekomendasi.\n` +
    `Contoh baik: "Clothing Rugi 2% — Harga Pokok Perlu Ditinjau Ulang"\n` +
    `Contoh buruk: "Dashboard Penjualan Adventure Works 2001-2004"\n` +
    `Tulis judulnya saja, tanpa tanda kutip dan tanpa penjelasan lain.`;

  if (CONFIG.AI_PROVIDER === 'ollama') return await callOllama(prompt);
  return await callGroq(prompt);
}

// ── Generate full story format SCR ───────────────────────────
async function generateStory(summary, anomalies) {
  const catLines = summary.categories
    .map(c => `  - ${c.category}: sales $${(c.sales/1000).toFixed(0)}K, margin ${c.margin}%`)
    .join('\n');

  const profitLines = anomalies.profitOutliers.length
    ? anomalies.profitOutliers.map(a => `  - ${a.name}: margin ${a.margin}% (Z=${a.zScore}, ${a.severity})`).join('\n')
    : '  Tidak ada';

  const momLines = anomalies.momSpikes.length
    ? anomalies.momSpikes.slice(0, 3).map(a => `  - ${a.month}: ${a.changePct}% MoM (${a.severity})`).join('\n')
    : '  Tidak ada';

  const prompt =
    `Kamu adalah analis bisnis senior yang menulis ringkasan eksekutif.\n` +
    `Berdasarkan data Adventure Works berikut, tulis narasi bisnis format SCR:\n\n` +
    `DATA KESELURUHAN:\n` +
    `  Total Sales: $${Number(summary.totalSales).toLocaleString()}\n` +
    `  Total Profit: $${Number(summary.totalProfit).toLocaleString()}\n` +
    `  Profit Margin: ${summary.overallMargin}%\n` +
    `  Total Orders: ${summary.totalOrders}\n\n` +
    `PERFORMA PER KATEGORI:\n${catLines}\n\n` +
    `ANOMALI PROFIT MARGIN:\n${profitLines}\n\n` +
    `ANOMALI PERUBAHAN BULANAN:\n${momLines}\n\n` +
    `Tulis dalam Bahasa Indonesia dengan FORMAT PERSIS:\n\n` +
    `SETUP\n[1-2 kalimat konteks bisnis saat ini]\n\n` +
    `CONFLICT\n[1-2 kalimat masalah/anomali paling kritis]\n\n` +
    `RESOLUTION\n[1-2 kalimat rekomendasi konkret]\n\n` +
    `Gunakan angka spesifik. Maksimal 6 kalimat total. Langsung ke poin.`;

  if (CONFIG.AI_PROVIDER === 'ollama') return await callOllama(prompt);
  return await callGroq(prompt);
}

// ── Parse respons LLM ke objek SCR ───────────────────────────
function parseStoryResponse(text) {
  const result = { setup: '', conflict: '', resolution: '', raw: text };

  const setupMatch    = text.match(/\*{0,2}SETUP\*{0,2}[\s\S]*?\n([\s\S]*?)(?=\*{0,2}CONFLICT|\*{0,2}RESOLUTION|$)/i);
  const conflictMatch = text.match(/\*{0,2}CONFLICT\*{0,2}[\s\S]*?\n([\s\S]*?)(?=\*{0,2}RESOLUTION|\*{0,2}SETUP|$)/i);
  const resolveMatch  = text.match(/\*{0,2}RESOLUTION\*{0,2}[\s\S]*?\n([\s\S]*?)(?=\*{0,2}SETUP|\*{0,2}CONFLICT|$)/i);

  if (setupMatch)    result.setup      = setupMatch[1].trim();
  if (conflictMatch) result.conflict   = conflictMatch[1].trim();
  if (resolveMatch)  result.resolution = resolveMatch[1].trim();

  if (!result.setup && !result.conflict && !result.resolution) {
    result.setup = text.trim();
  }
  return result;
}
