const S = JSON.parse(localStorage.paper || '{"bal":10000,"pos":[],"hist":[]}');
const save = () => localStorage.paper = JSON.stringify(S);
const CH = ['60', '15', '5', '1'];
const FEE = 0.0005;
let cur = null, px = {};
const msg = t => $('#msg').textContent = t;

function openCoin(sym) {
  cur = sym; msg('');
  $('#coin').hidden = false; $('#cname').textContent = sym;
  $('#charts').innerHTML = CH.map((_, i) => `<div id="tv${i}"></div>`).join('');
  CH.forEach((iv, i) => new TradingView.widget({
    container_id: 'tv' + i, symbol: 'BINANCE:' + sym + '.P', interval: iv, theme: 'dark',
    autosize: true, hide_side_toolbar: true, allow_symbol_change: false, timezone: 'Asia/Bangkok', locale: 'th_TH'
  }));
  tick();
}

function place(side) {
  const p = px[cur], m = +$('#mg').value, lv = +$('#lv').value, tp = +$('#tp').value || 0, sl = +$('#sl').value || 0;
  if (!p || !(m > 0) || !(lv >= 1)) return msg('กรอกมาร์จิ้นและ Leverage ให้ถูกต้อง');
  const fee = m * lv * FEE;
  if (m + fee > S.bal) return msg('เงินในพอร์ตไม่พอ');
  const L = side === 'LONG';
  if ((tp && (L ? tp <= p : tp >= p)) || (sl && (L ? sl >= p : sl <= p))) return msg('TP/SL อยู่ผิดฝั่งของราคาเข้า');
  const liq = p * (L ? 1 - 1 / lv + 0.005 : 1 + 1 / lv - 0.005);
  S.bal -= m + fee;
  S.pos.push({ id: Date.now(), sym: cur, side, entry: p, qty: m * lv / p, m, lv, tp, sl, liq });
  save(); msg(''); draw();
}

function close(id, why, at) {
  const i = S.pos.findIndex(x => x.id == id); if (i < 0) return;
  const o = S.pos[i], p = at ?? px[o.sym];
  const pnl = (o.side === 'LONG' ? p - o.entry : o.entry - p) * o.qty;
  const back = why === 'Liquidated' ? 0 : Math.max(0, o.m + pnl - o.qty * p * FEE);
  S.bal += back;
  S.hist.unshift({ sym: o.sym, side: o.side, pnl: back - o.m, why });
  S.hist = S.hist.slice(0, 50);
  S.pos.splice(i, 1); save();
}

async function tick() {
  try {
    const n = {}; (await j('/fapi/v1/ticker/price')).forEach(x => n[x.symbol] = +x.price);
    if (Object.keys(n).length > 100) S.pos.slice().forEach(o => { if (!(o.sym in n) && px[o.sym]) close(o.id, 'Delisted', px[o.sym]); });
    px = n;
    S.pos.slice().forEach(o => {
      const p = px[o.sym], L = o.side === 'LONG'; if (!p) return;
      if (L ? p <= o.liq : p >= o.liq) close(o.id, 'Liquidated', o.liq);
      else if (o.sl && (L ? p <= o.sl : p >= o.sl)) close(o.id, 'SL', o.sl);
      else if (o.tp && (L ? p >= o.tp : p <= o.tp)) close(o.id, 'TP', o.tp);
    });
    draw();
  } catch (e) {}
}

function draw() {
  let up = 0;
  const rows = S.pos.map(o => {
    const p = px[o.sym] || o.entry, pnl = (o.side === 'LONG' ? p - o.entry : o.entry - p) * o.qty; up += pnl;
    return `<div class="prow"><b>${o.sym.replace('USDT', '')}</b> <span class="tag ${o.side}">${o.side === 'LONG' ? 'Long' : 'Short'} x${o.lv}</span><br>
      เข้า ${o.entry} | ตอนนี้ ${p} | Liq ${+o.liq.toPrecision(6)}${o.tp ? ' | TP ' + o.tp : ''}${o.sl ? ' | SL ' + o.sl : ''}<br>
      <i class="${pnl >= 0 ? 'up' : 'dn'}">${pnl.toFixed(2)} USDT (${(pnl / o.m * 100).toFixed(1)}%)</i> <button data-c="${o.id}">ปิดออเดอร์</button></div>`;
  }).join('') || '<div class="prow">ยังไม่มีออเดอร์ที่เปิดอยู่</div>';
  const hist = S.hist.slice(0, 5).map(h => `<div class="prow">${h.sym.replace('USDT', '')} ${h.side === 'LONG' ? 'Long' : 'Short'} ${h.why || 'ปิดเอง'}: <i class="${h.pnl >= 0 ? 'up' : 'dn'}">${h.pnl.toFixed(2)}</i></div>`).join('');
  const eq = S.bal + S.pos.reduce((s, o) => s + o.m, 0) + up;
  $('#acct').textContent = `พอร์ตจำลอง ${eq.toFixed(2)} USDT (ว่าง ${S.bal.toFixed(2)})`;
  document.querySelectorAll('.posbox').forEach(e => e.innerHTML = rows + (hist ? '<div class="prow"><b>ปิดล่าสุด</b></div>' + hist : ''));
  if (cur && px[cur]) $('#cpx').textContent = px[cur];
}

document.addEventListener('click', e => {
  const c = e.target.dataset.c; if (c) { close(c); draw(); }
});
$('#bl').onclick = () => place('LONG');
$('#bs').onclick = () => place('SHORT');
$('#back').onclick = () => { $('#coin').hidden = true; cur = null; $('#charts').innerHTML = ''; };
$('#reset').onclick = () => { if (confirm('รีเซ็ตพอร์ตและลบออเดอร์ทั้งหมด?')) { S.bal = 10000; S.pos = []; S.hist = []; save(); draw(); } };
setInterval(tick, 3000); tick(); draw();
