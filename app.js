/* PBD POS — หน้าขายหน้างาน (PWA) */
(() => {
'use strict';

const CFG = window.POS_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const baht = (n) => '฿' + r2(n).toLocaleString('th-TH', { minimumFractionDigits: r2(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dt = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543} ${hm(ms)}`; };
const sbaht = (n) => (n < 0 ? '-' : n > 0 ? '+' : '') + baht(Math.abs(n));
const METHOD = { cash: 'เงินสด', transfer: 'โอน/QR', other: 'อื่นๆ' };

function randomId(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (x) => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[x % 34]).join('');
}

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('pos_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pos_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem('pos_' + k); } catch (e) {} }
};

const S = {
  session: store.get('session', null),
  data: store.get('data', null),
  loc: store.get('loc', ''),
  cart: store.get('cart', []),
  bills: store.get('bills', []),
  shifts: store.get('shifts', []),
  prn: Object.assign({ mode: 'none', paper: 58, auto: false, chunk: 100 }, store.get('prn', {})),
  device: store.get('device', ''),
  view: 'sell', cat: '', q: '',
  syncing: false, authLost: false, report: null, installEvt: null
};
if (!S.device) { S.device = randomId(3); store.set('device', S.device); }
S.cart = (S.cart || []).filter((l) => l && l.plan && l.stage); // ล้างตะกร้ารูปแบบเก่า

function saveBills() {
  const keepFrom = Date.now() - 14 * 864e5;
  S.bills = S.bills.filter((b) => !b.synced || b.createdAt >= keepFrom);
  if (!store.set('bills', S.bills)) { toast('เครื่องเต็ม! บิลอาจไม่ถูกเก็บ — ต่อเน็ตแล้วกดส่งข้อมูลทันที', true); return false; }
  return true;
}
function saveShifts() {
  S.shifts = S.shifts.filter((s) => !s.closeAt || s.dirty || s.closeAt > Date.now() - 30 * 864e5);
  store.set('shifts', S.shifts);
}
const saveCart = () => store.set('cart', S.cart);
const savePrn = () => store.set('prn', S.prn);

/* ---------- ui helpers ---------- */
let toastTimer;
function toast(msg, err) {
  const h = $('#toastHost');
  h.innerHTML = `<div class="toast ${err ? 'err' : ''}">${esc(msg)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { h.innerHTML = ''; }, err ? 4500 : 2200);
}

let sheetOnClose = null;
function sheet(html, opts = {}) {
  closeSheet();
  const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet">${html}</div></div>`;
  sheetOnClose = opts.onClose || null;
  const scrim = host.firstElementChild;
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close]')) closeSheet();
  });
  return scrim.firstElementChild;
}
function closeSheet() {
  if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; try { f(); } catch (x) {} }
  $('#sheetHost').innerHTML = '';
}
const head = (t) => `<div class="hd"><h2>${esc(t)}</h2><button class="x" data-close aria-label="ปิด">×</button></div>`;

function loadScript(src) {
  return new Promise((res, rej) => {
    if ($$('script').some((s) => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่ได้'));
    document.head.appendChild(s);
  });
}

/* ---------- api ---------- */
async function api(action, payload = {}) {
  if (!CFG.API_URL || CFG.API_URL.includes('PUT_')) throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const body = JSON.stringify(Object.assign({ pos: true, action, token: S.session && S.session.token }, payload));
    const res = await fetch(CFG.API_URL, {
      method: 'POST', body, redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    const j = await res.json();
    if (!j.ok) { const e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.auth = j.auth; throw e; }
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('เซิร์ฟเวอร์ตอบช้า ลองใหม่อีกครั้ง');
    if (e instanceof TypeError) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    throw e;
  } finally { clearTimeout(t); }
}

function applyData(j, t0) {
  const prev = S.data || {};
  S.data = {
    items: j.items || [], locations: j.locations || [],
    settings: j.settings || prev.settings || {}, // null = ตั้งค่าร้านไม่เปลี่ยน ใช้ของเดิมในเครื่อง
    stockMode: j.stockMode || prev.stockMode || 'record', at: Date.now(),
    outstanding: j.outstanding || prev.outstanding || [], outAt: j.outstanding ? (t0 || Date.now()) : (prev.outAt || 0)
  };
  store.set('data', S.data);
  if (j.user && S.session) { S.session.user = j.user; store.set('session', S.session); }
  if (!S.data.locations.some((l) => l.id === S.loc)) {
    S.loc = (S.data.locations[0] || {}).id || '';
    store.set('loc', S.loc);
  }
}

async function refreshData(manual) {
  if (!navigator.onLine || !S.session) return;
  try {
    const t0 = Date.now();
    applyData(await api('bootstrap', { sv: S.data && S.data.settings && S.data.settings.ver }), t0);
    S.authLost = false;
    if (manual) toast('อัปเดตสินค้าและราคาแล้ว');
    render();
  } catch (e) {
    if (e.auth) S.authLost = true;
    if (manual || e.auth) render();
    if (manual) toast(e.message, true);
  }
}

/* ---------- sync ---------- */
const pendingBills = () => S.bills.filter((b) => !b.synced && mine(b.loc));

async function syncNow(manual) {
  if (S.syncing || !S.session) return;
  if (!navigator.onLine) { if (manual) toast('ยังไม่มีอินเทอร์เน็ต บิลเก็บไว้ในเครื่องแล้ว'); return; }
  S.syncing = true; renderBadge();
  try {
    const pend = pendingBills();
    for (let i = 0; i < pend.length; i += 25) {
      const batch = pend.slice(i, i + 25).map((b) => ({
        id: b.id, loc: b.loc, createdAt: b.createdAt, sellerId: b.sellerId, sellerName: b.sellerName, device: b.device,
        shiftId: b.shiftId, lines: b.lines, discount: b.discount, method: b.method, cash: b.cash, change: b.change, note: b.note,
        customer: b.customer || '', type: b.type || 'SALE'
      }));
      const j = await api('syncBills', { bills: batch });
      j.results.forEach((r) => {
        const b = S.bills.find((x) => x.id === r.id);
        if (!b) return;
        if (r.ok) { b.synced = Date.now(); delete b.err; } else b.err = r.error;
      });
      saveBills();
    }
    if (pend.length) {
      try {
        const t0 = Date.now();
        const o = await api('outstanding');
        if (S.data) { S.data.outstanding = o.outstanding || []; S.data.outAt = t0; store.set('data', S.data); }
      } catch (x) { /* ใช้รายการเดิม */ }
    }
    const sh = S.shifts.filter((s) => s.dirty);
    if (sh.length) {
      const j = await api('syncShifts', { shifts: sh });
      j.results.forEach((r) => { const s = S.shifts.find((x) => x.id === r.id); if (s && r.ok) s.dirty = false; });
      saveShifts();
    }
    S.authLost = false;
    if (manual) toast(pendingBills().length ? 'บางบิลส่งไม่ผ่าน ดูที่หน้าบิล' : 'ส่งข้อมูลครบแล้ว', pendingBills().length > 0);
  } catch (e) {
    if (e.auth) S.authLost = true;
    if (manual) toast(e.message, true);
  } finally {
    S.syncing = false;
    renderBadge();
    if (S.view === 'bills' || S.view === 'sell') render();
  }
}

/* ---------- login ---------- */
async function startLogin() {
  const msg = $('#loginMsg');
  if (!navigator.onLine) { msg.textContent = 'ต้องต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบ'; return; }
  if (typeof liff === 'undefined') { msg.textContent = 'โหลดระบบ LINE ไม่ได้ ลองรีเฟรชหน้า'; return; }
  try {
    msg.textContent = 'กำลังเชื่อมต่อ LINE…';
    await liff.init({ liffId: CFG.LIFF_ID });
    if (!liff.isLoggedIn()) {
      store.set('loginPending', 1);
      liff.login({ redirectUri: location.origin + location.pathname });
      return;
    }
    store.del('loginPending');
    const idToken = liff.getIDToken();
    if (!idToken) throw new Error('LINE ไม่ส่ง ID token — เปิด scope openid ในการตั้งค่า LIFF');
    msg.textContent = 'กำลังตรวจสิทธิ์…';
    const t0 = Date.now();
    const j = await api('login', { idToken });
    if (S.session && S.session.user && S.session.user.id !== j.user.id) {
      S.cart = S.cart.filter((l) => !isCollect(l)); saveCart(); S.report = null;
    }
    S.session = { token: j.token, user: j.user };
    store.set('session', S.session);
    applyData(j, t0);
    S.authLost = false;
    history.replaceState(null, '', location.pathname);
    showApp();
    syncNow();
  } catch (e) {
    store.del('loginPending');
    msg.textContent = e.message;
  }
}

function logout() {
  const n = pendingBills().length;
  if (n && !confirm(`มี ${n} บิลที่ยังไม่ได้ส่ง บิลจะยังอยู่ในเครื่องและส่งเมื่อมีคนเข้าสู่ระบบครั้งถัดไป\nออกจากระบบ?`)) return;
  S.session = null; store.del('session');
  // ล้างข้อมูลลูกค้าที่แคชไว้ ให้คนถัดไปที่ล็อกอินเห็นเฉพาะของสาขาตัวเอง
  if (S.data) { S.data.outstanding = []; S.data.outAt = 0; store.set('data', S.data); }
  S.cart = S.cart.filter((l) => !isCollect(l)); saveCart();
  S.report = null;
  try { if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout(); } catch (x) {}
  showLogin();
}

function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); }

/* ---------- catalog & cart ---------- */
const items = () => (S.data && S.data.items) || [];
const locs = () => (S.data && S.data.locations) || [];
// เห็นเฉพาะทีมในสาขาของผู้ใช้ที่ล็อกอิน (บิล/ลูกค้าในเครื่องของสาขาอื่นจะถูกซ่อน)
const mine = (loc) => locs().some((l) => l.id === loc);
const locName = (id) => { const l = locs().find((x) => x.id === id); return l ? l.name : id; };
const user = () => (S.session && S.session.user) || {};

// ตัวเลือกการชำระ (ชื่อเดียวกับ Loyverse)
const STAGE = {
  full: 'ชำระวันสั่งซื้อ', down: 'ดาวน์เต็ม', splitDown: 'แบ่งดาวน์',
  collect: 'เก็บเพิ่ม', collectDown: 'เก็บเงินดาวน์เพิ่ม'
};
const isCollect = (l) => l.stage === 'collect' || l.stage === 'collectDown';
const lineQty = (l) => (isCollect(l) ? 1 : l.qty);
const lineBal = (l) => (isCollect(l) || l.due == null ? 0 : r2(Math.max(0, l.due - l.price) * l.qty));
const cartTotal = () => r2(S.cart.reduce((s, l) => s + lineQty(l) * l.price, 0));
const cartBalance = () => r2(S.cart.reduce((s, l) => s + lineBal(l), 0));
const cartCount = () => S.cart.reduce((s, l) => s + lineQty(l), 0);

function planLabel(p) {
  if (!p || !p.kind) return '';
  if (p.name) return p.name;
  const pre = p.units > 1 ? `ชุด ${p.units} ชิ้น · ` : '';
  return p.kind === 'inst'
    ? `${pre}ผ่อน ${baht(p.inst)} × ${p.n} งวด · ดาวน์ ${baht(p.down)} (รวม ${baht(p.total)})`
    : `${pre}ราคาสด ${baht(p.total)}`;
}
const plansOf = (it) => (it.plans && it.plans.length ? it.plans
  : it.price ? [{ id: '', kind: 'cash', total: it.price, units: 1 }] : []);

function findByCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  return items().find((i) => i.barcode && i.barcode.toLowerCase() === c) || items().find((i) => i.id.toLowerCase() === c) || null;
}

