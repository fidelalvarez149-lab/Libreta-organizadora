(() => {
'use strict';

/* ───────── Utilidades ───────── */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const mkey = s => s.slice(0, 7);
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MCORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const nf = (n, d = 2) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const clone = o => JSON.parse(JSON.stringify(o));

function parseAmt(v) {
  let s = String(v ?? '').replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}

/* ───────── Datos (guardados en el dispositivo) ───────── */
const KEY = 'libreta.v1';
const DEF = {
  tx: [], debts: [],
  set: { theme: 'auto', rateMode: 'auto', manualRate: null, hide: false },
  rate: { value: 37, ts: 0, src: 'aprox.' }
};
let db = load();
function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && typeof r === 'object') {
      const d = clone(DEF);
      return { ...d, ...r, tx: Array.isArray(r.tx) ? r.tx : [], debts: Array.isArray(r.debts) ? r.debts : [],
        set: { ...d.set, ...(r.set || {}) }, rate: { ...d.rate, ...(r.rate || {}) } };
    }
  } catch (e) { /* datos dañados: empezar limpio */ }
  return clone(DEF);
}
let persistAsked = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('⚠️ No se pudo guardar: almacenamiento lleno'); }
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true; navigator.storage.persist().catch(() => {});
  }
}

/* ───────── Moneda y tasa del dólar ───────── */
const rate = () => (db.set.rateMode === 'manual' && db.set.manualRate > 0) ? db.set.manualRate : db.rate.value;
const toNIO = (a, c) => c === 'USD' ? a * rate() : a;
const toUSD = (a, c) => c === 'USD' ? a : a / rate();
const sym = c => c === 'USD' ? 'US$' : 'C$';
const money = (n, c) => db.set.hide ? `${sym(c)} ••••` : `${sym(c)} ${nf(n)}`;
const other = (a, c) => c === 'NIO' ? { v: a / rate(), c: 'USD' } : { v: a * rate(), c: 'NIO' };
const eqTxt = (a, c) => { const o = other(a, c); return '≈ ' + money(o.v, o.c); };
const ago = ts => {
  if (!ts) return 'valor aproximado, aún sin actualizar';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'actualizada ahora';
  if (m < 60) return `actualizada hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `actualizada hace ${h} h`;
  return `actualizada hace ${Math.round(h / 24)} d`;
};

let fetching = false;
async function fetchRate(manual) {
  if (fetching) return;
  if (!navigator.onLine) { if (manual) toast('Sin internet: se usa la última tasa guardada'); return; }
  fetching = true; spinRate(true);
  const urls = [
    'https://open.er-api.com/v6/latest/USD',
    'https://api.exchangerate-api.com/v4/latest/USD',
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'
  ];
  let ok = false;
  for (const u of urls) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
      const r = await fetch(u, { signal: c.signal, cache: 'no-store' }); clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      const v = (j.rates && j.rates.NIO) || (j.usd && j.usd.nio);
      if (v > 0) { db.rate = { value: +(+v).toFixed(4), ts: Date.now(), src: new URL(u).hostname }; save(); ok = true; break; }
    } catch (e) { /* probar siguiente fuente */ }
  }
  fetching = false; spinRate(false);
  if (ok) { render(true); if (manual) toast('✅ Tasa del dólar actualizada'); }
  else if (manual) toast('No se pudo actualizar; se mantiene la última tasa');
}
function spinRate(on) { document.querySelectorAll('[data-act="refresh-rate"]').forEach(b => b.classList.toggle('spin', on)); }
function staleRate(h) { return db.set.rateMode === 'auto' && (Date.now() - db.rate.ts) > h * 3600e3; }

/* ───────── Cálculos ───────── */
const CATS_IN = [['Salario', '💼'], ['Negocio', '🏪'], ['Ventas', '🛍️'], ['Freelance', '💻'], ['Regalo', '🎁'], ['Cobro de deuda', '🤝'], ['Otro', '✨']];
const CATS_OUT = [['Comida', '🍽️'], ['Transporte', '🚌'], ['Combustible', '⛽'], ['Casa', '🏠'], ['Servicios', '💡'], ['Salud', '💊'], ['Educación', '🎓'], ['Ocio', '🎬'], ['Ropa', '👕'], ['Pago de deuda', '💳'], ['Otro', '🧾']];
const catIco = (n, t) => ((t === 'in' ? CATS_IN : CATS_OUT).find(c => c[0] === n) || [0, '🏷️'])[1];

function monthTotals(mk) {
  let i = 0, o = 0;
  for (const t of db.tx) if (mkey(t.date) === mk) { const n = toNIO(t.amount, t.cur); t.type === 'in' ? i += n : o += n; }
  return { i, o };
}
const paidOf = d => (d.payments || []).reduce((s, p) => s + p.amount, 0);
const leftOf = d => Math.max(0, d.amount - paidOf(d));
function debtTotals() {
  let owe = 0, owed = 0, late = 0;
  for (const d of db.debts) {
    if (d.closed) continue;
    const n = toNIO(leftOf(d), d.cur);
    d.dir === 'owe' ? owe += n : owed += n;
    if (d.due && d.due < today()) late++;
  }
  return { owe, owed, late };
}
const shiftMonth = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return `${MESES[m - 1]} ${y}`; };
function dayLabel(s) {
  if (s === today()) return 'Hoy';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Ayer';
  const d = parseYmd(s);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MCORTO[d.getMonth()]}`;
}

