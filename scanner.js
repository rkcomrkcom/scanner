const API = 'https://fapi.binance.com';
const $ = s => document.querySelector(s);
const j = async p => { const r = await fetch(API + p); if (!r.ok) throw new Error(r.status); return r.json(); };
const TFS = ['5m', '15m', '1h', '4h', '1d'];
let tf = localStorage.tf || '1h';
const cfg = Object.assign({ minVol: 50, minAtr: 0.4, volMult: 2, look: 20 }, JSON.parse(localStorage.cfg || '{}'));
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
  const live = +k[k.length - 1][4]; k = k.slice(0, -1); // สัญญาณหลักใช้แท่งที่ปิดแล้ว
  const h = k.map(x => +x[2]), l = k.map(x => +x[3]), c = k.map(x => +x[4]), v = k.map(x => +x[5]);
  const n = cfg.look, last = c.length - 1;
  const vr = v[last] / (v.slice(-n - 1, -1).reduce((s, x) => s + x, 0) / n);
  const hi = Math.max(...h.slice(-n - 1, -1)), lo = Math.min(...l.slice(-n - 1, -1));
  const up = ema(c, 20)[last] > ema(c, 50)[last], ax = adx(h, l, c), r = rsi(c);
  let s = 0, dir = up ? 'LONG' : 'SHORT'; const why = [];
  if (vr >= cfg.volMult) { s += 2; why.push('วอลุ่ม x' + vr.toFixed(1)); }
  if (c[last] > hi) { s += 2; dir = 'LONG'; why.push('ทะลุ High ' + n + ' แท่ง'); }
  else if (c[last] < lo) { s += 2; dir = 'SHORT'; why.push('หลุด Low ' + n + ' แท่ง'); }
  else if (live > Math.max(hi, h[last])) { s += 1; dir = 'LONG'; why.push('กำลังทะลุ High (แท่งยังไม่ปิด)'); }
  else if (live < Math.min(lo, l[last])) { s += 1; dir = 'SHORT'; why.push('กำลังหลุด Low (แท่งยังไม่ปิด)'); }
  if (ax > 25 && (dir === 'LONG') === up) { s += 1; why.push('เทรนด์ ADX ' + ax.toFixed(0)); }
  if (Math.abs(f) >= 0.05) { s += 1; why.push('Funding ' + f.toFixed(3) + '%'); }
  const trs = c.slice(-14).map((_, i) => { const q = c.length - 14 + i; return Math.max(h[q] - l[q], Math.abs(h[q] - c[q - 1]), Math.abs(l[q] - c[q - 1])); });
  const atr = trs.reduce((a, x) => a + x, 0) / 14, atrp = atr / c[last] * 100;
  why.push('ATR ' + atrp.toFixed(2) + '%');
  const warn = [r > 75 ? 'RSI สูง ระวังกลับตัว' : r < 25 ? 'RSI ต่ำ ระวังกลับตัว' : '', atrp < cfg.minAtr ? 'ATR ต่ำ อาจไม่คุ้มค่าธรรมเนียม' : '',
    Math.abs(c[last] - ema(c, 20)[last]) > 2.5 * atr ? 'ไกลจาก EMA20 ระวังไล่ราคา' : ''].filter(Boolean).join(' | ');
  return { sym: t.symbol, price: +t.lastPrice, chg: +t.priceChangePercent, s, dir, why, warn, spark: c.slice(-48) };
}

let info = { t: 0, set: new Set() }, prevSet = null, note = '';
async function tradable() {
  if (Date.now() - info.t > 6e5) {
    const d = await j('/fapi/v1/exchangeInfo');
    info = { t: Date.now(), set: new Set(d.symbols.filter(x => x.status === 'TRADING' && x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT').map(x => x.symbol)) };
  }
  return info.set;
}
function noteChanges(s) {
  if (prevSet) {
    const add = [...s].filter(x => !prevSet.has(x)), del = [...prevSet].filter(x => !s.has(x));
    if (add.length || del.length) note = (add.length ? ' | เหรียญใหม่: ' + add.join(', ') : '') + (del.length ? ' | ถูกถอน: ' + del.join(', ') : '');
  }
  prevSet = new Set(s);
}

async function scan(force) {
  if (!force && cache[tf] && Date.now() - cache[tf].t < 9e4) return render(cache[tf].d);
  $('#status').textContent = 'กำลังสแกน…';
  try {
    const [tk, pi, ok] = await Promise.all([j('/fapi/v1/ticker/24hr'), j('/fapi/v1/premiumIndex'), tradable()]);
    const fr = {}; pi.forEach(x => fr[x.symbol] = +x.lastFundingRate * 100);
    const cand = tk.filter(t => ok.has(t.symbol) && +t.quoteVolume >= cfg.minVol * 1e6)
      .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 80);
    noteChanges(ok);
    const out = []; let i = 0;
    await Promise.all(Array(8).fill(0).map(async () => {
      while (i < cand.length) {
        const t = cand[i++];
        try { out.push(analyze(t, await j(`/fapi/v1/klines?symbol=${t.symbol}&interval=${tf}&limit=100`), fr[t.symbol] || 0)); } catch (e) {}
      }
    }));
    await Promise.all(out.filter(x => x.s >= 2).map(async x => {
      try {
        const c4 = (await j(`/fapi/v1/klines?symbol=${x.sym}&interval=4h&limit=60`)).slice(0, -1).map(q => +q[4]);
        const u4 = ema(c4, 20).at(-1) > ema(c4, 50).at(-1);
        if ((x.dir === 'LONG') === u4) { x.s += 1; x.why.push('4h ตรงทิศ'); } else x.warn += (x.warn ? ' | ' : '') + '4h สวนทาง';
      } catch (e) {}
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
  const at = new Date().toLocaleTimeString('th-TH');
  $('#status').textContent = (d.length ? `${d.length} เหรียญเข้าเงื่อนไข (TF ${tf})` : 'ไม่มีเหรียญเข้าเงื่อนไขใน TF นี้ ลองลดเงื่อนไขในตั้งค่า') + ` | อัปเดต ${at}` + note;
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
const F = [['minVol', 'วอลุ่ม 24 ชม. ขั้นต่ำ (ล้าน USDT)'], ['minAtr', 'ATR ขั้นต่ำ (% ของราคา) ต่ำกว่านี้จะเตือน'], ['volMult', 'วอลุ่มพุ่งกี่เท่าของค่าเฉลี่ย'], ['look', 'จำนวนแท่งย้อนหลัง (Breakout)']];
$('#cfgBody').innerHTML = F.map(([k, t]) => `<label>${t}<input type="number" step="any" data-k="${k}" value="${cfg[k]}"></label>`).join('');
$('#cfgBody').onchange = e => {
  cfg[e.target.dataset.k] = +e.target.value; localStorage.cfg = JSON.stringify(cfg);
  for (const k in cache) delete cache[k];
  scan(true);
};
$('#list').onclick = e => { const r = e.target.closest('.row'); if (r) openCoin(r.dataset.s); };
scan(); setInterval(() => scan(true), 3e5);