function cartChanged() {
  saveCart();
  renderCartBar();
  if (S.view === 'sell') renderGrid();
}

function addPlanLine(it, plan) {
  const inst = plan.kind === 'inst';
  const due = inst ? plan.down : plan.total;
  const stage = inst ? 'down' : 'full';
  const p = { id: plan.id || '', name: plan.name || '', kind: plan.kind, total: plan.total, down: plan.down || 0,
    inst: plan.inst || 0, n: plan.n || 0, units: plan.units || 1 };
  const same = S.cart.find((l) => !isCollect(l) && l.id === it.id && l.plan.id === p.id && l.plan.total === p.total &&
    l.stage === stage && l.due === due && l.price === due);
  if (same) same.qty++;
  else S.cart.push({ key: randomId(6), id: it.id, name: it.name, plan: p, stage, due, price: due, qty: 1 });
  if (navigator.vibrate) navigator.vibrate(25);
  toast('+ ' + it.name + (inst ? ' · ดาวน์ ' + baht(due) : ''));
  cartChanged();
}

function addToCart(it) {
  const ps = plansOf(it);
  if (!ps.length) {
    const v = prompt(`ระบุราคาขายสด: ${it.name}`, '');
    if (v == null) return;
    const p = r2(parseFloat(String(v).replace(/,/g, '')));
    if (!(p > 0)) return toast('ราคาไม่ถูกต้อง', true);
    return addPlanLine(it, { id: '', kind: 'cash', total: p, units: 1 });
  }
  if (ps.length === 1) return addPlanLine(it, ps[0]);
  pickPlan(it, ps, (p) => addPlanLine(it, p));
}

function pickPlan(it, ps, cb) {
  const el = sheet(`${head(it.name)}<div class="mut small">เลือกแบบการขาย</div><div class="list">${ps.map((p, i) => `
    <button class="li" data-pi="${i}" style="width:100%;text-align:left">
      <span class="tag ${p.kind === 'inst' ? 'wait' : 'ok'}">${p.kind === 'inst' ? 'ผ่อน' : 'สด'}</span>
      <span class="sp">${esc(planLabel(p))}</span>
      <span style="text-align:right"><span class="num">${baht(p.kind === 'inst' ? p.down : p.total)}</span><br><span class="mut small">${p.kind === 'inst' ? 'ดาวน์' : 'จ่ายวันนี้'}</span></span>
    </button>`).join('')}</div>`);
  $$('[data-pi]', el).forEach((b) => { b.onclick = () => { closeSheet(); cb(ps[+b.dataset.pi]); }; });
}

function onCode(code) {
  const it = findByCode(code);
  if (it) addToCart(it);
  else { toast('ไม่พบสินค้า: ' + code, true); S.q = code; if (S.view === 'sell') render(); }
}

/* ----- แก้รายการในตะกร้า: ตัวเลือกการชำระ / ราคา / รับวันนี้ ----- */
function editLine(idx, after) {
  const l = S.cart[idx];
  if (!l) return;
  const inst = l.plan.kind === 'inst', col = isCollect(l);
  const st = { stage: l.stage, due: l.due, price: l.price, qty: l.qty, partial: !inst && !col && l.price < l.due };
  const el = sheet(`${head(l.name)}
    <div class="mut small">${esc(planLabel(l.plan))}${col ? ' · ' + STAGE[l.stage] + ' · อ้างอิง ' + esc(l.refBill) : ''}</div>
    ${col ? '' : `<div class="row" style="margin-top:10px"><span class="sp">จำนวน</span><div class="qty"><button id="qm">−</button><span id="qv"></span><button id="qp">+</button></div></div>`}
    ${inst && !col ? `<div class="seg" style="grid-template-columns:1fr 1fr"><button data-st="down">ดาวน์เต็ม</button><button data-st="splitDown">แบ่งดาวน์</button></div>` : ''}
    ${!inst && !col ? `<div class="seg" style="grid-template-columns:1fr"><button class="on">ชำระวันสั่งซื้อ</button></div>` : ''}
    <div id="fx"></div>
    <div class="total"><span>รับวันนี้</span><span class="num" id="lt"></span></div>
    <div class="row mut small"><span class="sp">${inst ? 'ค้างดาวน์ (เก็บเงินดาวน์เพิ่ม)' : 'ค้างชำระ (เก็บเพิ่ม)'}</span><span class="num" id="lb"></span></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="rm">ลบรายการ</button><button class="btn pri sp" id="ok">ตกลง</button></div>`);
  const fx = $('#fx', el);
  const num = (x) => r2(parseFloat(x) || 0);
  const sums = () => {
    const q = col ? 1 : st.qty;
    $('#lt', el).textContent = baht(st.price * q);
    $('#lb', el).textContent = baht(col ? Math.max(0, l.due - st.price) : Math.max(0, st.due - st.price) * q);
    if ($('#qv', el)) $('#qv', el).textContent = st.qty;
  };
  const draw = () => {
    $$('[data-st]', el).forEach((b) => b.classList.toggle('on', b.dataset.st === st.stage));
    if (col) {
      fx.innerHTML = `<label class="f">ยอดที่เก็บ (ค้างอยู่ ${baht(l.due)})</label><input class="inp num" id="pp" type="number" inputmode="decimal" value="${st.price}">`;
    } else if (inst) {
      fx.innerHTML = `<label class="f">เงินดาวน์ต่อชิ้น (แผน ${baht(l.plan.down)})</label><input class="inp num" id="dd" type="number" inputmode="decimal" value="${st.due}">` +
        (st.stage === 'splitDown' ? `<label class="f">รับดาวน์วันนี้ต่อชิ้น</label><input class="inp num" id="pp" type="number" inputmode="decimal" value="${st.price}">` : '');
    } else {
      fx.innerHTML = `<label class="f">ราคาขายต่อชิ้น หลังส่วนลด (ราคาเต็ม ${baht(l.plan.total)})</label><input class="inp num" id="dd" type="number" inputmode="decimal" value="${st.due}">
        <label class="row" style="margin-top:10px"><input type="checkbox" id="pa" ${st.partial ? 'checked' : ''}><span>ลูกค้าจ่ายไม่ครบวันนี้ (เก็บเพิ่มภายหลัง)</span></label>` +
        (st.partial ? `<label class="f">รับวันนี้ต่อชิ้น</label><input class="inp num" id="pp" type="number" inputmode="decimal" value="${st.price}">` : '');
    }
    const dd = $('#dd', fx), pp = $('#pp', fx), pa = $('#pa', fx);
    if (dd) dd.oninput = () => { st.due = num(dd.value); if (!pp) st.price = st.due; sums(); };
    if (pp) pp.oninput = () => { st.price = num(pp.value); sums(); };
    if (pa) pa.onchange = () => { st.partial = pa.checked; st.price = st.partial ? Math.min(500, st.due) : st.due; draw(); };
    sums();
  };
  $$('[data-st]', el).forEach((b) => {
    b.onclick = () => { st.stage = b.dataset.st; st.price = st.stage === 'down' ? st.due : Math.min(500, st.due); draw(); };
  });
  if (!col) {
    $('#qm', el).onclick = () => { if (st.qty > 1) { st.qty--; sums(); } };
    $('#qp', el).onclick = () => { st.qty++; sums(); };
  }
  $('#rm', el).onclick = () => { S.cart.splice(idx, 1); cartChanged(); closeSheet(); if (after) after(); };
  $('#ok', el).onclick = () => {
    if (st.price < 0 || st.due < 0) return toast('ยอดไม่ถูกต้อง', true);
    if (col) {
      if (!(st.price > 0)) return toast('ใส่ยอดที่เก็บ', true);
      if (st.price > l.due + 0.001) return toast('เก็บเกินยอดค้าง', true);
    } else {
      if (inst && !(st.due > 0)) return toast('ใส่เงินดาวน์', true);
      if (st.price > st.due + 0.001) return toast('รับเงินเกินยอดที่ต้องชำระ', true);
      if (inst && st.stage === 'splitDown' && st.price >= st.due) st.stage = 'down';
      if (inst && st.stage === 'down') st.price = st.due;
      if (!inst && !st.partial) st.price = st.due;
    }
    Object.assign(l, { stage: st.stage, due: st.due, price: st.price, qty: col ? 1 : st.qty });
    cartChanged(); closeSheet(); if (after) after();
  };
  draw();
}

/* ----- เก็บเพิ่ม / เก็บเงินดาวน์เพิ่ม ----- */
function outstandingList() {
  const d = S.data || {};
  const outAt = d.outAt || 0;
  const map = new Map();
  (d.outstanding || []).forEach((o) => { if (mine(o.loc)) map.set(o.bill + '|' + o.line, Object.assign({}, o)); });
  const fresh = (b) => !b.void && mine(b.loc) && (!b.synced || b.synced > outAt);
  S.bills.forEach((b) => {
    if (!fresh(b)) return;
    (b.lines || []).forEach((l, i) => {
      const bal = lineBal(l);
      const k = b.id + '|' + (i + 1);
      if (isCollect(l) || bal <= 0 || map.has(k)) return;
      map.set(k, { bill: b.id, line: i + 1, loc: b.loc, date: ymd(b.createdAt), itemId: l.id, name: l.name,
        kind: l.plan.kind, plan: l.plan, balance: bal, customer: b.customer || '' });
    });
  });
  const sub = (l) => { const o = map.get(l.refBill + '|' + l.refLine); if (o) o.balance = r2(o.balance - l.price); };
  S.bills.forEach((b) => { if (fresh(b)) (b.lines || []).forEach((l) => { if (isCollect(l) && l.refBill) sub(l); }); });
  S.cart.forEach((l) => { if (isCollect(l) && l.refBill) sub(l); });
  return Array.from(map.values()).filter((o) => o.balance > 0.009);
}