/* ───────── Estado de interfaz ───────── */
const ui = { tab: 'home', month: today().slice(0, 7), filter: 'all', q: '', debtDir: 'owe' };
const TABS = [
  { id: 'home', label: 'Inicio', ico: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  { id: 'movs', label: 'Movimientos', ico: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
  { id: 'debts', label: 'Deudas', ico: '<path d="M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2"/>' },
  { id: 'set', label: 'Ajustes', ico: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>' }
];
const svg = p => `<svg viewBox="0 0 24 24">${p}</svg>`;

/* ───────── Render principal ───────── */
function render(keepFocus) {
  const nav = TABS.map(t => `<button data-act="nav" data-id="${t.id}" class="${ui.tab === t.id ? 'on' : ''}">${svg(t.ico)}<span>${t.label}</span></button>`).join('');
  $('#navBottom').innerHTML = nav; $('#navSide').innerHTML = nav;
  const h = new Date().getHours();
  const titles = {
    home: ['Inicio', `${h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'} · así va tu mes`],
    movs: ['Movimientos', 'Tus ingresos y gastos'],
    debts: ['Deudas', 'Lo que debes y lo que te deben'],
    set: ['Ajustes', 'Tasa, respaldo y apariencia']
  };
  $('#title').textContent = titles[ui.tab][0];
  $('#subtitle').textContent = titles[ui.tab][1];
  $('#btnHide').textContent = db.set.hide ? '🙈' : '👁';
  $('#fab').classList.toggle('hide', ui.tab === 'set');
  $('#sideRate').innerHTML = `US$ 1 =<b>C$ ${nf(rate(), 4)}</b>${db.set.rateMode === 'manual' ? 'Tasa manual' : ago(db.rate.ts)}`;
  const v = $('#view');
  const y = window.scrollY;
  v.innerHTML = ({ home: viewHome, movs: viewMovs, debts: viewDebts, set: viewSet })[ui.tab]();
  if (ui.tab === 'movs') renderMovList();
  if (keepFocus) window.scrollTo(0, y);
  applyTheme();
}

function rateCard() {
  return `<div class="card rate">
    <div><small>Precio del dólar ${db.set.rateMode === 'manual' ? '(manual)' : ''}</small>
    <div class="rate-v">C$ ${nf(rate(), 4)}</div>
    <small>US$ 1 = C$ ${nf(rate(), 4)} · ${db.set.rateMode === 'manual' ? 'definida por ti' : ago(db.rate.ts)}</small></div>
    <button class="icon-btn" data-act="refresh-rate" aria-label="Actualizar tasa" ${db.set.rateMode === 'manual' ? 'style="opacity:.4"' : ''}>⟳</button>
  </div>`;
}

function viewHome() {
  const { i, o } = monthTotals(ui.month);
  const bal = i - o;
  const acc = db.tx.reduce((s, t) => s + (t.type === 'in' ? 1 : -1) * toNIO(t.amount, t.cur), 0);
  const dt = debtTotals();
  const recent = [...db.tx].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)).slice(0, 6);
  const install = canInstall() ? `<div class="banner full"><div><b>Instala la app</b><small>Úsala como app propia, también sin internet</small></div><button class="btn acc" data-act="install">Instalar</button></div>` : '';
  return `<div class="grid home-grid">
    ${install}
    <div class="card hero full">
      <div class="monthnav"><button data-act="prev-month" aria-label="Mes anterior">‹</button><b>${monthLabel(ui.month)}</b><button data-act="next-month" aria-label="Mes siguiente">›</button></div>
      <small>Balance del mes</small>
      <div class="big ${bal < 0 ? 'neg' : ''}">${bal < 0 ? '−' : ''}${money(Math.abs(bal), 'NIO')}</div>
      <div class="eq">≈ ${bal < 0 ? '−' : ''}${money(Math.abs(bal) / rate(), 'USD')}</div>
      <div class="pills">
        <div class="pill in"><small>↑ Ingresos</small><b>${money(i, 'NIO')}</b><div class="eq">≈ ${money(i / rate(), 'USD')}</div></div>
        <div class="pill out"><small>↓ Gastos</small><b>${money(o, 'NIO')}</b><div class="eq">≈ ${money(o / rate(), 'USD')}</div></div>
      </div>
      <span class="chip-acc">Acumulado total: ${acc < 0 ? '−' : ''}${money(Math.abs(acc), 'NIO')} · ≈ ${acc < 0 ? '−' : ''}${money(Math.abs(acc) / rate(), 'USD')}</span>
    </div>
    ${rateCard()}
    <div class="card">
      <h2>Conversor rápido</h2>
      <div class="conv2">
        <div class="fld"><label>Córdobas (C$)</label><input class="inp" id="cvN" inputmode="decimal" placeholder="0.00" autocomplete="off"></div>
        <div class="fld"><label>Dólares (US$)</label><input class="inp" id="cvU" inputmode="decimal" placeholder="0.00" autocomplete="off"></div>
      </div>
    </div>
    <div class="card full">
      <h2>Deudas pendientes ${dt.late ? `<span class="tag late">${dt.late} vencida${dt.late > 1 ? 's' : ''}</span>` : ''}</h2>
      <div class="two">
        <button class="pill out" data-act="go-debts" data-dir="owe"><small>Yo debo</small><b>${money(dt.owe, 'NIO')}</b><div class="eq">≈ ${money(dt.owe / rate(), 'USD')}</div></button>
        <button class="pill in" data-act="go-debts" data-dir="owed"><small>Me deben</small><b>${money(dt.owed, 'NIO')}</b><div class="eq">≈ ${money(dt.owed / rate(), 'USD')}</div></button>
      </div>
    </div>
    <div class="card full"><h2>Últimos 6 meses</h2>${chart6()}</div>
    <div class="card">${catBlock('out')}</div>
    <div class="card">${catBlock('in')}</div>
    <div class="card full"><h2>Últimos movimientos <button class="btn" data-act="nav" data-id="movs">Ver todos</button></h2>
      ${recent.length ? recent.map(txRow).join('') : emptyBox('🪙', 'Aún no hay movimientos.<br>Toca ＋ para registrar tu primer ingreso o gasto.')}
    </div>
  </div>`;
}

function chart6() {
  const keys = []; for (let k = 5; k >= 0; k--) keys.push(shiftMonth(ui.month, -k));
  const data = keys.map(k => ({ k, ...monthTotals(k) }));
  const mx = Math.max(1, ...data.flatMap(d => [d.i, d.o]));
  const W = 320, H = 140, base = 112, gw = W / 6;
  const bars = data.map((d, n) => {
    const cx = gw * n + gw / 2, hi = (d.i / mx) * 92, ho = (d.o / mx) * 92;
    return `<rect x="${cx - 14}" y="${base - hi}" width="12" height="${Math.max(hi, d.i ? 2 : 0)}" rx="4" fill="var(--in)"/>
      <rect x="${cx + 2}" y="${base - ho}" width="12" height="${Math.max(ho, d.o ? 2 : 0)}" rx="4" fill="var(--out)"/>
      <text x="${cx}" y="${base + 18}">${MCORTO[+d.k.slice(5) - 1]}</text>`;
  }).join('');
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y gastos de los últimos 6 meses"><line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="var(--line)"/>${bars}</svg>
    <div class="legend"><span><i style="background:var(--in)"></i>Ingresos</span><span><i style="background:var(--out)"></i>Gastos</span></div>`;
}

function catBlock(type) {
  const m = {}; let tot = 0;
  for (const t of db.tx) if (t.type === type && mkey(t.date) === ui.month) { const n = toNIO(t.amount, t.cur); m[t.cat] = (m[t.cat] || 0) + n; tot += n; }
  const list = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const title = type === 'out' ? 'Gastos por categoría' : 'Ingresos por categoría';
  if (!list.length) return `<h2>${title}</h2><div class="empty" style="padding:14px">Sin datos este mes</div>`;
  return `<h2>${title}</h2>` + list.map(([c, v]) => `<div class="cat"><div class="cat-h"><span>${catIco(c, type)} ${esc(c)}</span><b>${money(v, 'NIO')}</b></div><div class="track"><div class="fill ${type}" style="width:${Math.max(4, v / tot * 100)}%"></div></div></div>`).join('');
}

const emptyBox = (ico, txt) => `<div class="empty"><span>${ico}</span>${txt}</div>`;

function txRow(t) {
  return `<button class="row" data-act="edit-tx" data-id="${t.id}">
    <span class="ico ${t.type}">${catIco(t.cat, t.type)}</span>
    <span class="meta"><b>${esc(t.cat)}</b><small>${esc(t.note || dayLabel(t.date))}</small></span>
    <span class="amt ${t.type}">${t.type === 'in' ? '+' : '−'}${money(t.amount, t.cur)}<small>${eqTxt(t.amount, t.cur)}</small></span>
  </button>`;
}

function viewMovs() {
  const { i, o } = monthTotals(ui.month);
  return `<div class="card">
    <div class="monthnav"><button data-act="prev-month" aria-label="Mes anterior">‹</button><b>${monthLabel(ui.month)}</b><button data-act="next-month" aria-label="Mes siguiente">›</button></div>
    <div class="two" style="margin:8px 0 12px">
      <div class="pill in"><small>Ingresos</small><b>${money(i, 'NIO')}</b><div class="eq">≈ ${money(i / rate(), 'USD')}</div></div>
      <div class="pill out"><small>Gastos</small><b>${money(o, 'NIO')}</b><div class="eq">≈ ${money(o / rate(), 'USD')}</div></div>
    </div>
    <div class="seg">
      ${[['all', 'Todo', ''], ['in', 'Ingresos', 'in'], ['out', 'Gastos', 'out']].map(([k, l, c]) => `<button data-act="filter" data-id="${k}" class="${ui.filter === k ? 'on ' + c : ''}">${l}</button>`).join('')}
    </div>
    <input class="inp search" id="q" type="search" placeholder="Buscar por nota o categoría…" value="${esc(ui.q)}" autocomplete="off">
    <div id="movList"></div>
  </div>`;
}
function renderMovList() {
  const q = ui.q.trim().toLowerCase();
  const items = db.tx.filter(t => mkey(t.date) === ui.month && (ui.filter === 'all' || t.type === ui.filter) &&
    (!q || (t.note || '').toLowerCase().includes(q) || t.cat.toLowerCase().includes(q)));
  const box = $('#movList'); if (!box) return;
  if (!items.length) { box.innerHTML = emptyBox('🔎', q ? 'Nada coincide con tu búsqueda.' : 'No hay movimientos en este mes.'); return; }
  items.sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  const groups = {};
  items.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));
  box.innerHTML = Object.keys(groups).sort().reverse().map(d => {
    const net = groups[d].reduce((s, t) => s + (t.type === 'in' ? 1 : -1) * toNIO(t.amount, t.cur), 0);
    return `<div class="day"><span>${dayLabel(d)}</span><span>${net < 0 ? '−' : '+'}${money(Math.abs(net), 'NIO')}</span></div>${groups[d].map(txRow).join('')}`;
  }).join('');
}

function viewDebts() {
  const dt = debtTotals();
  const list = db.debts.filter(d => d.dir === ui.debtDir).sort((a, b) => (a.closed - b.closed) || (a.due || '9999').localeCompare(b.due || '9999'));
  return `<div class="card">
    <div class="seg">
      <button data-act="debt-dir" data-id="owe" class="${ui.debtDir === 'owe' ? 'on out' : ''}">Yo debo</button>
      <button data-act="debt-dir" data-id="owed" class="${ui.debtDir === 'owed' ? 'on in' : ''}">Me deben</button>
    </div>
    <div style="margin:16px 4px 4px"><small>${ui.debtDir === 'owe' ? 'Total que debes' : 'Total que te deben'}</small>
      <div class="big" style="font-size:32px">${money(ui.debtDir === 'owe' ? dt.owe : dt.owed, 'NIO')}</div>
      <div class="eq">≈ ${money((ui.debtDir === 'owe' ? dt.owe : dt.owed) / rate(), 'USD')}</div></div>
    ${list.length ? list.map(debtCard).join('') : emptyBox(ui.debtDir === 'owe' ? '🙌' : '🤝', ui.debtDir === 'owe' ? 'No tienes deudas registradas.<br>Toca ＋ para anotar una.' : 'Nadie te debe por ahora.<br>Toca ＋ para anotar un préstamo.')}
  </div>`;
}
function debtCard(d) {
  const left = leftOf(d), pct = d.amount ? Math.min(100, paidOf(d) / d.amount * 100) : 0;
  const late = !d.closed && d.due && d.due < today();
  const tag = d.closed ? '<span class="tag ok">Saldada</span>' : late ? '<span class="tag late">Vencida</span>' : d.due ? `<span class="tag">Vence ${dayLabel(d.due)}</span>` : '';
  return `<button class="debt ${d.closed ? 'closed' : ''}" data-act="open-debt" data-id="${d.id}">
    <div class="debt-h"><div><b>${esc(d.person)}</b><br><small>${esc(d.note || 'Desde ' + dayLabel(d.date))}</small></div>${tag}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin:10px 0 8px">
      <div><small>Pendiente</small><div style="font-size:20px;font-weight:800">${money(left, d.cur)}</div><div class="eq">${eqTxt(left, d.cur)}</div></div>
      <small>de ${money(d.amount, d.cur)}</small></div>
    <div class="track"><div class="fill ${d.dir === 'owe' ? 'out' : 'in'}" style="width:${pct}%"></div></div>
  </button>`;
}

function viewSet() {
  const manual = db.set.rateMode === 'manual';
  const standalone = isStandalone();
  return `<div class="grid">
    <div class="card"><h2>Precio del dólar</h2>
      <div class="seg"><button data-act="rate-mode" data-id="auto" class="${!manual ? 'on' : ''}">Automática</button><button data-act="rate-mode" data-id="manual" class="${manual ? 'on' : ''}">Manual</button></div>
      <div class="setrow"><div><b>C$ ${nf(rate(), 4)} por US$ 1</b><small>${manual ? 'Tasa definida por ti' : ago(db.rate.ts) + (db.rate.src ? ' · ' + db.rate.src : '')}</small></div>
        ${manual ? '' : '<button class="btn acc" data-act="refresh-rate">Actualizar</button>'}</div>
      ${manual ? `<div class="fld" style="margin-top:6px"><label>Tu tasa (córdobas por 1 dólar)</label><input class="inp" id="manualRate" inputmode="decimal" value="${db.set.manualRate || ''}" placeholder="Ej. ${nf(db.rate.value, 2)}"></div>` : ''}
      <small style="display:block;margin-top:10px;line-height:1.4">La tasa automática se descarga cuando hay internet y se guarda para usarla sin conexión. Usa la manual si prefieres la tasa de tu banco o casa de cambio.</small>
    </div>
    <div class="card"><h2>Apariencia</h2>
      <div class="seg">${[['auto', 'Automático'], ['dark', 'Oscuro'], ['light', 'Claro']].map(([k, l]) => `<button data-act="theme" data-id="${k}" class="${db.set.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="setrow"><div><b>Ocultar montos</b><small>Cubre las cifras con puntos (también con el ojo de arriba)</small></div><button class="btn" data-act="toggle-hide">${db.set.hide ? 'Mostrar' : 'Ocultar'}</button></div>
    </div>
    <div class="card"><h2>Instalación y modo sin internet</h2>
      <div class="setrow"><div><b>${standalone ? 'App instalada ✅' : 'Instalar en este dispositivo'}</b><small>${standalone ? 'Ya la estás usando como app.' : canInstall() ? 'Se instala como app, con su propio ícono.' : isIOS() ? 'En iPhone: botón Compartir → “Agregar a pantalla de inicio”.' : 'En Chrome: menú ⋮ → “Instalar app” o “Agregar a pantalla de inicio”.'}</small></div>
        ${!standalone && canInstall() ? '<button class="btn acc" data-act="install">Instalar</button>' : ''}</div>
      <div class="setrow"><div><b>Funciona sin internet</b><small>${swReady ? 'Lista: puedes registrar todo sin conexión.' : 'Se activa después de abrir la app una vez con internet.'}</small></div></div>
    </div>
    <div class="card"><h2>Respaldo de tus datos</h2>
      <small style="display:block;line-height:1.4;margin-bottom:6px">Tus datos viven solo en este dispositivo. Haz un respaldo de vez en cuando para no perderlos si cambias de teléfono o borras los datos del navegador.</small>
      <div class="setrow"><div><b>Exportar respaldo</b><small>${db.tx.length} movimientos · ${db.debts.length} deudas</small></div><button class="btn acc" data-act="export">Exportar</button></div>
      <div class="setrow"><div><b>Importar respaldo</b><small>Reemplaza los datos actuales</small></div><button class="btn" data-act="import">Importar</button></div>
      <div class="setrow"><div><b>Borrar todo</b><small>Elimina movimientos y deudas</small></div><button class="btn danger" data-act="wipe">Borrar</button></div>
      <input type="file" id="fileIn" accept="application/json,.json" hidden>
    </div>
    <p class="sub" style="text-align:center;padding:6px">Libreta Organizadora · v1</p>
  </div>`;
}

/* ───────── Hojas (formularios) ───────── */
const sheet = $('#sheet'), sheetBg = $('#sheetBg');
function openSheet(html) {
  sheet.innerHTML = '<div class="grab"></div>' + html;
  sheetBg.classList.add('on'); sheet.classList.add('on'); document.body.classList.add('lock');
}
function closeSheet() {
  sheet.classList.remove('on'); sheetBg.classList.remove('on'); document.body.classList.remove('lock');
  F = null; D = null;
}

let F = null, D = null;
function openForm(kind, item) {
  F = item ? {
    kind: item.payments ? 'debt' : item.type, id: item.id, amount: String(item.amount), cur: item.cur,
    cat: item.cat || '', note: item.note || '', date: item.date || today(), person: item.person || '', dir: item.dir || 'owe', due: item.due || ''
  } : { kind, id: null, amount: '', cur: 'NIO', cat: '', note: '', date: today(), person: '', dir: ui.debtDir, due: '' };
  renderForm();
  if (!item) setTimeout(() => { const a = $('#fAmt'); if (a) a.focus(); }, 320);
}
function renderForm() {
  const k = F.kind, labels = { in: 'ingreso', out: 'gasto', debt: 'deuda' };
  const kinds = [['in', 'Ingreso'], ['out', 'Gasto'], ['debt', 'Deuda']];
  let fields;
  if (k === 'debt') {
    fields = `<div class="stack">
      <div class="seg"><button data-act="f-dir" data-id="owe" class="${F.dir === 'owe' ? 'on out' : ''}">Yo debo</button><button data-act="f-dir" data-id="owed" class="${F.dir === 'owed' ? 'on in' : ''}">Me deben</button></div>
      <div class="fld"><label>${F.dir === 'owe' ? '¿A quién le debes?' : '¿Quién te debe?'}</label><input class="inp" id="fPerson" value="${esc(F.person)}" placeholder="Nombre" autocomplete="off"></div>
      <div class="two"><div class="fld"><label>Fecha</label><input class="inp" type="date" id="fDate" value="${F.date}"></div>
      <div class="fld"><label>Vence (opcional)</label><input class="inp" type="date" id="fDue" value="${F.due}"></div></div>
      <div class="fld"><label>Nota (opcional)</label><input class="inp" id="fNote" value="${esc(F.note)}" placeholder="Motivo o detalle" autocomplete="off"></div>
    </div>`;
  } else {
    const cats = k === 'in' ? CATS_IN : CATS_OUT;
    fields = `<div class="cats">${cats.map(([n, e]) => `<button data-act="f-cat" data-id="${esc(n)}" class="${F.cat === n ? 'on' : ''}"><span>${e}</span>${esc(n)}</button>`).join('')}</div>
    <div class="stack">
      <div class="fld"><label>Nota (opcional)</label><input class="inp" id="fNote" value="${esc(F.note)}" placeholder="¿En qué fue?" autocomplete="off"></div>
      <div class="fld"><label>Fecha</label><input class="inp" type="date" id="fDate" value="${F.date}"></div>
    </div>`;
  }
  openSheet(`<div class="sh-head"><h3>${F.id ? 'Editar' : 'Nuevo'} ${labels[k]}</h3><button class="x" data-act="close-sheet" aria-label="Cerrar">✕</button></div>
    ${F.id ? '' : `<div class="seg">${kinds.map(([id, l]) => `<button data-act="f-kind" data-id="${id}" class="${k === id ? 'on ' + (id === 'debt' ? '' : id) : ''}">${l}</button>`).join('')}</div>`}
    <div class="amt-box"><input id="fAmt" inputmode="decimal" placeholder="0.00" value="${esc(F.amount)}" autocomplete="off">
      <div class="chips"><button data-act="f-cur" data-id="NIO" class="${F.cur === 'NIO' ? 'on' : ''}">C$</button><button data-act="f-cur" data-id="USD" class="${F.cur === 'USD' ? 'on' : ''}">US$</button></div></div>
    <div class="conv" id="fConv"></div>
    ${fields}
    <button class="primary" data-act="save-form">Guardar</button>
    ${F.id ? `<div class="acts"><button class="btn danger" data-act="${k === 'debt' ? 'del-debt' : 'del-tx'}" data-id="${F.id}" style="grid-column:1/-1">Eliminar</button></div>` : ''}`);
  updateConv();
}
function updateConv() {
  const el = $('#fConv'); if (!el || !F) return;
  const a = parseAmt(F.amount);
  if (!a) { el.innerHTML = `<small>Escribe un monto y verás su equivalente en ${F.cur === 'NIO' ? 'dólares' : 'córdobas'}</small>`; return; }
  const o = other(a, F.cur);
  el.innerHTML = `≈ ${sym(o.c)} ${nf(o.v)}<small>Tasa: US$ 1 = C$ ${nf(rate(), 4)}</small>`;
}
function saveForm() {
  const a = parseAmt(F.amount);
  if (!a) return toast('Escribe un monto válido');
  if (F.kind === 'debt') {
    const person = F.person.trim();
    if (!person) return toast('Escribe el nombre de la persona');
    if (F.id) {
      const d = db.debts.find(x => x.id === F.id);
      Object.assign(d, { amount: a, cur: F.cur, dir: F.dir, person, note: F.note.trim(), date: F.date || today(), due: F.due || '' });
      d.closed = leftOf(d) <= 0 ? true : d.closed;
    } else {
      db.debts.push({ id: uid(), dir: F.dir, person, amount: a, cur: F.cur, date: F.date || today(), due: F.due || '', note: F.note.trim(), payments: [], closed: false, created: Date.now() });
      ui.debtDir = F.dir;
    }
    ui.tab = 'debts';
  } else {
    const cat = F.cat || 'Otro';
    if (F.id) Object.assign(db.tx.find(x => x.id === F.id), { type: F.kind, amount: a, cur: F.cur, cat, note: F.note.trim(), date: F.date || today() });
    else db.tx.push({ id: uid(), type: F.kind, amount: a, cur: F.cur, cat, note: F.note.trim(), date: F.date || today(), created: Date.now() });
    ui.month = mkey(F.date || today());
  }
  save(); closeSheet(); render(); toast('✅ Guardado');
}

function openDebt(id) {
  const d = db.debts.find(x => x.id === id); if (!d) return;
  D = id; renderDebt();
}
function renderDebt() {
  const d = db.debts.find(x => x.id === D); if (!d) return closeSheet();
  const left = leftOf(d), pct = d.amount ? Math.min(100, paidOf(d) / d.amount * 100) : 0;
  const pays = [...(d.payments || [])].sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`<div class="sh-head"><div><h3>${esc(d.person)}</h3><small>${d.dir === 'owe' ? 'Yo debo' : 'Me deben'}${d.due ? ' · vence ' + dayLabel(d.due) : ''}${d.note ? ' · ' + esc(d.note) : ''}</small></div><button class="x" data-act="close-sheet" aria-label="Cerrar">✕</button></div>
    <small>Pendiente</small><div class="big" style="font-size:34px">${money(left, d.cur)}</div><div class="eq">${eqTxt(left, d.cur)} · de ${money(d.amount, d.cur)}</div>
    <div class="track" style="margin:14px 0"><div class="fill ${d.dir === 'owe' ? 'out' : 'in'}" style="width:${pct}%"></div></div>
    ${d.closed ? '<div class="banner" style="margin-bottom:12px"><b>✅ Deuda saldada</b></div>' : `
    <div class="fld"><label>${d.dir === 'owe' ? 'Registrar un abono (pago)' : 'Registrar un cobro (te pagaron)'} en ${sym(d.cur)}</label>
      <div style="display:flex;gap:8px"><input class="inp" id="payAmt" inputmode="decimal" placeholder="0.00" autocomplete="off"><button class="btn acc" data-act="pay">Abonar</button></div></div>
    <label class="chk"><input type="checkbox" id="payTx"> Registrar también como ${d.dir === 'owe' ? 'gasto' : 'ingreso'}</label>`}
    ${pays.length ? `<h2 style="margin:14px 0 2px;font-size:14px">Historial</h2>${pays.map(p => `<div class="pay"><span>${dayLabel(p.date)}<br><small>${eqTxt(p.amount, d.cur)}</small></span><span><b>${money(p.amount, d.cur)}</b> <button data-act="del-pay" data-id="${p.id}">Quitar</button></span></div>`).join('')}` : ''}
    <div class="acts"><button class="btn" data-act="edit-debt" data-id="${d.id}">Editar</button>
      <button class="btn" data-act="toggle-debt" data-id="${d.id}">${d.closed ? 'Reabrir' : 'Marcar saldada'}</button>
      <button class="btn danger" data-act="del-debt" data-id="${d.id}" style="grid-column:1/-1">Eliminar</button></div>`);
}
function addPayment() {
  const d = db.debts.find(x => x.id === D); if (!d) return;
  const a = parseAmt($('#payAmt').value);
  if (!a) return toast('Escribe el monto del abono');
  const amt = Math.min(a, leftOf(d));
  d.payments = d.payments || [];
  d.payments.push({ id: uid(), amount: amt, date: today() });
  if ($('#payTx') && $('#payTx').checked) {
    db.tx.push({ id: uid(), type: d.dir === 'owe' ? 'out' : 'in', amount: amt, cur: d.cur, cat: d.dir === 'owe' ? 'Pago de deuda' : 'Cobro de deuda', note: (d.dir === 'owe' ? 'Abono a ' : 'Cobro a ') + d.person, date: today(), created: Date.now() });
  }
  if (leftOf(d) <= 0) { d.closed = true; toast('🎉 Deuda saldada'); } else toast('✅ Abono registrado');
  save(); renderDebt(); render(true);
}

/* ───────── Acciones ───────── */
const ACT = {
  nav: b => { ui.tab = b.dataset.id; window.scrollTo(0, 0); render(); },
  'go-debts': b => { ui.debtDir = b.dataset.dir; ui.tab = 'debts'; window.scrollTo(0, 0); render(); },
  'prev-month': () => { ui.month = shiftMonth(ui.month, -1); render(true); },
  'next-month': () => { ui.month = shiftMonth(ui.month, 1); render(true); },
  filter: b => { ui.filter = b.dataset.id; render(true); },
  'debt-dir': b => { ui.debtDir = b.dataset.id; render(true); },
  add: () => openForm(ui.tab === 'debts' ? 'debt' : 'out'),
  'edit-tx': b => openForm(null, db.tx.find(t => t.id === b.dataset.id)),
  'open-debt': b => openDebt(b.dataset.id),
  'edit-debt': b => { const d = db.debts.find(x => x.id === b.dataset.id); closeSheet(); openForm(null, d); },
  'toggle-debt': b => { const d = db.debts.find(x => x.id === b.dataset.id); d.closed = !d.closed; save(); renderDebt(); render(true); },
  'del-debt': b => { if (!confirm('¿Eliminar esta deuda y su historial?')) return; db.debts = db.debts.filter(x => x.id !== b.dataset.id); save(); closeSheet(); render(true); toast('Deuda eliminada'); },
  'del-tx': b => { if (!confirm('¿Eliminar este movimiento?')) return; db.tx = db.tx.filter(x => x.id !== b.dataset.id); save(); closeSheet(); render(true); toast('Movimiento eliminado'); },
  'del-pay': b => { const d = db.debts.find(x => x.id === D); d.payments = d.payments.filter(p => p.id !== b.dataset.id); if (leftOf(d) > 0) d.closed = false; save(); renderDebt(); render(true); },
  pay: addPayment,
  'close-sheet': closeSheet,
  'f-kind': b => { const k = b.dataset.id; if (F.kind !== k) { if (F.kind !== 'debt' && k !== 'debt') F.cat = ''; F.kind = k; if (k !== 'debt') F.cat = ''; } renderForm(); setTimeout(() => $('#fAmt') && $('#fAmt').focus(), 50); },
  'f-cur': b => { F.cur = b.dataset.id; document.querySelectorAll('[data-act="f-cur"]').forEach(x => x.classList.toggle('on', x.dataset.id === F.cur)); updateConv(); },
  'f-cat': b => { F.cat = b.dataset.id; document.querySelectorAll('[data-act="f-cat"]').forEach(x => x.classList.toggle('on', x.dataset.id === F.cat)); },
  'f-dir': b => { F.dir = b.dataset.id; renderForm(); },
  'save-form': saveForm,
  'refresh-rate': () => { if (db.set.rateMode === 'manual') return toast('Estás en tasa manual'); fetchRate(true); },
  'rate-mode': b => { db.set.rateMode = b.dataset.id; if (b.dataset.id === 'manual' && !db.set.manualRate) db.set.manualRate = db.rate.value; save(); render(true); if (b.dataset.id === 'auto') fetchRate(false); },
  theme: b => { db.set.theme = b.dataset.id; save(); render(true); },
  'toggle-hide': () => { db.set.hide = !db.set.hide; save(); render(true); },
  install: doInstall,
  export: exportData,
  import: () => $('#fileIn').click(),
  wipe: () => { if (!confirm('¿Borrar TODOS tus movimientos y deudas? Esto no se puede deshacer.')) return; if (!confirm('¿Seguro? Te recomendamos exportar un respaldo antes.')) return; db.tx = []; db.debts = []; save(); render(true); toast('Datos borrados'); }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b);
});
$('#fab').addEventListener('click', ACT.add);
$('#btnHide').addEventListener('click', ACT['toggle-hide']);
sheetBg.addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'fAmt') { F.amount = e.target.value; updateConv(); }
  else if (id === 'fNote') F.note = e.target.value;
  else if (id === 'fPerson') F.person = e.target.value;
  else if (id === 'q') { ui.q = e.target.value; renderMovList(); }
  else if (id === 'cvN') { const a = parseAmt(e.target.value); $('#cvU').value = a ? (a / rate()).toFixed(2) : ''; }
  else if (id === 'cvU') { const a = parseAmt(e.target.value); $('#cvN').value = a ? (a * rate()).toFixed(2) : ''; }
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'fDate') F.date = e.target.value;
  else if (id === 'fDue') F.due = e.target.value;
  else if (id === 'manualRate') { const v = parseAmt(e.target.value); if (v) { db.set.manualRate = v; save(); render(true); toast('Tasa manual guardada'); } else toast('Escribe una tasa válida'); }
  else if (id === 'fileIn') importData(e.target.files[0]);
});

