/**
 * K 线图（年/月/日/小时）
 */
function drawKlineChart(container, klines, options = {}) {
  if (!container) return;

  const bars = (klines || []).filter(
    (b) => b && b.open != null && b.close != null && b.high != null && b.low != null
  );
  if (bars.length < 2) {
    container.innerHTML = '<div class="chart-empty">K线数据不足，无法绘制</div>';
    return;
  }

  const viewCount = Math.min(options.viewCount || 120, bars.length);
  const offset = Math.max(
    0,
    Math.min(options.offset ?? bars.length - viewCount, bars.length - viewCount)
  );
  const visible = bars.slice(offset, offset + viewCount);

  const width = options.width || container.clientWidth || 900;
  const height = options.height || 360;
  const pad = { top: 20, right: 16, bottom: 48, left: 72 };
  const volH = 56;
  const priceH = height - pad.top - pad.bottom - volH - 8;
  const innerW = width - pad.left - pad.right;

  const allHigh = Math.max(...visible.map((b) => b.high));
  const allLow = Math.min(...visible.map((b) => b.low));
  const range = allHigh - allLow || 1;
  const maxVol = Math.max(...visible.map((b) => b.volume || 0), 1);

  const slot = innerW / visible.length;
  const bodyW = Math.max(2, Math.min(12, slot * 0.65));

  const yPrice = (v) => pad.top + priceH - ((v - allLow) / range) * priceH;
  const yVol = (v) => pad.top + priceH + 8 + volH - (v / maxVol) * volH;

  const fmt = (n) =>
    n.toLocaleString('zh-CN', { maximumFractionDigits: n >= 1000 ? 0 : 2 });

  let candles = '';
  let volumes = '';

  visible.forEach((b, i) => {
    const x = pad.left + i * slot + slot / 2;
    const up = b.close >= b.open;
    const color = up ? '#f87171' : '#34d399';
    const yHigh = yPrice(b.high);
    const yLow = yPrice(b.low);
    const yOpen = yPrice(b.open);
    const yClose = yPrice(b.close);
    const top = Math.min(yOpen, yClose);
    const h = Math.max(1, Math.abs(yClose - yOpen));

    candles += `<line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1"/>`;
    candles += `<rect x="${(x - bodyW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bodyW}" height="${h.toFixed(2)}" fill="${color}"/>`;

    if (b.volume > 0) {
      const vh = Math.max(1, (b.volume / maxVol) * volH);
      volumes += `<rect x="${(x - bodyW / 2).toFixed(2)}" y="${(yVol(b.volume)).toFixed(2)}" width="${bodyW}" height="${vh.toFixed(2)}" fill="${color}" opacity="0.45"/>`;
    }
  });

  const yTicks = [allLow, allLow + range / 2, allHigh];
  const grid = yTicks
    .map((v) => {
      const y = yPrice(v).toFixed(2);
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid"/>
        <text x="${pad.left - 6}" y="${(+y + 4).toFixed(2)}" class="chart-axis-label" text-anchor="end">${fmt(v)}</text>`;
    })
    .join('');

  const labelStep = Math.max(1, Math.floor(visible.length / 6));
  let xLabels = '';
  for (let i = 0; i < visible.length; i += labelStep) {
    const x = pad.left + i * slot + slot / 2;
    const lbl = String(visible[i].date).slice(0, 10);
    xLabels += `<text x="${x}" y="${height - 18}" class="chart-axis-label" text-anchor="middle">${lbl}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="trend-chart-svg" preserveAspectRatio="none">
    ${grid}
    <line x1="${pad.left}" y1="${(pad.top + priceH + 4).toFixed(2)}" x2="${width - pad.right}" y2="${(pad.top + priceH + 4).toFixed(2)}" stroke="#2d3a4f" stroke-width="1"/>
    ${candles}
    ${volumes}
    ${xLabels}
    <text x="${pad.left}" y="${(pad.top + priceH + 22).toFixed(2)}" class="chart-axis-label">成交量</text>
  </svg>`;

  return { offset, viewCount, total: bars.length };
}

if (typeof window !== 'undefined') {
  window.drawKlineChart = drawKlineChart;
}

if (typeof module !== 'undefined') {
  module.exports = { drawKlineChart };
}