function openCollect() {
  let q = '', all = false;
  const el = sheet(`${head('เก็บเพิ่ม / เก็บเงินดาวน์เพิ่ม')}
    <input class="inp" id="cq" placeholder="ค้นหาชื่อลูกค้า / เบอร์ / เลขบิล / สินค้า">
    <label class="row small" style="margin-top:8px"><input type="checkbox" id="ca"><span>แสดงทุกทีมที่ดูได้</span></label>
    <div class="list" id="cl"></div>
    <button class="btn block" id="manual" style="margin-top:10px">เก็บเงินบิลที่ขายใน Loyverse / ไม่มีในระบบ</button>
    <div class="mut small" style="margin-top:6px">รายการค้างจากเซิร์ฟเวอร์ ณ ${S.data && S.data.outAt ? dt(S.data.outAt) : '-'} + บิลในเครื่องนี้</div>`);
  const draw = () => {
    const list = outstandingList()
      .filter((o) => (all || o.loc === S.loc) && (!q || [o.customer, o.bill, o.name].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    $('#cl', el).innerHTML = list.length ? list.map((o, i) => `
      <button class="li" data-o="${i}" style="width:100%;text-align:left"><div class="sp">
        <div>${esc(o.customer || '(ไม่ระบุลูกค้า)')}</div>
        <div class="mut small">${esc(o.name)} · <span class="tag ${o.kind === 'inst' ? 'wait' : 'ok'}">${o.kind === 'inst' ? 'ค้างดาวน์' : 'ค้างชำระ'}</span> · ${esc(o.bill)} · ${esc(o.date)}${all ? ' · ' + esc(locName(o.loc)) : ''}</div></div>
        <div class="num">${baht(o.balance)}</div></button>`).join('')
      : '<div class="mut" style="padding:12px 0">ไม่มีรายการค้าง</div>';
    $$('[data-o]', el).forEach((b) => { b.onclick = () => addCollectLine(list[+b.dataset.o]); });
  };
  $('#cq', el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $('#ca', el).onchange = (e) => { all = e.target.checked; draw(); };
  $('#manual', el).onclick = manualCollect;
  draw();
}

function addCollectLine(o) {
  const v = prompt(`${o.kind === 'inst' ? 'เก็บเงินดาวน์เพิ่ม' : 'เก็บเพิ่ม'} — ${o.customer || o.name}\nยอดค้าง ${baht(o.balance)} เก็บเท่าไหร่?`, o.balance);
  if (v == null) return;
  const p = r2(parseFloat(String(v).replace(/,/g, '')));
  if (!(p > 0) || p > o.balance + 0.001) return toast('ยอดไม่ถูกต้อง', true);
  S.cart.push({ key: randomId(6), id: o.itemId, name: o.name, plan: o.plan || { kind: o.kind },
    stage: o.kind === 'inst' ? 'collectDown' : 'collect', due: o.balance, price: p, qty: 1,
    refBill: o.bill, refLine: o.line, customer: o.customer || '' });
  cartChanged(); closeSheet(); render();
  toast('เพิ่มรายการเก็บเงินแล้ว');
}

function manualCollect() {
  const its = items();
  const el = sheet(`${head('เก็บเงินบิลนอกระบบ')}
    <div class="mut small">ใช้กับลูกค้าที่ขายไว้ใน Loyverse ก่อนเปลี่ยนมาใช้แอปนี้ (ไม่ตัดสต็อก)</div>
    <label class="f">สินค้า</label><select class="inp" id="mi">${its.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select>
    <div class="seg" style="grid-template-columns:1fr 1fr"><button data-k="cash" class="on">เก็บเพิ่ม (ขายสด)</button><button data-k="inst">เก็บเงินดาวน์เพิ่ม (ผ่อน)</button></div>
    <label class="f">ยอดที่เก็บ</label><input class="inp num" id="ma" type="number" inputmode="decimal">
    <label class="f">ลูกค้า (ชื่อ / เบอร์)</label><input class="inp" id="mc" maxlength="120">
    <label class="f">เลขใบเสร็จ Loyverse (ถ้ามี)</label><input class="inp" id="mr" maxlength="40">
    <button class="btn pri block" id="mok" style="margin-top:12px">เพิ่มลงตะกร้า</button>`);
  let kind = 'cash';
  $$('[data-k]', el).forEach((b) => { b.onclick = () => { kind = b.dataset.k; $$('[data-k]', el).forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('#mok', el).onclick = () => {
    const it = its.find((i) => i.id === $('#mi', el).value);
    const a = r2(parseFloat($('#ma', el).value));
    const c = $('#mc', el).value.trim();
    if (!it) return toast('เลือกสินค้า', true);
    if (!(a > 0)) return toast('ใส่ยอดที่เก็บ', true);
    if (!c) return toast('ใส่ชื่อหรือเบอร์ลูกค้า', true);
    const ref = $('#mr', el).value.trim().replace(/[^A-Za-z0-9.\-]/g, '');
    S.cart.push({ key: randomId(6), id: it.id, name: it.name, plan: { kind },
      stage: kind === 'inst' ? 'collectDown' : 'collect', due: a, price: a, qty: 1,
      refBill: 'LV-' + (ref || 'ไม่ระบุ'), refLine: 0, customer: c });
    cartChanged(); closeSheet(); render();
  };
}

/* ---------- shifts ---------- */
const openShift = (loc = S.loc) => S.shifts.find((s) => s.loc === loc && !s.closeAt);
function shiftTotals(s) {
  const bs = S.bills.filter((b) => b.shiftId === s.id && !b.void);
  const by = { cash: 0, transfer: 0, other: 0 };
  bs.forEach((b) => { by[b.method] = r2((by[b.method] || 0) + b.total); });
  return { bills: bs.length, by, total: r2(bs.reduce((a, b) => a + b.total, 0)), expected: r2((s.openingCash || 0) + by.cash) };
}

/* ---------- render ---------- */
function renderBadge() {
  const n = pendingBills().length;
  const p = $('#pend');
  p.textContent = S.syncing ? 'กำลังส่ง…' : `รอส่ง ${n}`;
  p.classList.toggle('hidden', !n && !S.syncing);
  $('#netDot').classList.toggle('off', !navigator.onLine);
  $('#teamName').textContent = S.loc ? locName(S.loc) : 'เลือกทีม';
}

function renderCartBar() {
  const bar = $('#cartbar');
  const show = S.view === 'sell' && S.cart.length > 0;
  bar.classList.toggle('hidden', !show);
  $('#cartN').textContent = cartCount();
  $('#cartT').textContent = baht(cartTotal());
}

function banners() {
  let h = '';
  if (S.authLost) h += `<div class="banner"><span class="sp">การเข้าสู่ระบบหมดอายุ — บิลยังอยู่ในเครื่อง เข้าสู่ระบบใหม่เพื่อส่ง</span><button class="btn" id="reLogin">เข้าสู่ระบบ</button></div>`;
  if (!navigator.onLine) h += `<div class="banner">ออฟไลน์อยู่ — ขายได้ตามปกติ บิลจะส่งอัตโนมัติเมื่อมีเน็ต</div>`;
  return h;
}
function bindBanners(root) {
  const b = $('#reLogin', root);
  if (b) b.onclick = () => { showLogin(); startLogin(); };
}

function render() {
  if (!S.session) return showLogin();
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
  const v = $('#view');
  ({ sell: renderSell, bills: renderBills, shift: renderShift, report: renderReport, settings: renderSettings })[S.view](v);
  bindBanners(v);
  renderBadge();
  renderCartBar();
}

/* ----- sell ----- */
function renderSell(v) {
  const cats = Array.from(new Set(items().map((i) => i.cat || i.type).filter(Boolean)));
  const noShift = S.loc && !openShift();
  v.innerHTML = `${banners()}
    ${noShift ? `<div class="banner"><span class="sp">ยังไม่เปิดกะของทีมนี้ (ไม่บังคับ แต่ช่วยนับเงินสด)</span><button class="btn" id="goShift">เปิดกะ</button></div>` : ''}
    ${!items().length ? `<div class="card mut">ยังไม่มีรายการสินค้า — ต่อเน็ตแล้วไปที่ ตั้งค่า › โหลดสินค้า/ราคาใหม่</div>` : ''}
    <div class="searchrow">
      <input class="search" id="q" placeholder="ค้นหา / ยิงบาร์โค้ด" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search">
      <button class="iconbtn" id="scanBtn" aria-label="สแกน"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/></svg></button>
    </div>
    ${(() => { const n = outstandingList().filter((o) => o.loc === S.loc).length;
      return `<button class="btn block" id="colBtn" style="margin-bottom:8px">เก็บเพิ่ม / เก็บเงินดาวน์เพิ่ม${n ? ` <span class="pend">${n} รายการค้าง</span>` : ''}</button>`; })()}
    <div class="chips">${['', ...cats].map((c) => `<button class="chip ${S.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c || 'ทั้งหมด')}</button>`).join('')}</div>
    <div class="grid" id="grid"></div>`;
  const q = $('#q', v);
  q.oninput = () => { S.q = q.value; renderGrid(); };
  q.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = q.value.trim();
    if (!code) return;
    const it = findByCode(code) || (filtered().length === 1 ? filtered()[0] : null);
    if (it) { q.value = ''; S.q = ''; addToCart(it); renderGrid(); }
    else toast('ไม่พบสินค้า: ' + code, true);
  };
  $('#scanBtn', v).onclick = openScanner;
  $('#colBtn', v).onclick = openCollect;
  $$('.chip', v).forEach((c) => { c.onclick = () => { S.cat = c.dataset.cat; render(); }; });
  const gs = $('#goShift', v);
  if (gs) gs.onclick = () => go('shift');
  renderGrid();
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return items().filter((i) => (!S.cat || (i.cat || i.type) === S.cat) &&
    (!q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q)));
}

function renderGrid() {
  const g = $('#grid');
  if (!g) return;
  const inCart = {};
  S.cart.forEach((l) => { if (!isCollect(l)) inCart[l.id] = (inCart[l.id] || 0) + l.qty; });
  const list = filtered();
  g.innerHTML = list.length ? list.map((i) => {
    const ps = plansOf(i);
    const cash = ps.find((p) => p.kind === 'cash');
    const insts = ps.filter((p) => p.kind === 'inst');
    const price = cash ? `<span class="pr num">${baht(cash.total)}</span>`
      : insts.length ? `<span class="pr num">ดาวน์ ${baht(Math.min(...insts.map((p) => p.down)))}</span>`
      : `<span class="pr zero">ไม่มีราคา · กดเพื่อระบุ</span>`;
    return `<button class="item" data-id="${esc(i.id)}">
      ${inCart[i.id] ? `<span class="q">${inCart[i.id]}</span>` : ''}
      <span class="nm">${esc(i.name)}</span>
      <span>${price}${insts.length ? `<span class="mut small" style="display:block">ผ่อนได้ ${insts.length} แบบ</span>` : ''}</span>
    </button>`;
  }).join('') : `<div class="mut" style="grid-column:1/-1;padding:20px;text-align:center">ไม่พบสินค้า</div>`;
  $$('.item', g).forEach((b) => { b.onclick = () => { const it = items().find((x) => x.id === b.dataset.id); if (it) addToCart(it); }; });
}

function openCart() {
  if (!S.cart.length) return;
  const el = sheet(`${head('ตะกร้า · ' + locName(S.loc))}<div class="mut small">แตะรายการเพื่อเปลี่ยนตัวเลือกการชำระ / ราคา / จำนวน</div>
    <div class="list" id="cl"></div>
    <div class="total"><span>รับเงินวันนี้</span><span class="num" id="ct"></span></div>
    <div class="row mut" id="cbr"><span class="sp">ค้างเก็บภายหลัง</span><span class="num" id="cb"></span></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="clr">ล้าง</button><button class="btn pri sp" id="pay">ชำระเงิน</button></div>`);
  const draw = () => {
    if (!S.cart.length) { closeSheet(); render(); return; }
    $('#cl', el).innerHTML = S.cart.map((l, i) => {
      const bal = lineBal(l);
      return `<button class="li" data-e="${i}" style="width:100%;text-align:left"><div class="sp">
        <div>${esc(l.name)}${lineQty(l) > 1 ? ` <b>× ${l.qty}</b>` : ''}</div>
        <div class="mut small">${esc(planLabel(l.plan))}</div>
        <div class="small"><span class="tag ${isCollect(l) ? 'ok' : l.plan.kind === 'inst' ? 'wait' : 'ok'}">${STAGE[l.stage]}</span>
          ${isCollect(l) ? `<span class="mut">อ้างอิง ${esc(l.refBill)}</span>` : ''}
          ${bal > 0 ? `<span style="color:var(--warn)">ค้าง ${baht(bal)}</span>` : ''}</div></div>
        <div class="num" style="min-width:80px;text-align:right">${baht(lineQty(l) * l.price)}</div></button>`;
    }).join('');
    $('#ct', el).textContent = baht(cartTotal());
    $('#cb', el).textContent = baht(cartBalance());
    $('#cbr', el).classList.toggle('hidden', !cartBalance());
    $$('[data-e]', el).forEach((b) => { b.onclick = () => editLine(+b.dataset.e, openCart); });
  };
  draw();
  $('#clr', el).onclick = () => { if (confirm('ล้างตะกร้าทั้งหมด?')) { S.cart = []; cartChanged(); closeSheet(); render(); } };
  $('#pay', el).onclick = openPay;
}

/* ----- pay ----- */
function openPay() {
  if (!S.loc) return toast('เลือกทีมก่อนขาย', true);
  const t = cartTotal(), bal = cartBalance();
  const st0 = (S.data && S.data.settings) || {};
  const needCustomer = bal > 0 || S.cart.some(isCollect);
  const preCust = (S.cart.find((l) => l.customer) || {}).customer || '';
  const st = { method: 'cash' };
  const el = sheet(`${head(S.cart.every(isCollect) ? 'รับชำระ' : 'ชำระเงิน')}
    <div class="total" style="border-top:0;margin-top:0"><span>รับเงินวันนี้</span><span class="num">${baht(t)}</span></div>
    ${bal > 0 ? `<div class="banner">ค้างเก็บภายหลัง ${baht(bal)} — ต้องใส่ชื่อ/เบอร์ลูกค้าเพื่อตามเก็บ</div>` : ''}
    <div class="seg">${Object.keys(METHOD).map((m) => `<button data-mt="${m}">${METHOD[m]}</button>`).join('')}</div>
    <div id="mbody"></div>
    <label class="f">ลูกค้า (ชื่อ / เบอร์)${needCustomer ? ' *' : ''}</label><input class="inp" id="cust" maxlength="120" value="${esc(preCust)}">
    <label class="f">หมายเหตุ</label><input class="inp" id="note" maxlength="120">
    <button class="btn pri block" id="confirm" style="margin-top:14px">ยืนยัน</button>`);
  const drawBody = () => {
    $$('[data-mt]', el).forEach((b) => b.classList.toggle('on', b.dataset.mt === st.method));
    const mb = $('#mbody', el);
    if (st.method === 'cash') {
      const q = Array.from(new Set([t, Math.ceil(t / 100) * 100, Math.ceil(t / 500) * 500, Math.ceil(t / 1000) * 1000, Math.ceil(t / 1000) * 1000 + 1000])).filter((x) => x >= t).slice(0, 4);
      mb.innerHTML = `<label class="f">รับเงินมา</label><input class="inp num" id="cash" type="number" inputmode="decimal" style="font-size:22px">
        <div class="quick">${q.map((x, i) => `<button data-q="${x}">${i === 0 ? 'พอดี' : baht(x)}</button>`).join('')}</div>
        <div class="total"><span>เงินทอน</span><span class="num" id="chg">-</span></div>`;
      const ci = $('#cash', mb);
      const upd = () => { const c = parseFloat(ci.value) || 0; $('#chg', mb).textContent = c >= t ? baht(c - t) : '-'; };
      ci.oninput = upd;
      $$('[data-q]', mb).forEach((b) => { b.onclick = () => { ci.value = b.dataset.q; upd(); }; });
    } else if (st.method === 'transfer') {
      mb.innerHTML = (st0.payQr ? `<div class="qrbox"><img src="${st0.payQr}" alt="QR รับเงิน"></div>
          ${st0.payQrLabel ? `<div style="text-align:center">${esc(st0.payQrLabel)}</div>` : ''}`
        : `<div class="mut small">ยังไม่ได้แนบรูป QR รับเงิน (Admin: ตั้งค่า › ตั้งค่าร้านและใบเสร็จ)</div>`) +
        `<div style="text-align:center;margin-top:6px"><span class="mut small">ให้ลูกค้าโอนยอด</span><div class="num" style="font-size:30px;color:var(--ok)">${baht(t)}</div></div>
         <div class="mut small" style="text-align:center">ตรวจยอดเงินเข้าก่อนกดยืนยัน</div>`;
    } else {
      mb.innerHTML = `<div class="mut small">ระบุช่องทางในหมายเหตุ เช่น บัตรเครดิต</div>`;
    }
  };
  $$('[data-mt]', el).forEach((b) => { b.onclick = () => { st.method = b.dataset.mt; drawBody(); }; });
  drawBody();
  $('#confirm', el).onclick = () => {
    let cash = 0, change = 0;
    if (st.method === 'cash') {
      const ci = $('#cash', el);
      cash = ci && ci.value !== '' ? r2(parseFloat(ci.value)) : t;
      if (cash < t) return toast('รับเงินน้อยกว่ายอดที่ต้องชำระ', true);
      change = r2(cash - t);
    }
    const customer = $('#cust', el).value.trim();
    const note = $('#note', el).value.trim();
    if (needCustomer && !customer) return toast('ใส่ชื่อหรือเบอร์ลูกค้า', true);
    if (st.method === 'other' && !note) return toast('ระบุช่องทางชำระในหมายเหตุ', true);
    createBill({ method: st.method, cash, change, note, customer });
  };
}

function newBillId() {
  const d = new Date();
  const day = `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const seq = store.get('seq', { d: '', n: 0 });
  if (seq.d !== day) { seq.d = day; seq.n = 0; }
  seq.n++;
  store.set('seq', seq);
  return `${S.loc}-${day}-${S.device}${pad(seq.n, 3)}`;
}

function createBill(p) {
  const u = user();
  const sh = openShift();
  const lines = S.cart.map((l) => ({
    id: l.id, name: l.name, qty: lineQty(l), price: l.price, due: l.due, stage: l.stage, plan: l.plan,
    refBill: l.refBill || '', refLine: l.refLine || 0
  }));
  const total = cartTotal();
  const bill = {
    id: newBillId(), loc: S.loc, createdAt: Date.now(), sellerId: u.id, sellerName: u.name, device: S.device,
    shiftId: sh ? sh.id : '', type: S.cart.every(isCollect) ? 'COLLECT' : 'SALE', lines,
    subtotal: total, discount: 0, total, balance: cartBalance(), method: p.method,
    cash: p.cash, change: p.change, note: p.note, customer: p.customer, synced: 0
  };
  S.bills.unshift(bill);
  saveBills();
  S.cart = []; saveCart();
  render();
  showReceipt(bill, true);
  if (S.prn.auto && S.prn.mode !== 'none') printBill(bill);
  syncNow();
}

async function showReceipt(bill, fresh) {
  const el = sheet(`${head(fresh ? 'ขายสำเร็จ' : 'บิล ' + bill.id)}
    ${fresh && bill.method === 'cash' && bill.change ? `<div class="card" style="text-align:center"><div class="mut">เงินทอน</div><div class="num" style="font-size:38px;color:var(--ok)">${baht(bill.change)}</div></div>` : ''}
    <div class="row small"><span class="tag ${bill.void ? 'void' : bill.synced ? 'ok' : bill.err ? 'err' : 'wait'}">${bill.void ? 'ยกเลิกแล้ว' : bill.synced ? 'ส่งแล้ว' : bill.err ? 'ส่งไม่ผ่าน' : 'รอส่ง'}</span>
      <span class="mut">${esc(bill.id)}</span></div>
    ${bill.err ? `<div class="banner" style="margin-top:8px">${esc(bill.err)}</div>` : ''}
    <div class="receipt-prev" id="rp"></div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn pri sp" id="pr">พิมพ์</button>
      <button class="btn sp" id="sh">แชร์รูป</button>
      ${!fresh && user().manager && !bill.void ? `<button class="btn sp" id="vd">ยกเลิกบิล</button>` : ''}
    </div>
    ${fresh ? `<button class="btn ok block" style="margin-top:8px" data-close>ขายบิลถัดไป</button>` : ''}`);
  $('#pr', el).onclick = () => printBill(bill);
  $('#sh', el).onclick = async () => shareCanvas(await receiptCanvas(bill), `receipt-${bill.id}.png`);
  const vd = $('#vd', el);
  if (vd) vd.onclick = () => voidBill(bill.id);
  const cv = await receiptCanvas(bill);
  const rp = $('#rp', el);
  if (rp) rp.appendChild(cv);
}

async function voidBill(id) {
  if (!navigator.onLine) return toast('ยกเลิกบิลต้องต่ออินเทอร์เน็ต', true);
  const local = S.bills.find((b) => b.id === id);
  if (local && !local.synced) { await syncNow(); if (!local.synced) return toast('ส่งบิลนี้ขึ้นระบบไม่ได้ ยังยกเลิกไม่ได้', true); }
  const reason = prompt('เหตุผลที่ยกเลิกบิล ' + id);
  if (!reason || !reason.trim()) return;
  try {
    await api('voidBill', { billId: id, reason: reason.trim() });
    if (local) { local.void = true; saveBills(); }
    if (S.report) S.report.bills.forEach((b) => { if (b.id === id) b.status = 'VOID'; });
    toast('ยกเลิกบิลแล้ว');
    closeSheet(); render();
  } catch (e) { toast(e.message, true); }
}

/* ----- bills ----- */
function renderBills(v) {
  const day = S.billDay || ymd(Date.now());
  const list = S.bills.filter((b) => ymd(b.createdAt) === day && mine(b.loc));
  const ok = list.filter((b) => !b.void);
  const pend = pendingBills();
  v.innerHTML = `${banners()}
    <div class="row" style="margin-bottom:10px"><input class="inp" type="date" id="bd" value="${day}" style="max-width:190px">
      <span class="sp"></span><button class="btn" id="sync">ส่งข้อมูล${pend.length ? ' (' + pend.length + ')' : ''}</button></div>
    <div class="kpis"><div class="kpi"><div class="mut small">ยอดขาย (เครื่องนี้)</div><div class="v num">${baht(ok.reduce((a, b) => a + b.total, 0))}</div></div>
      <div class="kpi"><div class="mut small">จำนวนบิล</div><div class="v num">${ok.length}</div></div></div>
    <div class="card list">${list.length ? list.map((b) => `
      <button class="li" data-b="${esc(b.id)}" style="width:100%;text-align:left">
        <div class="sp"><div class="num">${hm(b.createdAt)} · ${esc(locName(b.loc))}</div><div class="mut small">${esc(b.id)} · ${METHOD[b.method] || b.method}${b.type === 'COLLECT' ? ' · เก็บเงิน' : ''}${b.balance ? ` · <span style="color:var(--warn)">ค้าง ${baht(b.balance)}</span>` : ''}${b.customer ? ' · ' + esc(b.customer) : ''}</div></div>
        <div style="text-align:right"><div class="num" ${b.void ? 'style="text-decoration:line-through"' : ''}>${baht(b.total)}</div>
        <span class="tag ${b.void ? 'void' : b.synced ? 'ok' : b.err ? 'err' : 'wait'}">${b.void ? 'ยกเลิก' : b.synced ? 'ส่งแล้ว' : b.err ? 'ส่งไม่ผ่าน' : 'รอส่ง'}</span></div>
      </button>`).join('') : '<div class="mut">ไม่มีบิลในวันนี้บนเครื่องนี้</div>'}</div>`;
  $('#bd', v).onchange = (e) => { S.billDay = e.target.value; render(); };
  $('#sync', v).onclick = () => syncNow(true);
  $$('[data-b]', v).forEach((b) => { b.onclick = () => showReceipt(S.bills.find((x) => x.id === b.dataset.b)); });
}

/* ----- shift ----- */
function renderShift(v) {
  const s = openShift();
  const hist = S.shifts.filter((x) => x.closeAt && x.loc === S.loc).sort((a, b) => b.closeAt - a.closeAt).slice(0, 10);
  if (!S.loc) { v.innerHTML = '<div class="card mut">เลือกทีมก่อน</div>'; return; }
  if (!s) {
    v.innerHTML = `${banners()}<div class="card"><h3>เปิดกะ · ${esc(locName(S.loc))}</h3>
      <label class="f">เงินทอนตั้งต้นในกระเป๋า (บาท)</label><input class="inp num" id="oc" type="number" inputmode="decimal" placeholder="0">
      <button class="btn pri block" id="open" style="margin-top:12px">เปิดกะ</button></div>${shiftHist(hist)}`;
    $('#open', v).onclick = () => {
      const u = user();
      S.shifts.push({ id: `SH-${S.loc}-${randomId(6)}`, loc: S.loc, userId: u.id, userName: u.name, openAt: Date.now(),
        openingCash: r2(parseFloat($('#oc', v).value) || 0), dirty: true });
      saveShifts(); render(); syncNow();
    };
  } else {
    const t = shiftTotals(s);
    v.innerHTML = `${banners()}<div class="card"><div class="row"><h3 class="sp">กะที่เปิดอยู่ · ${esc(locName(s.loc))}</h3><span class="mut small">เปิด ${dt(s.openAt)}</span></div>
      <div class="list" style="margin-top:6px">
        <div class="li"><span class="sp">เงินตั้งต้น</span><span class="num">${baht(s.openingCash)}</span></div>
        <div class="li"><span class="sp">ขายเงินสด</span><span class="num">${baht(t.by.cash)}</span></div>
        <div class="li"><span class="sp">โอน/QR</span><span class="num">${baht(t.by.transfer)}</span></div>
        <div class="li"><span class="sp">อื่นๆ</span><span class="num">${baht(t.by.other)}</span></div>
        <div class="li"><span class="sp">จำนวนบิล (เครื่องนี้)</span><span class="num">${t.bills}</span></div>
        <div class="li"><b class="sp">เงินสดที่ควรมี</b><b class="num">${baht(t.expected)}</b></div>
      </div>
      <label class="f">นับเงินสดจริง (บาท)</label><input class="inp num" id="cc" type="number" inputmode="decimal">
      <div class="row" style="margin-top:6px"><span class="sp mut">ส่วนต่าง</span><span class="num" id="df">-</span></div>
      <label class="f">หมายเหตุ</label><input class="inp" id="sn" maxlength="120">
      <button class="btn pri block" id="close" style="margin-top:12px">ปิดกะ</button></div>${shiftHist(hist)}`;
    const cc = $('#cc', v);
    cc.oninput = () => { const d = r2((parseFloat(cc.value) || 0) - t.expected); $('#df', v).textContent = cc.value === '' ? '-' : sbaht(d); };
    $('#close', v).onclick = () => {
      if (cc.value === '') return toast('กรอกเงินสดที่นับได้', true);
      if (!confirm('ปิดกะนี้?')) return;
      const tt = shiftTotals(s);
      Object.assign(s, { closeAt: Date.now(), cashSales: tt.by.cash, expected: tt.expected, counted: r2(parseFloat(cc.value)),
        bills: tt.bills, note: $('#sn', v).value.trim(), dirty: true });
      s.diff = r2(s.counted - s.expected);
      saveShifts(); render(); syncNow();
      if (S.prn.mode !== 'none' && confirm('พิมพ์สรุปกะ?')) printOps(shiftOps(s, tt));
    };
  }
  $$('[data-sh]', v).forEach((b) => {
    b.onclick = () => { const x = S.shifts.find((y) => y.id === b.dataset.sh); if (x) printOps(shiftOps(x, shiftTotals(x))); };
  });
}
function shiftHist(h) {
  if (!h.length) return '';
  return `<div class="card list"><div class="mut small">กะที่ปิดแล้ว (เครื่องนี้)</div>${h.map((s) => `
    <div class="li"><div class="sp"><div class="num">${dt(s.closeAt)}</div><div class="mut small">${esc(s.userName)} · ${s.bills} บิล</div></div>
    <div style="text-align:right"><div class="num">${baht(s.counted)}</div><div class="small ${s.diff ? '' : 'mut'}" style="${s.diff < 0 ? 'color:#ff7b80' : ''}">ต่าง ${sbaht(s.diff)}</div></div>
    ${S.prn.mode !== 'none' ? `<button class="btn" data-sh="${esc(s.id)}">พิมพ์</button>` : ''}</div>`).join('')}</div>`;
}

/* ----- report ----- */
function renderReport(v) {
  const r = S.report;
  const f = S.rf || { from: ymd(Date.now()), to: ymd(Date.now()), loc: '' };
  S.rf = f;
  v.innerHTML = `${banners()}<div class="card">
    <div class="row"><input class="inp" type="date" id="rf" value="${f.from}"><span class="mut">ถึง</span><input class="inp" type="date" id="rt" value="${f.to}"></div>
    <select class="inp" id="rl" style="margin-top:8px"><option value="">ทุกทีมที่ดูได้</option>${locs().map((l) => `<option value="${esc(l.id)}" ${f.loc === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <button class="btn pri block" id="load" style="margin-top:8px">ดูรายงาน</button>
    <div class="mut small" style="margin-top:6px">ข้อมูลจากเซิร์ฟเวอร์ (เฉพาะบิลที่ส่งแล้ว) · ต้องต่อเน็ต</div></div>
    <div id="rout"></div>`;
  const read = () => { f.from = $('#rf', v).value; f.to = $('#rt', v).value || f.from; f.loc = $('#rl', v).value; };
  $('#load', v).onclick = async () => {
    read();
    const out = $('#rout', v);
    out.innerHTML = '<div class="card mut">กำลังโหลด…</div>';
    try { S.report = await api('report', f); drawReport(out); }
    catch (e) { out.innerHTML = `<div class="banner">${esc(e.message)}</div>`; if (e.auth) { S.authLost = true; render(); } }
  };
  if (r) drawReport($('#rout', v));
}
function drawReport(out) {
  const r = S.report;
  const maxLoc = Math.max(1, ...r.byLoc.map((x) => x.total));
  out.innerHTML = `
    <div class="kpis"><div class="kpi"><div class="mut small">ยอดขายสุทธิ</div><div class="v num">${baht(r.total)}</div></div>
      <div class="kpi"><div class="mut small">บิล · ยกเลิก</div><div class="v num">${r.count} · ${r.voids}</div></div></div>
    <div class="card"><h3 style="font-size:16px">ตามทีม</h3>${r.byLoc.map((x) => `
      <div style="margin-top:10px"><div class="row"><span class="sp">${esc(x.name)}</span><span class="num">${baht(x.total)}</span><span class="mut small">${x.bills} บิล</span></div>
      <div class="bar"><i style="width:${(x.total / maxLoc) * 100}%"></i></div></div>`).join('') || '<div class="mut">ไม่มีข้อมูล</div>'}</div>
    <div class="card"><h3 style="font-size:16px">ตัวเลือกการชำระ</h3><div class="list">${Object.keys(r.byStage || {}).map((m) => `
      <div class="li"><span class="sp">${esc(m)}</span><span class="num">${baht(r.byStage[m])}</span></div>`).join('') || '<div class="mut">-</div>'}</div>
      <div class="mut small" style="margin-top:6px">ขายออก ${r.units || 0} ชิ้น (ไม่นับบิลเก็บเงิน)</div></div>
    <div class="card"><h3 style="font-size:16px">ช่องทางชำระ</h3><div class="list">${Object.keys(r.byMethod).map((m) => `
      <div class="li"><span class="sp">${METHOD[m] || esc(m)}</span><span class="num">${baht(r.byMethod[m])}</span></div>`).join('') || '<div class="mut">-</div>'}</div></div>
    <div class="card"><h3 style="font-size:16px">สินค้าขายดี</h3><div class="list">${r.items.map((i) => `
      <div class="li"><span class="sp">${esc(i.name)}</span><span class="num">${i.qty} ชิ้น</span><span class="num mut" style="min-width:80px;text-align:right">${baht(i.total)}</span></div>`).join('') || '<div class="mut">-</div>'}</div></div>
    <div class="card"><h3 style="font-size:16px">รายการบิล</h3><div class="list">${r.bills.map((b) => `
      <div class="li"><div class="sp"><div class="num">${b.date.slice(5)} ${esc(b.time)} · ${esc(b.loc)}</div><div class="mut small">${esc(b.id)} · ${esc(b.seller)}</div></div>
      <div style="text-align:right"><div class="num" ${b.status === 'VOID' ? 'style="text-decoration:line-through"' : ''}>${baht(b.total)}</div>
      ${b.status === 'VOID' ? '<span class="tag void">ยกเลิก</span>' : (user().manager ? `<button class="mut small" data-vb="${esc(b.id)}">ยกเลิกบิล</button>` : '')}</div></div>`).join('') || '<div class="mut">-</div>'}</div></div>`;
  $$('[data-vb]', out).forEach((b) => { b.onclick = () => voidBill(b.dataset.vb); });
}

/* ----- settings ----- */
function renderSettings(v) {
  const u = user();
  const p = S.prn;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  v.innerHTML = `${banners()}
    <div class="card"><div class="row"><div class="sp"><h3>${esc(u.name)}</h3><div class="mut small">${esc(u.role)} · ขายได้ ${locs().length} ทีม</div></div>
      <button class="btn" id="out">ออก</button></div></div>
    ${!standalone ? `<div class="card"><h3 style="font-size:16px">ติดตั้งลงเครื่อง</h3>
      <div class="mut small" style="margin:6px 0 10px">ติดตั้งเป็นแอปเพื่อให้เปิดได้ตอนไม่มีเน็ต${S.installEvt ? '' : ' — Android: เมนู ⋮ › เพิ่มลงหน้าจอหลัก / iPhone: ปุ่มแชร์ › เพิ่มไปยังหน้าจอโฮม'}</div>
      ${S.installEvt ? '<button class="btn pri block" id="inst">ติดตั้งแอป</button>' : ''}</div>` : ''}
    ${u.admin ? `<div class="card"><div class="row"><div class="sp"><h3 style="font-size:16px">ตั้งค่าร้านและใบเสร็จ</h3>
      <div class="mut small">โลโก้ ชื่อร้าน ที่อยู่ เบอร์โทร ข้อความ/QR ท้ายใบเสร็จ และรูป QR รับเงิน</div></div>
      <button class="btn pri" id="shopSet">แก้ไข</button></div></div>` : ''}
    ${u.admin ? `<div class="card"><div class="row"><div class="sp"><h3 style="font-size:16px">แผนราคา สด / ผ่อน</h3>
      <div class="mut small">ราคาสด แบบผ่อน (ค่างวด × งวด) เงินดาวน์ ของแต่ละสินค้า</div></div>
      <button class="btn pri" id="planSet">แก้ไข</button></div></div>` : ''}
    <div class="card"><h3 style="font-size:16px">เครื่องพิมพ์ใบเสร็จ</h3>
      <label class="f">วิธีพิมพ์</label>
      <select class="inp" id="pm">
        <option value="none">ไม่พิมพ์ (ใช้แชร์รูปเมื่อต้องการ)</option>
        <option value="ble">Bluetooth ตรงจากแอป (Android + Chrome, เครื่อง BLE)</option>
        <option value="rawbt">ผ่านแอป RawBT (Android, ทุกเครื่อง ESC/POS)</option>
        <option value="share">แชร์รูปใบเสร็จไปแอปเครื่องพิมพ์ (iPhone/iPad)</option>
      </select>
      <label class="f">ขนาดกระดาษ</label>
      <div class="seg" style="grid-template-columns:1fr 1fr"><button data-pp="58">58 mm</button><button data-pp="80">80 mm</button></div>
      <div id="bleBox" class="${p.mode === 'ble' ? '' : 'hidden'}">
        <div class="row"><span class="sp small" id="bleSt"></span><button class="btn" id="bleC">เชื่อมต่อ</button></div>
        <label class="f">ขนาดก้อนข้อมูล (ลดลงถ้าพิมพ์ขาด/ค้าง)</label>
        <select class="inp" id="ck">${[20, 100, 180, 512].map((n) => `<option ${p.chunk === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </div>
      <label class="row" style="margin-top:12px"><input type="checkbox" id="ap" ${p.auto ? 'checked' : ''}><span>พิมพ์อัตโนมัติหลังขายเสร็จ</span></label>
      <button class="btn block" id="tp" style="margin-top:10px">พิมพ์ทดสอบ</button></div>
    <div class="card"><h3 style="font-size:16px">ข้อมูล</h3><div class="list">
      <div class="li"><span class="sp">สินค้า/ราคา อัปเดตล่าสุด</span><span class="mut small">${S.data && S.data.at ? dt(S.data.at) : '-'}</span></div>
      <div class="li"><span class="sp">บิลรอส่ง</span><span class="num">${pendingBills().length}</span></div>
      <div class="li"><span class="sp">โหมดสต็อก</span><span class="mut small">${S.data && S.data.stockMode === 'live' ? 'ตัดสต็อกทีมจริง' : 'บันทึกบิลอย่างเดียว (ทดลองคู่ Loyverse)'}</span></div>
    </div>
      <div class="row" style="margin-top:8px"><button class="btn sp" id="rd">โหลดสินค้า/ราคาใหม่</button><button class="btn sp" id="sy">ส่งข้อมูลตอนนี้</button></div></div>
    <div class="mut small" style="text-align:center">PBD POS ${esc(CFG.APP_VERSION || '')} · เครื่อง ${esc(S.device)}</div>`;
  $('#pm', v).value = p.mode;
  $('#pm', v).onchange = (e) => { p.mode = e.target.value; savePrn(); render(); };
  $$('[data-pp]', v).forEach((b) => { b.classList.toggle('on', +b.dataset.pp === +p.paper); b.onclick = () => { p.paper = +b.dataset.pp; savePrn(); render(); }; });
  $('#ap', v).onchange = (e) => { p.auto = e.target.checked; savePrn(); };
  const ck = $('#ck', v); if (ck) ck.onchange = (e) => { p.chunk = +e.target.value; savePrn(); };
  $('#bleC', v).onclick = async () => { try { await bleConnect(); toast('เชื่อมต่อเครื่องพิมพ์แล้ว'); } catch (e) { toast(e.message, true); } bleStatus(); };
  bleStatus();
  $('#tp', v).onclick = () => printOps(testOps());
  $('#rd', v).onclick = () => refreshData(true);
  $('#sy', v).onclick = () => syncNow(true);
  $('#out', v).onclick = logout;
  const ss = $('#shopSet', v); if (ss) ss.onclick = openShopSettings;
  const ps = $('#planSet', v); if (ps) ps.onclick = openPlans;
  const inst = $('#inst', v);
  if (inst) inst.onclick = async () => { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); };
}

/* ----- ตั้งค่าร้าน (Admin) ----- */
const IMG_SPEC = {
  logo: { label: 'โลโก้ร้าน (หัวใบเสร็จ)', maxW: 576, maxH: 320, hint: 'พื้นขาวหรือโปร่งใส จะถูกแปลงเป็นขาวดำตอนพิมพ์' },
  footerQr: { label: 'QR ท้ายใบเสร็จ', maxW: 480, maxH: 480, hint: 'เช่น QR LINE OA / ลงทะเบียนรับประกัน' },
  payQr: { label: 'QR รับเงินโอน', maxW: 900, maxH: 900, hint: 'รูป QR จากแอปธนาคาร (ครอปให้เหลือแค่ QR)' }
};
const TEXT_SPEC = [
  ['shopName', 'ชื่อร้าน', 'input'], ['address', 'ที่อยู่', 'textarea'], ['phone', 'เบอร์โทร', 'input'],
  ['footer', 'ข้อความท้ายใบเสร็จ', 'textarea'], ['footerQrLabel', 'ข้อความใต้ QR ท้ายใบเสร็จ', 'input'],
  ['payQrLabel', 'ข้อความใต้ QR รับเงิน (ชื่อบัญชี / ธนาคาร)', 'input']
];

/** ย่อรูปในเครื่องก่อนส่ง: PNG ถ้าเล็กพอ ไม่งั้น JPEG พื้นขาว */
async function fileToDataURL(file, maxW, maxH) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    const k = Math.min(1, maxW / im.width, maxH / im.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/png');
    if (out.length > 900000) {
      const c2 = document.createElement('canvas'); c2.width = c.width; c2.height = c.height;
      const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, c2.width, c2.height); x2.drawImage(c, 0, 0);
      out = c2.toDataURL('image/jpeg', 0.9);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

function openShopSettings() {
  if (!user().admin) return;
  const cur = (S.data && S.data.settings) || {};
  const draft = {};
  TEXT_SPEC.forEach(([k]) => { draft[k] = cur[k] || ''; });
  Object.keys(IMG_SPEC).forEach((k) => { draft[k] = cur[k] || ''; });
  const changedImg = {};

  const el = sheet(`${head('ตั้งค่าร้านและใบเสร็จ')}
    <div class="mut small">ใช้กับทุกทีม · บันทึกแล้วเครื่องพนักงานจะได้ค่าใหม่เมื่อต่อเน็ต</div>
    ${Object.keys(IMG_SPEC).filter((k) => k !== 'payQr').map(imgField).join('')}
    ${TEXT_SPEC.filter(([k]) => k !== 'payQrLabel').map(textField).join('')}
    <h3 style="font-size:16px;margin-top:18px">การรับเงินโอน</h3>
    ${imgField('payQr')}${textField(TEXT_SPEC.find(([k]) => k === 'payQrLabel'))}
    <div class="row" style="margin-top:16px"><button class="btn sp" id="pvw">ดูตัวอย่างใบเสร็จ</button><button class="btn pri sp" id="save">บันทึก</button></div>
    <div class="receipt-prev hidden" id="spv"></div>`);

  function imgField(k) {
    const sp = IMG_SPEC[k];
    return `<label class="f">${sp.label}</label>
      <div class="imgpick"><div class="pv ${draft[k] ? '' : 'empty'}" id="pv_${k}">${draft[k] ? `<img src="${draft[k]}" alt="">` : 'ยังไม่มีรูป'}</div>
        <div class="sp"><div class="mut small">${sp.hint}</div>
          <div class="row" style="margin-top:6px"><button class="btn" data-pick="${k}">เลือกรูป</button><button class="btn" data-rm="${k}">ลบ</button></div></div>
        <input type="file" accept="image/*" class="hidden" id="f_${k}"></div>`;
  }
  function textField([k, label, kind]) {
    return `<label class="f">${label}</label>` + (kind === 'textarea'
      ? `<textarea class="inp" id="t_${k}" rows="2" maxlength="600">${esc(draft[k])}</textarea>`
      : `<input class="inp" id="t_${k}" maxlength="200" value="${esc(draft[k])}" ${k === 'phone' ? 'inputmode="tel"' : ''}>`);
  }
  const showImg = (k) => {
    const pv = $('#pv_' + k, el);
    pv.classList.toggle('empty', !draft[k]);
    pv.innerHTML = draft[k] ? `<img src="${draft[k]}" alt="">` : 'ยังไม่มีรูป';
  };
  const readText = () => TEXT_SPEC.forEach(([k]) => { draft[k] = $('#t_' + k, el).value.trim(); });

  $$('[data-pick]', el).forEach((b) => { b.onclick = () => $('#f_' + b.dataset.pick, el).click(); });
  $$('[data-rm]', el).forEach((b) => { b.onclick = () => { const k = b.dataset.rm; draft[k] = ''; changedImg[k] = true; showImg(k); }; });
  Object.keys(IMG_SPEC).forEach((k) => {
    $('#f_' + k, el).onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        draft[k] = await fileToDataURL(f, IMG_SPEC[k].maxW, IMG_SPEC[k].maxH);
        changedImg[k] = true; showImg(k);
      } catch (x) { toast('อ่านรูปไม่ได้', true); }
    };
  });

  $('#pvw', el).onclick = async () => {
    readText();
    const sample = {
      id: 'LS1-261116-ABC001', loc: S.loc || 'LS1', createdAt: Date.now(), sellerName: user().name,
      lines: [{ id: 'X', name: 'กล้อง PBD9888LB Alexander Silver 2 เลนส์', qty: 1, price: 3900 }],
      subtotal: 3900, discount: 0, total: 3900, method: 'cash', cash: 4000, change: 100, note: ''
    };
    const box = $('#spv', el);
    box.innerHTML = '';
    box.classList.remove('hidden');
    box.appendChild(await drawDoc(receiptOps(sample, draft)));
    box.scrollIntoView({ behavior: 'smooth' });
  };

  $('#save', el).onclick = async (e) => {
    if (!navigator.onLine) return toast('บันทึกตั้งค่าต้องต่ออินเทอร์เน็ต', true);
    readText();
    if (!draft.shopName) return toast('ใส่ชื่อร้าน', true);
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try {
      const fields = {};
      TEXT_SPEC.forEach(([k]) => { fields[k] = draft[k]; });
      const images = {};
      Object.keys(changedImg).forEach((k) => { images[k] = draft[k]; });
      const j = await api('saveSettings', { fields, images });
      S.data.settings = j.settings;
      store.set('data', S.data);
      toast('บันทึกตั้งค่าร้านแล้ว');
      closeSheet(); render();
    } catch (x) {
      toast(x.message, true);
      btn.disabled = false; btn.textContent = 'บันทึก';
    }
  };
}

/* ----- แผนราคา สด / ผ่อน (Admin) ----- */
function openPlans() {
  if (!user().admin) return;
  let q = '';
  const el = sheet(`${head('แผนราคา สด / ผ่อน')}
    <div class="mut small">แต่ละสินค้ามีได้หลายแบบ เช่น ราคาสด และผ่อนหลายแบบ — ตอนขายพนักงานเลือกแบบ แล้วเลือก ชำระวันสั่งซื้อ / ดาวน์เต็ม / แบ่งดาวน์</div>
    <input class="inp" id="pq" placeholder="ค้นหาสินค้า" style="margin-top:10px">
    <div class="list" id="pl"></div>
    <button class="btn block" id="imp" style="margin-top:10px">นำเข้าแผนจากชื่อสินค้า Loyverse</button>`);
  const draw = () => {
    const list = items().filter((i) => !q || (i.name + ' ' + i.id).toLowerCase().includes(q));
    $('#pl', el).innerHTML = list.map((i) => {
      const ps = plansOf(i);
      return `<button class="li" data-it="${esc(i.id)}" style="width:100%;text-align:left"><div class="sp"><div>${esc(i.name)}</div>
        <div class="mut small">${ps.length ? ps.map((p) => esc(p.kind === 'inst' ? `ผ่อน ${baht(p.inst)}×${p.n}` : `สด ${baht(p.total)}`)).join(' · ') : 'ยังไม่มีราคา'}</div></div>
        <span class="mut">›</span></button>`;
    }).join('');
    $$('[data-it]', el).forEach((b) => { b.onclick = () => editPlans(items().find((x) => x.id === b.dataset.it)); });
  };
  $('#pq', el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $('#imp', el).onclick = async (e) => {
    if (!navigator.onLine) return toast('ต้องต่ออินเทอร์เน็ต', true);
    const b = e.currentTarget; b.disabled = true; b.textContent = 'กำลังนำเข้า…';
    try {
      const j = await api('importPlans');
      S.data.items = j.items; store.set('data', S.data);
      toast(j.added ? `เพิ่ม ${j.added} แผนจาก Loyverse` : 'ไม่มีแผนใหม่ให้นำเข้า');
      draw();
    } catch (x) { toast(x.message, true); }
    b.disabled = false; b.textContent = 'นำเข้าแผนจากชื่อสินค้า Loyverse';
  };
  draw();
}

function editPlans(it) {
  if (!it) return;
  const rows = (it.plans || []).filter((p) => !/-PRICE$/.test(p.id)).map((p) => Object.assign({}, p));
  if (!rows.length && it.price) rows.push({ id: '', name: '', kind: 'cash', total: it.price, units: 1 });
  const el = sheet(`${head(it.name)}<div id="rows"></div>
    <button class="btn block" id="add" style="margin-top:8px">+ เพิ่มแบบการขาย</button>
    <div class="row" style="margin-top:12px"><button class="btn" id="back">กลับ</button><button class="btn pri sp" id="save">บันทึก</button></div>`);
  const n = (x) => r2(parseFloat(x) || 0);
  const preview = (p) => planLabel(Object.assign({}, p, { name: '', down: p.down || r2(p.total - p.inst * p.n) }));
  const draw = () => {
    $('#rows', el).innerHTML = rows.map((p, i) => `<div class="card" style="margin-top:10px">
      <div class="seg" style="grid-template-columns:1fr 1fr;margin-top:0"><button data-k="cash" data-i="${i}" class="${p.kind === 'cash' ? 'on' : ''}">ขายสด</button><button data-k="inst" data-i="${i}" class="${p.kind === 'inst' ? 'on' : ''}">ขายผ่อน</button></div>
      <label class="f">${p.kind === 'inst' ? 'ราคารวมทั้งสัญญา' : 'ราคาสด'}</label><input class="inp num" data-f="total" data-i="${i}" type="number" inputmode="decimal" value="${p.total || ''}">
      ${p.kind === 'inst' ? `<div class="row"><div class="sp"><label class="f">ค่างวด</label><input class="inp num" data-f="inst" data-i="${i}" type="number" inputmode="decimal" value="${p.inst || ''}"></div>
        <div class="sp"><label class="f">จำนวนงวด</label><input class="inp num" data-f="n" data-i="${i}" type="number" inputmode="numeric" value="${p.n || ''}"></div></div>
        <label class="f">เงินดาวน์ (ว่าง = ราคารวม − ค่างวด × งวด)</label><input class="inp num" data-f="down" data-i="${i}" type="number" inputmode="decimal" value="${p.down || ''}">` : ''}
      <div class="row"><div class="sp"><label class="f">ชิ้นต่อชุด (ตัดสต็อก)</label><input class="inp num" data-f="units" data-i="${i}" type="number" inputmode="numeric" value="${p.units || 1}"></div>
        <div class="sp"><label class="f">ชื่อแบบ (ไม่บังคับ)</label><input class="inp" data-f="name" data-i="${i}" maxlength="80" value="${esc(p.name || '')}"></div></div>
      <div class="row" style="margin-top:8px"><span class="sp mut small" data-lbl="${i}">${esc(p.total ? preview(p) : '')}</span><button class="btn" data-del="${i}">ลบ</button></div>
    </div>`).join('') || '<div class="mut" style="padding:10px 0">ยังไม่มีแบบการขาย</div>';
    $$('[data-k]', el).forEach((b) => { b.onclick = () => { rows[+b.dataset.i].kind = b.dataset.k; draw(); }; });
    $$('[data-f]', el).forEach((inp) => {
      inp.oninput = () => {
        const p = rows[+inp.dataset.i], f = inp.dataset.f;
        p[f] = f === 'name' ? inp.value : n(inp.value);
        const lab = $(`[data-lbl="${inp.dataset.i}"]`, el);
        if (lab) lab.textContent = p.total ? preview(p) : '';
      };
    });
    $$('[data-del]', el).forEach((b) => { b.onclick = () => { rows.splice(+b.dataset.del, 1); draw(); }; });
  };
  $('#add', el).onclick = () => { rows.push({ id: '', name: '', kind: 'inst', total: 0, inst: 0, n: 0, down: 0, units: 1 }); draw(); };
  $('#back', el).onclick = openPlans;
  $('#save', el).onclick = async (e) => {
    if (!navigator.onLine) return toast('ต้องต่ออินเทอร์เน็ต', true);
    for (const p of rows) {
      if (!(p.total > 0)) return toast('ใส่ราคาให้ครบทุกแบบ', true);
      if (p.kind === 'inst') {
        if (!(p.inst > 0 && p.n > 0)) return toast('แบบผ่อนต้องมีค่างวดและจำนวนงวด', true);
        if (!(p.down > 0)) p.down = r2(p.total - p.inst * p.n);
        if (!(p.down > 0)) return toast('เงินดาวน์ต้องมากกว่า 0 (ราคารวมน้อยกว่าค่างวด × งวด)', true);
      }
    }
    const b = e.currentTarget; b.disabled = true; b.textContent = 'กำลังบันทึก…';
    try {
      const j = await api('savePlans', { itemId: it.id, plans: rows.map((p) => ({ id: p.id, name: p.name, kind: p.kind, total: p.total, down: p.down, inst: p.inst, n: p.n, units: p.units || 1 })) });
      S.data.items = j.items; store.set('data', S.data);
      toast('บันทึกแผนราคาแล้ว');
      openPlans();
    } catch (x) { toast(x.message, true); b.disabled = false; b.textContent = 'บันทึก'; }
  };
  draw();
}

function openTeamPicker() {
  if (!locs().length) return;
  const el = sheet(`${head('เลือกทีมที่ขาย')}<div class="list">${locs().map((l) => `
    <button class="li" data-l="${esc(l.id)}" style="width:100%;text-align:left"><span class="sp">${esc(l.name)}</span>
    <span class="mut small">${esc(l.branch)}</span>${l.id === S.loc ? '<span class="tag ok">ใช้อยู่</span>' : ''}</button>`).join('')}</div>`);
  $$('[data-l]', el).forEach((b) => { b.onclick = () => { S.loc = b.dataset.l; store.set('loc', S.loc); closeSheet(); render(); }; });
}

function go(view) { S.view = view; window.scrollTo(0, 0); render(); }

/* ---------- scanner ---------- */
const SCAN = { on: false, stream: null, h5: null, done: false };
function stopScan() {
  SCAN.on = false;
  if (SCAN.stream) { SCAN.stream.getTracks().forEach((t) => t.stop()); SCAN.stream = null; }
  if (SCAN.h5) { const h = SCAN.h5; SCAN.h5 = null; h.stop().catch(() => {}).finally(() => { try { h.clear(); } catch (x) {} }); }
}
async function openScanner() {
  SCAN.done = false;
  sheet(`${head('สแกนบาร์โค้ด')}<div id="scanArea"><div class="mut">กำลังเปิดกล้อง…</div></div>
    <div class="mut small" style="margin-top:8px">เล็งบาร์โค้ดให้อยู่ในกรอบ · ใช้เครื่องยิงบาร์โค้ดได้ที่ช่องค้นหา</div>`, { onClose: stopScan });
  const hit = (code) => { if (SCAN.done) return; SCAN.done = true; closeSheet(); onCode(code); };
  const area = $('#scanArea');
  if ('BarcodeDetector' in window) {
    try {
      const fmts = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({ formats: fmts });
      area.innerHTML = '<div class="scanbox"><video playsinline muted></video><div class="aim"></div></div>';
      const vid = $('video', area);
      SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      vid.srcObject = SCAN.stream;
      await vid.play();
      SCAN.on = true;
      const loop = async () => {
        if (!SCAN.on) return;
        try { const r = await det.detect(vid); if (r.length) return hit(r[0].rawValue); } catch (x) {}
        setTimeout(loop, 180);
      };
      loop();
      return;
    } catch (e) { stopScan(); }
  }
  try {
    await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
    if (!$('#scanArea')) return;
    area.innerHTML = '<div id="scan2"></div>';
    SCAN.h5 = new Html5Qrcode('scan2');
    await SCAN.h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, hit, () => {});
  } catch (e) {
    if ($('#scanArea')) area.innerHTML = `<div class="banner">เปิดกล้องไม่ได้: ${esc(e.message || e)}</div>`;
  }
}

/* ---------- receipt drawing ---------- */
function wrapText(ctx, text, maxW) {
  const segs = typeof Intl !== 'undefined' && Intl.Segmenter
    ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(String(text)), (s) => s.segment)
    : Array.from(String(text));
  const out = []; let cur = '';
  const pushLong = (seg) => {
    for (const ch of Array.from(seg)) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; } else cur += ch;
    }
  };
  for (const seg of segs) {
    if (ctx.measureText(cur + seg).width <= maxW) { cur += seg; continue; }
    if (cur.trim()) out.push(cur.trimEnd());
    cur = seg.trimStart();
    if (ctx.measureText(cur).width > maxW) { const s = cur; cur = ''; pushLong(s); }
  }
  if (cur.trim() || !out.length) out.push(cur.trimEnd());
  return out;
}

async function drawDoc(ops) {
  try { await document.fonts.ready; } catch (x) {}
  const W = +S.prn.paper === 80 ? 576 : 384;
  const P = 6, base = W === 576 ? 26 : 23;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = 6000;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, cv.height);
  ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  const font = (sz, b) => `${b ? 600 : 400} ${sz}px "IBM Plex Sans Thai","Noto Sans Thai",Tahoma,sans-serif`;
  for (const o of ops) if (o.t === 'img') o._im = await loadImg(o.src).catch(() => null);
  let y = P + 6;
  for (const o of ops) {
    if (o.t === 'img') {
      if (!o._im) continue;
      const im = o._im;
      const maxW = Math.round(W * (o.w || 0.5));
      const maxH = o.maxH ? Math.round(base * o.maxH) : Infinity;
      const k = Math.min(maxW / im.width, maxH / im.height);
      const dw = Math.max(1, Math.round(im.width * k)), dh = Math.max(1, Math.round(im.height * k));
      const x = Math.round((W - dw) / 2);
      ctx.imageSmoothingEnabled = !o.crisp;
      ctx.drawImage(im, x, y, dw, dh);
      if (o.dither) ditherRegion(ctx, x, y, dw, dh);
      ctx.fillStyle = '#000';
      y += dh + Math.round(base * 0.35);
      continue;
    }
    const sz = Math.round(base * (o.scale || 1)), lh = Math.round(sz * 1.5);
    ctx.font = font(sz, o.bold);
    if (o.t === 'text') {
      for (const ln of wrapText(ctx, o.s, W - 2 * P)) {
        const w = ctx.measureText(ln).width;
        ctx.fillText(ln, o.align === 'center' ? (W - w) / 2 : o.align === 'right' ? W - P - w : P, y);
        y += lh;
      }
    } else if (o.t === 'row') {
      const rw = ctx.measureText(o.r).width;
      wrapText(ctx, o.l, W - 2 * P - rw - 14).forEach((ln, i) => {
        ctx.fillText(ln, P, y);
        if (i === 0) ctx.fillText(o.r, W - P - rw, y);
        y += lh;
      });
    } else if (o.t === 'hr') {
      y += Math.round(base * 0.25);
      for (let x = P; x < W - P; x += 10) ctx.fillRect(x, y, 6, 2);
      y += Math.round(base * 0.55);
    } else if (o.t === 'gap') {
      y += Math.round(base * (o.h || 0.6));
    }
  }
  y += P;
  const out = document.createElement('canvas');
  out.width = W; out.height = y;
  out.getContext('2d').drawImage(cv, 0, 0);
  return out;
}

function loadImg(src) {
  return new Promise((res, rej) => {
    if (!src) return rej(new Error('no image'));
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('โหลดรูปไม่ได้'));
    im.src = src;
  });
}

/** แปลงรูปเป็นขาวดำแบบจุด (Floyd–Steinberg) ให้โลโก้สี/ไล่เฉดพิมพ์ออกมาสวยบนกระดาษความร้อน */
function ditherRegion(ctx, x, y, w, h) {
  const img = ctx.getImageData(x, y, w, h), d = img.data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx, old = g[i], nv = old < 128 ? 0 : 255, err = old - nv;
      g[i] = nv;
      if (xx + 1 < w) g[i + 1] += err * 7 / 16;
      if (yy + 1 < h) {
        if (xx > 0) g[i + w - 1] += err * 3 / 16;
        g[i + w] += err * 5 / 16;
        if (xx + 1 < w) g[i + w + 1] += err / 16;
      }
    }
  }
  for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g[i]; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, x, y);
}