/* ───────── Respaldo ───────── */
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'libreta-organizadora', v: 1, exported: new Date().toISOString(), tx: db.tx, debts: db.debts }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `libreta-respaldo-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('📦 Respaldo exportado');
}
function importData(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      if (!Array.isArray(j.tx) || !Array.isArray(j.debts)) throw 0;
      if (!confirm(`Se reemplazarán tus datos actuales por ${j.tx.length} movimientos y ${j.debts.length} deudas. ¿Continuar?`)) return;
      db.tx = j.tx.filter(t => t && t.id && t.date && t.amount > 0);
      db.debts = j.debts.filter(d => d && d.id && d.amount > 0).map(d => ({ payments: [], ...d }));
      save(); render(true); toast('✅ Respaldo importado');
    } catch (e) { toast('Archivo de respaldo no válido'); }
  };
  r.readAsText(file);
}

/* ───────── Instalación (PWA) ───────── */
let deferred = null, swReady = false;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const canInstall = () => !!deferred && !isStandalone();
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; render(true); });
window.addEventListener('appinstalled', () => { deferred = null; render(true); toast('✅ App instalada'); });
async function doInstall() {
  if (!deferred) return toast('Usa el menú del navegador → Instalar app');
  deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; render(true);
}

/* ───────── Tema, estado de red, avisos ───────── */
const mq = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const t = db.set.theme === 'auto' ? (mq.matches ? 'light' : 'dark') : db.set.theme;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f2f4fb' : '#0a0f1f';
}
mq.addEventListener && mq.addEventListener('change', applyTheme);

function netState() {
  const on = navigator.onLine, el = $('#net');
  el.classList.toggle('off', !on);
  el.querySelector('em').textContent = on ? 'En línea' : 'Sin internet';
}
addEventListener('online', () => { netState(); if (staleRate(1)) fetchRate(false); });
addEventListener('offline', netState);
document.addEventListener('visibilitychange', () => { if (!document.hidden && staleRate(2)) fetchRate(false); });

let tt;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2400);
}

/* ───────── Inicio ───────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => { swReady = true; if (ui.tab === 'set') render(true); }).catch(() => {});
}
applyTheme(); netState(); render();
if (staleRate(3)) fetchRate(false);
const qp = new URLSearchParams(location.search).get('add');
if (qp === 'in' || qp === 'out' || qp === 'debt') setTimeout(() => openForm(qp), 300);
})();
