const API = 'https://fapi.binance.com';
const $ = s => document.querySelector(s);
const j = async p => { const r = await fetch(API + p); if (!r.ok) throw new Error(r.status); return r.json(); };
const TFS = ['5m', '15m', '1h', '4h', '1d'];
let tf = localStorage.tf || '1h';
const cfg = Object.assign({ minVol: 50, minChg: 3, volMult: 2, look: 20 }, JSON.parse(localStorage.cfg || '{}'));
const cache = {};

const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map(v => e = v * k + e * (1 - k)); };
const rsi = (c, n = 14) => {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l ? 100 - 100 / (1 + g / l) : 100;
};
const adx = (h, l, c, n = 14) => {
  let tr = 0, p = 0, m = 0; const dx = [];
  for (let i = 1; i < c.length; i++) {
    const t = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    const u = h[i] - h[i - 1], d = l[i - 1] - l[i];
    const P = u > d && u > 0 ? u : 0, M = d > u && d > 0 ? d : 0;
    if (i <= n) { tr += t; p += P; m += M; } else { tr = tr - tr / n + t; p = p - p / n + P; m = m - m / n + M; }
    if (i >= n) { const pi = 100 * p / tr, mi = 100 * m / tr; dx.push(100 * Math.abs(pi - mi) / ((pi + mi) || 1)); }
  }
  let a = dx.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
  return a;
};

function analyze(t, k, f) {
  const h = k.map(x => +x[2]), l = k.map(x => +x[3]), c = k.map(x => +x[4]), v = k.map(x => +x[5]);
  const n = cfg.look, last = c.length - 1;
  const vr = v[last] / (v.slice(-n - 1, -1).reduce((s, x) => s + x, 0) / n);
  const hi = Math.max(...h.slice(-n - 1, -1)), lo = Math.min(...l.slice(-n - 1, -1));
  const up = ema(c, 20)[last] > ema(c, 50)[last], ax = adx(h, l, c), r = rsi(c);
  let s = 0, dir = up ? 'LONG' : 'SHORT'; const why = [];
  if (vr >= cfg.volMult) { s += 2; why.push('วอลุ่ม x' + vr.toFixed(1)); }
  if (c[last] > hi) { s += 2; dir = 'LONG'; why.push('ทะลุ High ' + n + ' แท่ง'); }
  else if (c[last] < lo) { s += 2; dir = 'SHORT'; why.push('หลุด Low ' + n + ' แท่ง'); }
  if (ax > 25 && (dir === 'LONG') === up) { s += 1; why.push('เทรนด์ ADX ' + ax.toFixed(0)); }
  if (Math.abs(f) >= 0.05) { s += 1; why.push('Funding ' + f.toFixed(3) + '%'); }
  const warn = r > 75 ? 'RSI สูง ระวังกลับตัว' : r < 25 ? 'RSI ต่ำ ระวังกลับตัว' : '';
  return { sym: t.symbol, price: +t.lastPrice, chg: +t.priceChangePercent, s, dir, why, warn, spark: c.slice(-48) };
}

async function scan(force) {
  if (!force && cache[tf] && Date.now() - cache[tf].t < 9e4) return render(cache[tf].d);
  $('#status').textContent = 'กำลังสแกน…';
  try {
    const [tk, pi] = await Promise.all([j('/fapi/v1/ticker/24hr'), j('/fapi/v1/premiumIndex')]);
    const fr = {}; pi.forEach(x => fr[x.symbol] = +x.lastFundingRate * 100);
    const cand = tk.filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume >= cfg.minVol * 1e6 && Math.abs(+t.priceChangePercent) >= cfg.minChg)
      .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40);
    const out = []; let i = 0;
    await Promise.all(Array(8).fill(0).map(async () => {
      while (i < cand.length) {
        const t = cand[i++];
        try { out.push(analyze(t, await j(`/fapi/v1/klines?symbol=${t.symbol}&interval=${tf}&limit=100`), fr[t.symbol] || 0)); } catch (e) {}
      }
    }));
    out.sort((a, b) => b.s - a.s);
    cache[tf] = { t: Date.now(), d: out };
    render(out);
  } catch (e) {
    $('#status').textContent = 'ดึงข้อมูลไม่สำเร็จ (' + e.message + ') ตรวจว่าเครือข่ายเข้า Binance ได้ แล้วกดสแกนใหม่';
  }
}

function spark(a, up) {
  const mn = Math.min(...a), mx = Math.max(...a), w = 96, h = 32;
  const pts = a.map((x, i) => (i * w / (a.length - 1)).toFixed(1) + ',' + (h - (x - mn) / ((mx - mn) || 1) * h).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}"><polyline fill="none" stroke="${up ? '#3fb68b' : '#e5605b'}" stroke-width="1.5" points="${pts}"/></svg>`;
}

function render(d) {
  d = d.filter(x => x.s >= 2);
  $('#status').textContent = d.length ? `${d.length} เหรียญเข้าเงื่อนไข (TF ${tf})` : 'ไม่มีเหรียญเข้าเงื่อนไขใน TF นี้ ลองลดเงื่อนไขในตั้งค่า';
  $('#list').innerHTML = d.map(x => `<div class="row" data-s="${x.sym}"><b>${x.sym.replace('USDT', '')}</b>
    <span class="tag ${x.dir}">${x.dir === 'LONG' ? 'Long' : 'Short'}</span>${spark(x.spark, x.spark.at(-1) >= x.spark[0])}
    <span class="px">${x.price}<i class="${x.chg >= 0 ? 'up' : 'dn'}">${x.chg.toFixed(1)}%</i></span><span class="sc">${x.s}</span>
    <small>${x.why.join(' + ')}${x.warn ? ' | ' + x.warn : ''}</small></div>`).join('');
}

$('#tfs').innerHTML = TFS.map(x => `<button data-tf="${x}" class="${x === tf ? 'on' : ''}">${x}</button>`).join('');
$('#tfs').onclick = e => {
  const b = e.target.dataset.tf; if (!b) return;
  tf = localStorage.tf = b;
  document.querySelectorAll('#tfs button').forEach(x => x.classList.toggle('on', x.dataset.tf === b));
  scan();
};
$('#rescan').onclick = () => scan(true);
const F = [['minVol', 'วอลุ่ม 24 ชม. ขั้นต่ำ (ล้าน USDT)'], ['minChg', 'ราคาเปลี่ยน 24 ชม. ขั้นต่ำ (%)'], ['volMult', 'วอลุ่มพุ่งกี่เท่าของค่าเฉลี่ย'], ['look', 'จำนวนแท่งย้อนหลัง (Breakout)']];
$('#cfgBody').innerHTML = F.map(([k, t]) => `<label>${t}<input type="number" step="any" data-k="${k}" value="${cfg[k]}"></label>`).join('');
$('#cfgBody').onchange = e => {
  cfg[e.target.dataset.k] = +e.target.value; localStorage.cfg = JSON.stringify(cfg);
  for (const k in cache) delete cache[k];
  scan(true);
};
$('#list').onclick = e => { const r = e.target.closest('.row'); if (r) openCoin(r.dataset.s); };
scan();