const multiline = (s, extra) => String(s || '').split(/\r?\n/).filter((x) => x.trim())
  .map((x) => Object.assign({ t: 'text', s: x, align: 'center' }, extra));

function receiptOps(b, stIn) {
  const st = stIn || (S.data && S.data.settings) || {};
  const ops = [];
  if (st.logo) ops.push({ t: 'img', src: st.logo, w: 0.6, maxH: 5.5, dither: true });
  ops.push({ t: 'text', s: st.shopName || 'PBD GROUP', align: 'center', bold: true, scale: 1.3 });
  ops.push(...multiline(st.address, { scale: 0.85 }));
  if (st.phone) ops.push({ t: 'text', s: 'โทร ' + st.phone, align: 'center', scale: 0.85 });
  ops.push(
    { t: 'text', s: locName(b.loc), align: 'center' },
    { t: 'hr' },
    { t: 'row', l: 'เลขที่', r: b.id, scale: 0.85 },
    { t: 'row', l: 'วันที่', r: dt(b.createdAt), scale: 0.85 },
    { t: 'row', l: 'ผู้ขาย', r: b.sellerName || '', scale: 0.85 }
  );
  if (b.customer) ops.push({ t: 'row', l: 'ลูกค้า', r: b.customer, scale: 0.85 });
  ops.push({ t: 'hr' });
  b.lines.forEach((l) => {
    const col = isCollect(l);
    ops.push({ t: 'row', l: l.name, r: baht(lineQty(l) * l.price) });
    if (l.plan && l.plan.kind && !col) {
      const pl = l.plan;
      ops.push({ t: 'text', s: '   ' + (pl.name || (pl.kind === 'inst' ? `ผ่อน ${baht(pl.inst)} x ${pl.n} งวด (รวม ${baht(pl.total)})` : `ราคาสด ${baht(pl.total)}`)), scale: 0.78 });
    }
    if (col) {
      ops.push({ t: 'text', s: `   ${STAGE[l.stage]} · อ้างอิง ${l.refBill}`, scale: 0.8 });
      const left = r2((l.due || 0) - l.price);
      if (left > 0) ops.push({ t: 'text', s: `   คงค้าง ${baht(left)}`, scale: 0.8 });
    } else {
      ops.push({ t: 'text', s: `   ${STAGE[l.stage] ? STAGE[l.stage] + ' · ' : ''}${l.qty} x ${baht(l.price)}`, scale: 0.8 });
      const bal = lineBal(l);
      if (bal > 0) ops.push({ t: 'text', s: `   ค้าง${l.plan.kind === 'inst' ? 'ดาวน์' : 'ชำระ'} ${baht(bal)}`, scale: 0.8 });
    }
  });
  ops.push({ t: 'hr' });
  if (b.discount) {
    ops.push({ t: 'row', l: 'รวม', r: baht(b.subtotal) });
    ops.push({ t: 'row', l: 'ส่วนลด', r: '-' + baht(b.discount) });
  }
  ops.push({ t: 'row', l: b.type === 'COLLECT' ? 'รับชำระ' : 'รับเงินวันนี้', r: baht(b.total), bold: true, scale: 1.25 });
  if (b.balance) ops.push({ t: 'row', l: 'ค้างเก็บภายหลัง', r: baht(b.balance), bold: true });
  ops.push({ t: 'row', l: METHOD[b.method] || b.method, r: b.method === 'cash' ? baht(b.cash) : baht(b.total) });
  if (b.method === 'cash') ops.push({ t: 'row', l: 'เงินทอน', r: baht(b.change) });
  if (b.note) ops.push({ t: 'text', s: 'หมายเหตุ: ' + b.note, scale: 0.85 });
  if (b.void) ops.push({ t: 'text', s: '*** ยกเลิกแล้ว ***', align: 'center', bold: true, scale: 1.2 });
  ops.push({ t: 'hr' });
  ops.push(...multiline(st.footer));
  if (st.footerQr) {
    ops.push({ t: 'gap', h: 0.3 });
    ops.push({ t: 'img', src: st.footerQr, w: 0.5, crisp: true });
    ops.push(...multiline(st.footerQrLabel, { scale: 0.85 }));
  }
  ops.push({ t: 'gap', h: 1 });
  return ops;
}
const receiptCanvas = (b) => drawDoc(receiptOps(b));

function shiftOps(s, t) {
  return [
    { t: 'text', s: 'สรุปกะ · ' + locName(s.loc), align: 'center', bold: true, scale: 1.2 },
    { t: 'text', s: s.userName || '', align: 'center', scale: 0.9 },
    { t: 'hr' },
    { t: 'row', l: 'เปิดกะ', r: dt(s.openAt), scale: 0.85 },
    { t: 'row', l: 'ปิดกะ', r: s.closeAt ? dt(s.closeAt) : '-', scale: 0.85 },
    { t: 'hr' },
    { t: 'row', l: 'เงินตั้งต้น', r: baht(s.openingCash) },
    { t: 'row', l: 'ขายเงินสด', r: baht(t.by.cash) },
    { t: 'row', l: 'โอน/QR', r: baht(t.by.transfer) },
    { t: 'row', l: 'อื่นๆ', r: baht(t.by.other) },
    { t: 'row', l: 'จำนวนบิล', r: String(t.bills) },
    { t: 'hr' },
    { t: 'row', l: 'เงินสดที่ควรมี', r: baht(t.expected), bold: true },
    { t: 'row', l: 'นับได้จริง', r: s.counted == null ? '-' : baht(s.counted), bold: true },
    { t: 'row', l: 'ส่วนต่าง', r: s.diff == null ? '-' : sbaht(s.diff), bold: true },
    { t: 'gap', h: 1 }
  ];
}
function testOps() {
  return [
    { t: 'text', s: 'ทดสอบเครื่องพิมพ์', align: 'center', bold: true, scale: 1.3 },
    { t: 'text', s: 'ภาษาไทย สระ ุ ู ิ ี ึ ื ่ ้ ๊ ๋ ์ ครบ', align: 'center' },
    { t: 'row', l: 'กล้อง PBD9888LB Alexander Silver 2 เลนส์', r: baht(3900) },
    { t: 'hr' },
    { t: 'text', s: `กระดาษ ${S.prn.paper} mm · ${dt(Date.now())}`, align: 'center', scale: 0.85 },
    { t: 'gap', h: 1 }
  ];
}

/* ---------- ESC/POS raster ---------- */
function canvasToEscPos(cv) {
  const w = cv.width, h = cv.height;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const bw = Math.ceil(w / 8), band = 128;
  const out = [0x1B, 0x40];
  for (let y0 = 0; y0 < h; y0 += band) {
    const bh = Math.min(band, h - y0);
    out.push(0x1D, 0x76, 0x30, 0x00, bw & 255, bw >> 8, bh & 255, bh >> 8);
    for (let y = y0; y < y0 + bh; y++) {
      for (let xb = 0; xb < bw; xb++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x < w) {
            const i = (y * w + x) * 4;
            if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 150) byte |= 0x80 >> bit;
          }
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1B, 0x64, 4);
  if (+S.prn.paper === 80) out.push(0x1D, 0x56, 0x42, 0x00);
  return new Uint8Array(out);
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------- Bluetooth (BLE) ---------- */
const BLE = { dev: null, ch: null };
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb'
];
function bleStatus() {
  const el = $('#bleSt');
  if (!el) return;
  el.textContent = !navigator.bluetooth ? 'เบราว์เซอร์นี้ไม่รองรับ Bluetooth (ใช้ RawBT หรือแชร์รูป)'
    : BLE.ch ? 'เชื่อมต่อแล้ว: ' + (BLE.dev.name || 'เครื่องพิมพ์')
    : 'ยังไม่เชื่อมต่อ' + (store.get('bleName', '') ? ' (ล่าสุด: ' + store.get('bleName', '') + ')' : '');
}
async function bleAttach(dev) {
  const server = dev.gatt.connected ? dev.gatt : await dev.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const s of services) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) {
        BLE.dev = dev; BLE.ch = c;
        if (!dev._pbd) { dev._pbd = 1; dev.addEventListener('gattserverdisconnected', () => { BLE.ch = null; bleStatus(); }); }
        store.set('bleName', dev.name || '');
        return;
      }
    }
  }
  throw new Error('ไม่พบช่องส่งข้อมูลของเครื่องพิมพ์ — ลองใช้ RawBT');
}
async function bleConnect() {
  if (!navigator.bluetooth) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Bluetooth — ใช้ Chrome บน Android หรือเลือก RawBT');
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  await bleAttach(dev);
}
async function bleEnsure() {
  if (BLE.ch) return;
  if (BLE.dev) return bleAttach(BLE.dev);
  if (navigator.bluetooth && navigator.bluetooth.getDevices) {
    const name = store.get('bleName', '');
    const devs = await navigator.bluetooth.getDevices();
    const d = devs.find((x) => x.name === name) || devs[0];
    if (d) return bleAttach(d);
  }
  await bleConnect();
}
async function bleWrite(bytes) {
  await bleEnsure();
  const n = S.prn.chunk || 100;
  const noResp = BLE.ch.properties.writeWithoutResponse && BLE.ch.writeValueWithoutResponse;
  for (let i = 0; i < bytes.length; i += n) {
    const part = bytes.slice(i, i + n);
    if (noResp) { await BLE.ch.writeValueWithoutResponse(part); await sleep(6); }
    else await BLE.ch.writeValue(part);
  }
}

/* ---------- print / share ---------- */
async function shareCanvas(cv, name) {
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch (x) {}
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

let printing = false;
async function printOps(ops) {
  if (printing) return;
  printing = true;
  try {
    const cv = await drawDoc(ops);
    const mode = S.prn.mode;
    if (mode === 'none' || mode === 'share') return shareCanvas(cv, `pbd-${Date.now()}.png`);
    const bytes = canvasToEscPos(cv);
    if (mode === 'rawbt') {
      location.href = 'intent:base64,' + bytesToB64(bytes) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
      return;
    }
    toast('กำลังพิมพ์…');
    await bleWrite(bytes);
    toast('ส่งไปเครื่องพิมพ์แล้ว');
  } catch (e) {
    toast('พิมพ์ไม่ได้: ' + e.message, true);
  } finally { printing = false; }
}
const printBill = (b) => printOps(receiptOps(b));

/* ---------- boot ---------- */
function boot() {
  $('#loginBtn').onclick = startLogin;
  $('#teamBtn').onclick = openTeamPicker;
  $('#cartbar').onclick = openCart;
  $$('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.v); });
  window.addEventListener('online', () => { renderBadge(); render(); syncNow(); refreshData(); });
  window.addEventListener('offline', () => { renderBadge(); render(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.view === 'settings') render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => syncNow(), 30000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (S.session) {
    showApp();
    syncNow();
    refreshData();
  } else {
    showLogin();
    if (store.get('loginPending', 0) || /[?&](code|liff\.state)=/.test(location.search)) startLogin();
  }
}

// สำหรับทดสอบ
window.__pbdpos = { canvasToEscPos, wrapText, drawDoc, receiptOps };

boot();
})();
