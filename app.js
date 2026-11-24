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
const ROLE_TH = { Admin: 'ผู้ดูแลระบบ', BranchAdmin: 'แอดมินประจำสาขา', BranchManager: 'ผู้จัดการสาขา', TeamLead: 'หัวหน้าทีม' };
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
  customers: store.get('customers', []),
  cartCust: store.get('cartCust', ''),
  bills: store.get('bills', []),
  shifts: store.get('shifts', []),
  prn: Object.assign({ mode: /Android/i.test(navigator.userAgent) ? 'rawbt' : 'share', paper: 58, auto: false, chunk: 100 },
    store.get('prn', {})),
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
  if (j.customers) {
    const dirty = S.customers.filter((c) => c.dirty);
    const ids = new Set(dirty.map((c) => c.id));
    S.customers = dirty.concat(j.customers.filter((c) => !ids.has(c.id)));
    saveCustomers();
  }
  if (!S.data.locations.some((l) => l.id === S.loc)) {
    S.loc = (S.data.locations[0] || {}).id || '';
    store.set('loc', S.loc);
  }
}

/* ---------- รูปสินค้า (เก็บในเครื่อง ใช้ได้ตอนออฟไลน์) ---------- */
const IMG = {};
function imgOf(it) {
  if (!it || !it.img) return '';
  if (!(it.id in IMG)) IMG[it.id] = store.get('img_' + it.id, null);
  const c = IMG[it.id];
  return c && c.v === it.img ? c.d : '';
}
function putImg(id, rec) {
  IMG[id] = rec;
  if (!store.set('img_' + id, rec)) { /* เครื่องเต็ม: ใช้ในหน่วยความจำไปก่อน */ }
}
async function syncImages() {
  if (!navigator.onLine || !S.data) return;
  const need = items().filter((it) => it.img && !imgOf(it)).map((it) => it.id);
  items().filter((it) => !it.img).forEach((it) => { if (store.get('img_' + it.id, null)) { store.del('img_' + it.id); delete IMG[it.id]; } });
  for (let i = 0; i < need.length; i += 30) {
    try {
      const j = await api('itemImages', { ids: need.slice(i, i + 30) });
      Object.keys(j.images || {}).forEach((id) => putImg(id, j.images[id]));
    } catch (x) { return; }
    if (S.view === 'sell') renderGrid();
  }
}
/** ครอปกลางเป็นสี่เหลี่ยมจัตุรัส ย่อเหลือ 320px JPEG */
async function squareJpeg(file, size = 320) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    const side = Math.min(im.width, im.height);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/** Admin เปิดแอป → บันทึกลิงก์แอปนี้ไว้ ให้เมนู "ขายหน้างาน (POS)" ใน PBDSTOCK ลิงก์มาถูกที่ */
async function maybeSaveAppUrl() {
  const st = S.data && S.data.settings;
  if (!user().admin || !st || !navigator.onLine) return;
  const url = location.origin + location.pathname.replace(/index\.html$/, '');
  if (st.appUrl === url) return;
  try {
    const j = await api('saveSettings', { fields: { appUrl: url } });
    if (j.settings) { S.data.settings = j.settings; store.set('data', S.data); }
  } catch (x) { /* ลองใหม่ครั้งหน้า */ }
}

async function refreshData(manual) {
  if (!navigator.onLine || !S.session) return;
  try {
    const t0 = Date.now();
    applyData(await api('bootstrap', { sv: S.data && S.data.settings && S.data.settings.ver }), t0);
    S.authLost = false;
    maybeSaveAppUrl();
    syncImages();
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
    const dc = S.customers.filter((c) => c.dirty && mine(c.loc));
    if (dc.length) {
      const j = await api('syncCustomers', { customers: dc });
      j.results.forEach((r) => { const c = custById(r.id); if (c && r.ok) delete c.dirty; else if (c) c.err = r.error; });
      saveCustomers();
    }
    const pend = pendingBills();
    for (let i = 0; i < pend.length; i += 25) {
      const batch = pend.slice(i, i + 25).map((b) => ({
        id: b.id, loc: b.loc, createdAt: b.createdAt, sellerId: b.sellerId, sellerName: b.sellerName, device: b.device,
        shiftId: b.shiftId, lines: b.lines, discount: b.discount, method: b.method, cash: b.cash, change: b.change, note: b.note,
        customer: b.customer || '', customerId: b.customerId || '', type: b.type || 'SALE'
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
    let pic = '';
    try { pic = (liff.getDecodedIDToken() || {}).picture || ''; } catch (x) {}
    const j = await api('login', { idToken });
    finishLogin(j, t0, pic);
  } catch (e) {
    store.del('loginPending');
    msg.textContent = e.message;
  }
}

function finishLogin(j, t0, pic) {
  if (S.session && S.session.user && S.session.user.id !== j.user.id) {
    S.cart = S.cart.filter((l) => !isCollect(l)); saveCart(); S.report = null;
    S.customers = S.customers.filter((c) => c.dirty); setCartCust('');
  }
  S.session = { token: j.token, user: j.user, picture: j.picture || pic || '' };
  store.set('session', S.session);
  applyData(j, t0);
  S.authLost = false;
  history.replaceState(null, '', location.pathname);
  stopQr();
  showApp();
  syncNow();
  maybeSaveAppUrl();
  syncImages();
  checkPair();
}

/* ---------- เข้าสู่ระบบด้วย QR (เครื่องที่ไม่มี LINE เช่น SUNMI) ---------- */
let QR = null;
const deviceModel = () => { const m = /Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent); return m ? m[1].trim() : (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone/iPad' : 'คอมพิวเตอร์/อื่นๆ'); };
function stopQr() { if (QR) { clearTimeout(QR.timer); QR = null; } const b = $('#qrBox'); if (b) b.classList.add('hidden'); }
function drawQr(canvas, text) {
  const m = window.pbdQr(text), n = m.length, q = 4, s = Math.floor(240 / (n + q * 2));
  canvas.width = canvas.height = (n + q * 2) * s;
  const x = canvas.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, canvas.width, canvas.height); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) x.fillRect((c + q) * s, (r + q) * s, s, s);
}
async function startQrLogin() {
  const msg = $('#loginMsg'), box = $('#qrBox');
  if (!navigator.onLine) { msg.textContent = 'ต้องต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบ'; return; }
  stopQr(); msg.textContent = 'กำลังสร้าง QR…';
  try {
    const j = await api('qrStart', { device: S.device, model: deviceModel() });
    const url = `https://liff.line.me/${CFG.LIFF_ID}?pair=${j.code}`;
    QR = { code: j.code, end: Date.now() + j.ttl * 1000, timer: 0 };
    box.classList.remove('hidden'); msg.textContent = '';
    drawQr($('#qrCv'), url);
    $('#qrPin').textContent = j.code.slice(-4);
    const tick = async () => {
      if (!QR || QR.code !== j.code) return;
      const left = Math.max(0, Math.round((QR.end - Date.now()) / 1000));
      $('#qrLeft').textContent = `QR ใช้ได้อีก ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} นาที`;
      if (!left) { $('#qrLeft').textContent = 'QR หมดอายุแล้ว — กดสร้างใหม่'; $('#qrCv').style.opacity = 0.15; return; }
      try {
        const t0 = Date.now();
        const r = await api('qrPoll', { code: j.code });
        if (!QR || QR.code !== j.code) return;
        if (r.status === 'ok') return finishLogin(r, t0, r.picture);
        if (r.status === 'expired') { QR.end = 0; return tick(); }
      } catch (e) { /* เน็ตสะดุด ลองใหม่รอบหน้า */ }
      if (QR && QR.code === j.code) QR.timer = setTimeout(tick, 2500);
    };
    $('#qrCv').style.opacity = 1;
    tick();
  } catch (e) { msg.textContent = e.message; }
}

/** มือถือที่สแกน QR: เปิดผ่าน LINE แล้วถามยืนยันก่อนให้เครื่องขายเข้าสู่ระบบด้วยบัญชีนี้ */
function pairFromUrl() {
  const p = new URLSearchParams(location.search);
  let code = p.get('pair');
  if (!code && p.get('liff.state')) code = new URLSearchParams(p.get('liff.state').replace(/^[^?]*\?/, '')).get('pair');
  return code && /^[A-Z2-9]{10}$/.test(code) ? code : '';
}
function checkPair() {
  const code = store.get('pair', '');
  if (!code || !S.session) return;
  store.del('pair');
  const el = sheet(`${head('ให้เครื่องขายเข้าสู่ระบบ')}
    <div style="text-align:center;margin:6px 0 14px">
      <div class="mut">รหัสบนหน้าจอเครื่องขายต้องตรงกับ</div>
      <div class="num" style="font-size:40px;letter-spacing:6px;font-weight:700">${esc(code.slice(-4))}</div>
    </div>
    <div class="mut small" style="margin-bottom:14px">เครื่องขายจะเข้าสู่ระบบในชื่อ <b>${esc(user().name)}</b> และบิลที่ขายจากเครื่องนั้นจะเป็นชื่อคุณ อนุญาตเฉพาะเครื่องที่คุณใช้ขายเองเท่านั้น</div>
    <button class="btn pri block" id="pOk">อนุญาต</button>
    <button class="btn block" id="pNo" style="margin-top:8px">ไม่อนุญาต</button>`);
  $('#pNo', el).onclick = closeSheet;
  $('#pOk', el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('qrApprove', { code, picture: S.session.picture || '' });
      closeSheet();
      toast(`เครื่องขาย${r.model ? ' ' + r.model : ''} เข้าสู่ระบบแล้ว`);
    } catch (x) { e.target.disabled = false; toast(x.message, true); }
  };
}

function logout() {
  const n = pendingBills().length;
  if (n && !confirm(`มี ${n} บิลที่ยังไม่ได้ส่ง บิลจะยังอยู่ในเครื่องและส่งเมื่อมีคนเข้าสู่ระบบครั้งถัดไป\nออกจากระบบ?`)) return;
  S.session = null; store.del('session');
  // ล้างข้อมูลลูกค้าที่แคชไว้ ให้คนถัดไปที่ล็อกอินเห็นเฉพาะของสาขาตัวเอง
  if (S.data) { S.data.outstanding = []; S.data.outAt = 0; store.set('data', S.data); }
  S.cart = S.cart.filter((l) => !isCollect(l)); saveCart();
  S.customers = S.customers.filter((c) => c.dirty); saveCustomers(); setCartCust('');
  S.report = null;
  try { if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout(); } catch (x) {}
  showLogin();
}

function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
/** หัวแอป: รูปโปรไฟล์ LINE + ชื่อผู้ใช้ (ไม่มีรูป = ตัวอักษรแรกของชื่อ) */
function drawMe() {
  const u = user(), pic = (S.session && S.session.picture) || '', box = $('#me');
  if (!box) return;
  const key = (u.name || '') + '|' + pic;
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  const nm = u.name || '?', th = /[ก-ฮ]/.exec(nm);
  const init = esc(th ? th[0] : (Array.from(nm.replace(/^[^A-Za-z]+/, ''))[0] || '?'));
  box.innerHTML = `${pic ? `<img class="av" src="${esc(pic)}" alt="" referrerpolicy="no-referrer">` : `<span class="av">${init}</span>`}
    <span class="who"><span class="nm">${esc(u.name || '-')}</span><span class="sub">PBD <b>POS</b> · ${esc(ROLE_TH[u.role] || u.role || '')}</span></span>`;
  const img = $('img.av', box);
  if (img) img.onerror = () => { img.outerHTML = `<span class="av">${init}</span>`; };
}
// ผู้ใช้ที่ล็อกอินไว้ก่อนมีรูปโปรไฟล์: ถ้าเปิดใน LINE ดึงรูปให้เงียบ ๆ
async function fillPicture() {
  if (!S.session || S.session.picture || typeof liff === 'undefined' || !navigator.onLine) return;
  try {
    await liff.init({ liffId: CFG.LIFF_ID });
    if (!liff.isLoggedIn()) return;
    const pic = (liff.getDecodedIDToken() || {}).picture || '';
    if (pic && S.session) { S.session.picture = pic; store.set('session', S.session); drawMe(); }
  } catch (x) { /* ไม่เป็นไร ใช้ตัวอักษรแทน */ }
}

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

/* ----- ขั้นตอนเหมือน Loyverse: สินค้า › แบบการขาย › ตัวเลือก + จำนวน + ความคิดเห็น › กรอกราคาขายเอง ----- */
const STAGES_OF = (kind) => (kind === 'inst' ? ['down', 'splitDown', 'collectDown'] : ['full', 'collect']);
const planOf = (p) => ({ id: p.id || '', name: p.name || '', kind: p.kind, total: p.total || 0, down: p.down || 0,
  inst: p.inst || 0, n: p.n || 0, units: p.units || 1, open: !!p.open });

function addToCart(it) {
  const ps = plansOf(it);
  // ยังไม่มีราคาจากส่วนกลาง: พนักงานเลือกสด/ผ่อน แล้วใส่ราคาเอง
  if (!ps.length) return openPricePlan(it);
  if (ps.length === 1) return openVariant(it, ps[0]);
  pickPlan(it, ps, (p) => openVariant(it, p));
}

/** สินค้าที่ไม่มีราคาจากส่วนกลาง: เลือก สด / ผ่อน แล้วพนักงานใส่ราคาเอง → ไปหน้าตัวเลือกตามปกติ */
function openPricePlan(it) {
  const el = sheet(`${head(it.name)}
    <div class="mut small">สินค้านี้ยังไม่มีราคาจากส่วนกลาง — เลือกแบบการขายแล้วใส่ราคาเอง</div>
    <div class="list">
      <button class="li" data-ok="cash" style="width:100%;text-align:left"><span class="tag ok">สด</span>
        <span class="sp">ใส่ราคาขาย<br><span class="mut small">ชำระวันสั่งซื้อ · เก็บเพิ่ม</span></span><span class="mut">›</span></button>
      <button class="li" data-ok="inst" style="width:100%;text-align:left"><span class="tag wait">ผ่อน</span>
        <span class="sp">ใส่ราคารวม เงินดาวน์ ค่างวด<br><span class="mut small">ดาวน์เต็ม · แบ่งดาวน์ · เก็บเงินดาวน์เพิ่ม</span></span><span class="mut">›</span></button>
    </div>`);
  $('[data-ok="cash"]', el).onclick = () => keypad(`${it.name} · ขายสด`, 'ราคาขายต่อชิ้น (พนักงานระบุ)', [], (amt) => {
    if (!(amt > 0)) return toast('กรอกราคาขาย', true);
    openVariant(it, { id: '', kind: 'cash', total: amt, units: 1, open: true, name: `สด ${baht(amt)} · ราคาพนักงานระบุ` });
  });
  $('[data-ok="inst"]', el).onclick = () => {
    const f = sheet(`${head(it.name + ' · ขายผ่อน')}
      <div class="mut small">ราคาพนักงานระบุ (ต่อชิ้น)</div>
      <label class="f">ราคารวมทั้งสัญญา *</label><input class="inp num" id="oT" inputmode="decimal">
      <label class="f">เงินดาวน์ *</label><input class="inp num" id="oD" inputmode="decimal">
      <div class="row" style="gap:8px">
        <div style="flex:1"><label class="f">ค่างวด</label><input class="inp num" id="oI" inputmode="decimal"></div>
        <div style="flex:1"><label class="f">จำนวนงวด</label><input class="inp num" id="oN" inputmode="numeric"></div></div>
      <div class="mut small" id="oHint" style="margin-top:6px"></div>
      <button class="btn pri block" id="oOk" style="margin-top:14px">ถัดไป</button>`);
    const n = (id) => Number(String($(id, f).value).replace(/,/g, '')) || 0;
    const hint = () => {
      const t = n('#oT'), d = n('#oD'), i = n('#oI'), k = n('#oN');
      $('#oHint', f).textContent = t && d ? `ยอดผ่อนหลังดาวน์ ${baht(t - d)}` + (i && k ? ` · ค่างวดรวม ${baht(i * k)}${Math.abs(i * k - (t - d)) > 0.5 ? ' (ไม่เท่ากับยอดหลังดาวน์)' : ''}` : '') : '';
    };
    ['#oT', '#oD', '#oI', '#oN'].forEach((id) => { $(id, f).oninput = hint; });
    $('#oOk', f).onclick = () => {
      const t = n('#oT'), d = n('#oD'), i = n('#oI'), k = Math.round(n('#oN'));
      if (!(t > 0)) return toast('ใส่ราคารวมทั้งสัญญา', true);
      if (!(d > 0) || d >= t) return toast('เงินดาวน์ต้องมากกว่า 0 และน้อยกว่าราคารวม', true);
      if ((i > 0) !== (k > 0)) return toast('ใส่ค่างวดและจำนวนงวดให้ครบทั้งคู่ (หรือเว้นว่างทั้งคู่)', true);
      const name = (i && k ? `ผ่อน ${baht(i)} × ${k} งวด · ` : 'ผ่อน · ') + `ดาวน์ ${baht(d)} (รวม ${baht(t)}) · ราคาพนักงานระบุ`;
      openVariant(it, { id: '', kind: 'inst', total: t, down: d, inst: i, n: k, units: 1, open: true, name });
    };
    setTimeout(() => $('#oT', f).focus(), 50);
  };
}

function pickPlan(it, ps, cb) {
  const el = sheet(`${head(it.name)}<div class="mut small">เลือกแบบการขาย</div><div class="list">${ps.map((p, i) => `
    <button class="li" data-pi="${i}" style="width:100%;text-align:left">
      <span class="tag ${p.kind === 'inst' ? 'wait' : 'ok'}">${p.kind === 'inst' ? 'ผ่อน' : 'สด'}</span>
      <span class="sp">${esc(planLabel(p))}</span><span class="mut">›</span>
    </button>`).join('')}</div>`);
  $$('[data-pi]', el).forEach((b) => { b.onclick = () => cb(ps[+b.dataset.pi]); });
}

function onCode(code) {
  const it = findByCode(code);
  if (it) addToCart(it);
  else { toast('ไม่พบสินค้า: ' + code, true); S.q = code; if (S.view === 'sell') render(); }
}

/** หน้าตัวเลือก (ตัวแปร) — edit = index ของรายการในตะกร้าที่กำลังแก้ */
function openVariant(it, plan, edit) {
  const cur = edit != null ? S.cart[edit] : null;
  const st = { qty: cur ? cur.qty : 1, comment: cur ? cur.comment || '' : '' };
  const p = planOf(plan);
  const vimg = imgOf(it);
  const el = sheet(`${head(it.name)}
    ${vimg ? `<img src="${vimg}" alt="" style="width:96px;height:96px;border-radius:12px;object-fit:cover;float:right;margin:0 0 8px 10px">` : ''}
    <div class="mut small">${esc(planLabel(p) || 'ไม่มีราคาตั้งไว้ — กรอกราคาขายเอง')}</div>
    <label class="f" style="color:var(--ok)">ตัวเลือก</label>
    <div class="list">${STAGES_OF(p.kind).map((s) => `
      <button class="li" data-vs="${s}" style="width:100%;text-align:left;border:1px solid ${cur && cur.stage === s ? 'var(--red)' : 'var(--line)'};border-radius:12px;padding:14px;margin-bottom:8px">
        <span class="sp" style="font-size:16px">${STAGE[s]}</span>
        <span class="mut small">${s === 'down' ? 'ดาวน์ ' + baht(p.down) : s === 'full' && p.total ? baht(p.total) : s === 'collect' || s === 'collectDown' ? 'เลือกบิลที่ค้าง' : ''}</span>
      </button>`).join('')}</div>
    <div id="qtyBox"><label class="f" style="color:var(--ok)">จำนวน</label>
      <div class="row"><button class="btn" id="vm" style="width:56px">−</button><div class="sp num" id="vq" style="text-align:center;font-size:20px"></div><button class="btn" id="vp" style="width:56px">+</button></div></div>
    <label class="f" style="color:var(--ok)">ความคิดเห็น</label><input class="inp" id="vc" maxlength="120" placeholder="ใส่ข้อคิดเห็น" value="${esc(st.comment)}">
    ${cur && !isCollect(cur) ? `<button class="btn block" id="vkeep" style="margin-top:12px">บันทึก (ราคาเดิม ${baht(cur.price)})</button>` : ''}`);
  const drawQty = () => { $('#vq', el).textContent = st.qty; };
  $('#vm', el).onclick = () => { if (st.qty > 1) { st.qty--; drawQty(); } };
  $('#vp', el).onclick = () => { st.qty++; drawQty(); };
  drawQty();
  const comment = () => $('#vc', el).value.trim();
  const keep = $('#vkeep', el);
  if (keep) keep.onclick = () => { Object.assign(cur, { qty: st.qty, comment: comment() }); cartChanged(); closeSheet(); openCart(); };
  $$('[data-vs]', el).forEach((b) => {
    b.onclick = () => {
      const stage = b.dataset.vs;
      const base = { it, plan: p, qty: st.qty, comment: comment(), edit };
      if (stage === 'collect' || stage === 'collectDown') return pickOutstanding(Object.assign(base, { stage }));
      askAmount(Object.assign(base, { stage }));
    };
  });
}

/** เก็บเพิ่ม / เก็บเงินดาวน์เพิ่ม จากหน้าสินค้า: เลือกบิลที่ค้างของสินค้านี้ หรือบิลที่ขายใน Loyverse */
function pickOutstanding(o) {
  const kind = o.stage === 'collectDown' ? 'inst' : 'cash';
  const list = outstandingList().filter((x) => x.itemId === o.it.id && x.kind === kind);
  const el = sheet(`${head(STAGE[o.stage] + ' · ' + o.it.name)}
    <div class="list">${list.map((x, i) => `<button class="li" data-ob="${i}" style="width:100%;text-align:left"><div class="sp">
      <div>${esc(x.customer || '(ไม่ระบุลูกค้า)')}</div><div class="mut small">${esc(x.bill)} · ${esc(x.date)} · ${esc(locName(x.loc))}</div></div>
      <div class="num">ค้าง ${baht(x.balance)}</div></button>`).join('') || '<div class="mut" style="padding:10px 0">ไม่มีบิลค้างของสินค้านี้ในระบบ</div>'}</div>
    <button class="btn block" id="olv" style="margin-top:10px">บิลที่ขายใน Loyverse / ไม่มีในระบบ</button>`);
  $$('[data-ob]', el).forEach((b) => {
    b.onclick = () => {
      const x = list[+b.dataset.ob];
      askAmount(Object.assign({}, o, { qty: 1, ref: x, max: x.balance }));
    };
  });
  $('#olv', el).onclick = () => {
    const r = prompt('เลขใบเสร็จ Loyverse (ถ้ามี)', '');
    if (r == null) return;
    askAmount(Object.assign({}, o, { qty: 1, ref: { bill: 'LV-' + (r.trim().replace(/[^A-Za-z0-9.\-]/g, '') || 'ไม่ระบุ'), line: 0 } }));
  };
}

/** แป้นตัวเลข "ราคาขาย" — กรอกเอง เริ่มจาก 0 */
function keypad(title, label, hints, onOk) {
  let v = '';
  const el = sheet(`${head(title)}
    <div class="mut">${esc(label)}</div>
    <div class="row" style="margin:6px 0 10px"><div class="sp num" id="kd" style="font-size:40px"></div><button class="btn" id="kb" aria-label="ลบ">⌫</button></div>
    ${hints.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${hints.map((h, i) => `<button class="chip" data-h="${i}">${esc(h.label)}</button>`).join('')}</div>` : ''}
    <div class="kp">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}
      <button id="kok" class="ok">ตกลง</button></div>`);
  const draw = () => {
    const n = parseFloat(v || '0');
    $('#kd', el).textContent = '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  $$('[data-k]', el).forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      if (k === '.' && v.includes('.')) return;
      if (v.includes('.') && v.split('.')[1].length >= 2) return;
      if (v.replace('.', '').length >= 9) return;
      v = v === '0' && k !== '.' ? k : v + k;
      draw();
    };
  });
  $('#kb', el).onclick = () => { v = v.slice(0, -1); draw(); };
  $$('[data-h]', el).forEach((b) => { b.onclick = () => { v = String(hints[+b.dataset.h].value); draw(); }; });
  $('#kok', el).onclick = () => onOk(r2(parseFloat(v || '0')));
  draw();
}

/** ราคามาตรฐานมาจาก Admin ส่วนกลาง: ลดราคาได้แต่ต้องใส่เหตุผล · เงินดาวน์ต้องตามแผน */
function askReason(title, cb) {
  const el = sheet(`${head(title)}
    <div class="mut small">ส่วนลดจะขึ้นในรายงานหลังบ้าน (เทียบกับราคามาตรฐานจากส่วนกลาง)</div>
    <label class="f">เหตุผลที่ลดราคา *</label><input class="inp" id="rr" maxlength="160" placeholder="เช่น ลูกค้าซื้อคู่ / โปรสาขา / ลูกค้าเก่า">
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${['ลูกค้าซื้อหลายชิ้น', 'ลูกค้าเก่า', 'โปรโมชันสาขา', 'แลกกับไม่ติดตั้ง'].map((t) => `<button class="chip" data-r="${t}">${t}</button>`).join('')}</div>
    <button class="btn pri block" id="rok" style="margin-top:14px">ยืนยันส่วนลด</button>`);
  $$('[data-r]', el).forEach((b) => { b.onclick = () => { $('#rr', el).value = b.dataset.r; }; });
  $('#rok', el).onclick = () => {
    const r = $('#rr', el).value.trim();
    if (r.length < 3) return toast('ใส่เหตุผลที่ลดราคา', true);
    cb(r);
  };
  setTimeout(() => { const i = $('#rr', el); if (i) i.focus(); }, 50);
}

function askAmount(o) {
  const p = o.plan, col = o.stage === 'collect' || o.stage === 'collectDown';
  const hints = [];
  if (o.stage === 'full' && p.total) hints.push({ label: (p.open ? 'ราคาขาย ' : 'ราคามาตรฐาน ') + baht(p.total), value: p.total });
  if (o.stage === 'down' && p.down) hints.push({ label: 'ดาวน์ตามแผน ' + baht(p.down), value: p.down });
  if (o.stage === 'splitDown') hints.push({ label: baht(500), value: 500 });
  if (col && o.max) hints.push({ label: 'ค้างทั้งหมด ' + baht(o.max), value: o.max });
  if (!col && !(p.total > 0)) {
    return keypad(`${o.it.name} · ใส่ราคาขาย`, `ราคาขาย${o.qty > 1 ? ' ต่อชิ้น' : ''} (สินค้านี้ยังไม่มีราคาจากส่วนกลาง)`, [], (amt) => {
      if (!(amt > 0)) return toast('กรอกราคาขาย', true);
      putLine(o, 'full', amt, amt);
    });
  }
  const label = col ? 'ยอดที่เก็บ' + (o.max ? ` (ค้าง ${baht(o.max)})` : '')
    : o.stage === 'full' ? `รับเงินวันนี้${o.qty > 1 ? ' ต่อชิ้น' : ''} · ${p.open ? 'ราคาขาย' : 'ราคามาตรฐาน'} ${baht(p.total)}`
    : `รับดาวน์วันนี้${o.qty > 1 ? ' ต่อชิ้น' : ''} · ดาวน์ตามแผน ${baht(p.down)}`;
  keypad(`${o.it.name} · ${STAGE[o.stage]}`, label, hints, (amt) => {
    if (!(amt > 0)) return toast('กรอกจำนวนเงิน', true);
    if (col) {
      if (o.max && amt > o.max + 0.001) return toast('เกินยอดค้าง ' + baht(o.max), true);
      return putLine(o, o.stage, o.max || amt, amt);
    }
    if (o.stage === 'down' || o.stage === 'splitDown') {
      // เงินดาวน์ต้องตามแผนเท่านั้น: จ่ายครบ = ดาวน์เต็ม · จ่ายน้อยกว่า = แบ่งดาวน์ (ค้างเก็บเงินดาวน์เพิ่ม)
      if (amt > p.down + 0.001) return toast('เกินยอดดาวน์ตามแผน ' + baht(p.down), true);
      if (amt >= p.down) { if (o.stage === 'splitDown') toast('รับครบยอดดาวน์ → ดาวน์เต็ม'); return putLine(o, 'down', p.down, p.down); }
      if (o.stage === 'down') toast('รับน้อยกว่ายอดดาวน์ → แบ่งดาวน์ ค้าง ' + baht((p.down - amt) * o.qty));
      return putLine(o, 'splitDown', p.down, amt);
    }
    // ชำระวันสั่งซื้อ (ขายสด)
    if (amt > p.total + 0.001) return toast('เกินราคามาตรฐาน ' + baht(p.total), true);
    if (amt >= p.total) return putLine(o, 'full', p.total, p.total);
    if (p.open) { // ราคาที่พนักงานใส่เอง ไม่มีส่วนลด — รับน้อยกว่าราคา = ค้างเก็บเพิ่ม
      toast('ค้างเก็บเพิ่ม ' + baht((p.total - amt) * o.qty));
      return putLine(o, 'full', p.total, amt);
    }
    const el = sheet(`${head('รับ ' + baht(amt) + ' จากราคามาตรฐาน ' + baht(p.total))}
      <button class="btn pri block" id="bal" style="margin-bottom:8px">ค้างเก็บเพิ่ม ${baht((p.total - amt) * o.qty)} (มัดจำ / จ่ายบางส่วน)</button>
      <button class="btn block" id="dsc" style="margin-bottom:8px">ลดราคาเหลือ ${baht(amt)} — จ่ายครบ (ต้องใส่เหตุผล)</button>
      <button class="btn block" id="both">ลดราคา และค้างเก็บส่วนที่เหลือ…</button>`);
    $('#bal', el).onclick = () => putLine(o, 'full', p.total, amt);
    $('#dsc', el).onclick = () => askReason('ลดราคา ' + baht(p.total - amt), (r) => putLine(o, 'full', amt, amt, r));
    $('#both', el).onclick = () => keypad('ราคาที่ตกลงขาย (หลังลด)', `ต้องไม่น้อยกว่าที่รับวันนี้ ${baht(amt)} และไม่เกิน ${baht(p.total)}`, [], (deal) => {
      if (deal < amt || deal > p.total) return toast('ราคาที่ตกลงไม่ถูกต้อง', true);
      if (deal === p.total) return putLine(o, 'full', p.total, amt);
      askReason('ลดราคา ' + baht(p.total - deal), (r) => putLine(o, 'full', deal, amt, r));
    });
  });
}

function putLine(o, stage, due, price, discReason) {
  const col = stage === 'collect' || stage === 'collectDown';
  const line = {
    key: randomId(6), id: o.it.id, name: o.it.name, plan: planOf(o.plan), stage,
    due: r2(due), price: r2(price), qty: col ? 1 : o.qty, comment: o.comment || '', discReason: discReason || ''
  };
  if (col) {
    line.refBill = o.ref ? o.ref.bill : ''; line.refLine = o.ref ? o.ref.line : 0;
    line.customer = o.ref ? o.ref.customer || '' : '';
    if (o.ref && o.ref.customerId && custById(o.ref.customerId)) setCartCust(o.ref.customerId);
  }
  if (o.edit != null && S.cart[o.edit]) S.cart[o.edit] = Object.assign(line, { key: S.cart[o.edit].key });
  else S.cart.push(line);
  if (navigator.vibrate) navigator.vibrate(25);
  cartChanged();
  closeSheet();
  if (o.edit != null) openCart();
  else toast(`+ ${o.it.name} · ${STAGE[stage]} ${baht(price)}`);
}

/** แตะรายการในตะกร้า → กลับไปหน้าตัวเลือกของสินค้านั้น */
function editLine(idx) {
  const l = S.cart[idx];
  if (!l) return;
  const it = items().find((x) => x.id === l.id) || { id: l.id, name: l.name };
  if (isCollect(l)) {
    const max = l.refBill && !/^LV-/.test(l.refBill) ? l.due : 0;
    return askAmount({ it, plan: l.plan, stage: l.stage, qty: 1, comment: l.comment, edit: idx,
      ref: { bill: l.refBill, line: l.refLine, customer: l.customer }, max });
  }
  openVariant(it, l.plan, idx);
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
        kind: l.plan.kind, plan: l.plan, balance: bal, customer: b.customer || '', customerId: b.customerId || '' });
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
  if (o.customerId && custById(o.customerId)) setCartCust(o.customerId);
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
  drawMe();
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
  $('#scanBtn', v).onclick = () => openScanner();
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
  const anyImg = items().some((x) => x.img);
  g.innerHTML = list.length ? list.map((i) => {
    const ps = plansOf(i);
    const cash = ps.find((p) => p.kind === 'cash');
    const insts = ps.filter((p) => p.kind === 'inst');
    const price = cash ? `<span class="pr num">${baht(cash.total)}</span>`
      : insts.length ? `<span class="pr num">ดาวน์ ${baht(Math.min(...insts.map((p) => p.down)))}</span>`
      : `<span class="pr zero">ใส่ราคาเอง · สด/ผ่อน</span>`;
    const src = imgOf(i);
    return `<button class="item${anyImg ? ' hasimg' : ''}" data-id="${esc(i.id)}">
      ${inCart[i.id] ? `<span class="q">${inCart[i.id]}</span>` : ''}
      ${anyImg ? (src ? `<img class="pimg" src="${src}" alt="" loading="lazy">` : `<span class="pimg ph">${esc(i.id)}</span>`) : ''}
      <span class="nm">${esc(i.name)}</span>
      <span>${price}${insts.length ? `<span class="mut small" style="display:block">ผ่อนได้ ${insts.length} แบบ</span>` : ''}</span>
    </button>`;
  }).join('') : `<div class="mut" style="grid-column:1/-1;padding:20px;text-align:center">ไม่พบสินค้า</div>`;
  $$('.item', g).forEach((b) => { b.onclick = () => { const it = items().find((x) => x.id === b.dataset.id); if (it) addToCart(it); }; });
}

function openCart() {
  if (!S.cart.length) return;
  const cc = custById(S.cartCust);
  const el = sheet(`${head('ตะกร้า · ' + locName(S.loc))}
    <button class="li" id="ccust" style="width:100%;text-align:left;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px">
      <span class="sp">${cc ? `<b>${esc(cc.name)}</b><br><span class="mut small">${esc([cc.phone, cc.province].filter(Boolean).join(' · '))}</span>` : '<span class="mut">+ เลือก / สร้างลูกค้า</span>'}</span>
      ${cc ? '<span class="mut small">เปลี่ยน</span>' : ''}</button>
    <div class="mut small">แตะรายการเพื่อเปลี่ยนตัวเลือกการชำระ / ราคา / จำนวน</div>
    <div class="list" id="cl"></div>
    <div class="total"><span>รับเงินวันนี้</span><span class="num" id="ct"></span></div>
    <div class="row mut" id="cbr"><span class="sp">ค้างเก็บภายหลัง</span><span class="num" id="cb"></span></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="clr">ล้าง</button><button class="btn pri sp" id="pay">ชำระเงิน</button></div>`);
  const draw = () => {
    if (!S.cart.length) { closeSheet(); render(); return; }
    $('#cl', el).innerHTML = S.cart.map((l, i) => {
      const bal = lineBal(l);
      return `<div class="li"><button class="sp" data-e="${i}" style="text-align:left">
        <div>${esc(l.name)}${lineQty(l) > 1 ? ` <b>× ${l.qty}</b>` : ''}</div>
        <div class="mut small">${esc(planLabel(l.plan))}</div>
        <div class="small"><span class="tag ${isCollect(l) ? 'ok' : l.plan.kind === 'inst' ? 'wait' : 'ok'}">${STAGE[l.stage]}</span>
          ${isCollect(l) ? `<span class="mut">อ้างอิง ${esc(l.refBill)}</span>` : ''}
          ${bal > 0 ? `<span style="color:var(--warn)">ค้าง ${baht(bal)}</span>` : ''}</div>
          ${l.discReason ? `<div class="small" style="color:var(--warn)">ลด ${baht((l.plan.total - l.due) * l.qty)} · ${esc(l.discReason)}</div>` : ''}
          ${l.comment ? `<div class="mut small">💬 ${esc(l.comment)}</div>` : ''}</button>
        <div class="num" style="min-width:76px;text-align:right">${baht(lineQty(l) * l.price)}</div>
        <button class="x" data-x="${i}" aria-label="ลบรายการ" style="flex:none">×</button></div>`;
    }).join('');
    $('#ct', el).textContent = baht(cartTotal());
    $('#cb', el).textContent = baht(cartBalance());
    $('#cbr', el).classList.toggle('hidden', !cartBalance());
    $$('[data-e]', el).forEach((b) => { b.onclick = () => editLine(+b.dataset.e); });
    $$('[data-x]', el).forEach((b) => { b.onclick = () => { S.cart.splice(+b.dataset.x, 1); cartChanged(); draw(); }; });
  };
  draw();
  $('#ccust', el).onclick = () => openCustomers((c) => { setCartCust(c.id); openCart(); });
  $('#clr', el).onclick = () => { if (confirm('ล้างตะกร้าทั้งหมด?')) { S.cart = []; setCartCust(''); cartChanged(); closeSheet(); render(); } };
  $('#pay', el).onclick = openPay;
}

/* ----- ลูกค้า (ช่องเดียวกับ Loyverse) ----- */
const PROVINCES = ['กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี',
  'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา',
  'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี',
  'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต',
  'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน',
  'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี',
  'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์',
  'อุทัยธานี', 'อุบลราชธานี'];
const CUST_FIELDS = [
  ['name', 'ชื่อลูกค้า *', 'text', 120], ['email', 'อีเมล', 'email', 120], ['phone', 'โทรศัพท์', 'tel', 20],
  ['address', 'ที่อยู่', 'text', 300], ['district', 'เขต/อำเภอ', 'text', 80], ['province', 'จังหวัด', 'text', 80],
  ['zip', 'รหัสไปรษณีย์', 'text', 5], ['country', 'ประเทศ', 'text', 60], ['code', 'รหัสลูกค้า', 'text', 60],
  ['note', 'หมายเหตุ', 'text', 300]
];
const myCustomers = () => S.customers.filter((c) => mine(c.loc));
const custById = (id) => S.customers.find((c) => c.id === id) || null;
const custLabel = (c) => (c ? c.name + (c.phone ? ' · ' + c.phone : '') : '');
const custAddr = (c) => (c ? [c.address, c.district, c.province, c.zip].filter(Boolean).join(' ') : '');
function saveCustomers() { if (!store.set('customers', S.customers)) toast('เครื่องเต็ม! บันทึกลูกค้าไม่ได้', true); }
function setCartCust(id) { S.cartCust = id || ''; store.set('cartCust', S.cartCust); }

function openCustomers(onPick) {
  let q = '';
  const el = sheet(`${head(onPick ? 'เลือกลูกค้า' : 'ลูกค้า')}
    <div class="searchrow" style="position:static;padding:0 0 8px">
      <input class="search" id="kq" placeholder="ชื่อ / เบอร์ / รหัสลูกค้า" autocomplete="off">
      <button class="iconbtn" id="ks" aria-label="สแกนรหัสลูกค้า"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/></svg></button>
    </div>
    <button class="btn pri block" id="knew">+ สร้างลูกค้า</button>
    <div class="list" id="kl" style="margin-top:6px"></div>
    <div class="mut small" style="margin-top:6px">${myCustomers().length} ราย · เห็นเฉพาะลูกค้าของทีมตามสิทธิ์</div>`);
  const draw = () => {
    const qq = q.toLowerCase();
    const list = myCustomers()
      .filter((c) => !qq || [c.name, c.phone, c.code, c.email].join(' ').toLowerCase().includes(qq))
      .sort((a, b) => (a.loc === S.loc ? 0 : 1) - (b.loc === S.loc ? 0 : 1) || (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 80);
    $('#kl', el).innerHTML = list.length ? list.map((c) => `
      <div class="li"><button class="sp" data-pick="${esc(c.id)}" style="text-align:left">
        <div>${esc(c.name)}${c.dirty ? ' <span class="tag wait">รอส่ง</span>' : ''}</div>
        <div class="mut small">${esc([c.phone, c.code && 'รหัส ' + c.code, c.province, locName(c.loc)].filter(Boolean).join(' · '))}</div></button>
        <button class="btn" data-ed="${esc(c.id)}">แก้ไข</button></div>`).join('')
      : `<div class="mut" style="padding:12px 0">${q ? 'ไม่พบลูกค้า' : 'ยังไม่มีลูกค้า'}</div>`;
    $$('[data-pick]', el).forEach((b) => {
      b.onclick = () => { const c = custById(b.dataset.pick); if (onPick) { closeSheet(); onPick(c); } else openCustomerForm(c, () => openCustomers()); };
    });
    $$('[data-ed]', el).forEach((b) => { b.onclick = () => openCustomerForm(custById(b.dataset.ed), (c) => (onPick ? onPick(c) : openCustomers())); });
  };
  $('#kq', el).oninput = (e) => { q = e.target.value.trim(); draw(); };
  $('#knew', el).onclick = () => openCustomerForm(null, (c) => (onPick ? onPick(c) : openCustomers()), q);
  $('#ks', el).onclick = () => openScanner((code) => {
    const c = myCustomers().find((x) => x.code && x.code.toLowerCase() === String(code).toLowerCase());
    if (c && onPick) return onPick(c);
    openCustomers(onPick);
    const i = $('#kq'); if (i) { i.value = code; i.dispatchEvent(new Event('input')); }
    if (!c) toast('ไม่พบรหัสลูกค้า ' + code, true);
  });
  draw();
}

function openCustomerForm(c, onSaved, prefill) {
  const isNew = !c;
  const d = Object.assign({ country: 'ไทย', loc: S.loc }, c || {});
  if (isNew && prefill) { if (/^[0-9\- ]{6,}$/.test(prefill)) d.phone = prefill; else d.name = prefill; }
  const el = sheet(`${head(isNew ? 'สร้างลูกค้า' : 'แก้ไขลูกค้า')}
    <button class="btn block" id="cidcard" style="margin-bottom:4px">🪪 สแกนบัตรประชาชน · กรอกชื่อและที่อยู่ให้</button>
    ${CUST_FIELDS.map(([k, label, type, max]) => `<label class="f">${label}</label>` + (k === 'code'
      ? `<div class="row"><input class="inp" id="c_${k}" maxlength="${max}" value="${esc(d[k] || '')}"><button class="btn" id="cscan">สแกน</button></div>`
      : `<input class="inp" id="c_${k}" type="${type}" maxlength="${max}" value="${esc(d[k] || '')}"${k === 'province' ? ' list="provList"' : ''}${k === 'zip' ? ' inputmode="numeric"' : ''}${k === 'phone' ? ' inputmode="tel"' : ''}>`)).join('')}
    <datalist id="provList">${PROVINCES.map((p) => `<option value="${p}">`).join('')}</datalist>
    ${isNew && locs().length > 1 ? `<label class="f">ทีมที่ดูแลลูกค้า</label><select class="inp" id="c_loc">${locs().map((l) => `<option value="${esc(l.id)}" ${l.id === d.loc ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}
    <button class="btn pri block" id="csave" style="margin-top:14px">บันทึก</button>`);
  $('#cscan', el).onclick = () => {
    const keep = readForm();
    openScanner((code) => { openCustomerForm(c, onSaved); Object.keys(keep).forEach((k) => { const i = $('#c_' + k); if (i) i.value = keep[k]; }); $('#c_code').value = code; });
  };
  function readForm() { const o = {}; CUST_FIELDS.forEach(([k]) => { o[k] = $('#c_' + k, el).value.trim(); }); return o; }
  $('#cidcard', el).onclick = () => {
    const keep = readForm(), locSel = $('#c_loc', el), lv = locSel ? locSel.value : '';
    openIdCardScan((r) => {
      openCustomerForm(c, onSaved);
      const f = Object.assign(keep, Object.fromEntries(Object.entries(r).filter(([, v]) => v)));
      f.country = f.country || 'ไทย';
      Object.keys(f).forEach((k) => { const i = $('#c_' + k); if (i) i.value = f[k]; });
      if (lv && $('#c_loc')) $('#c_loc').value = lv;
      ['name', 'address', 'district', 'province'].forEach((k) => { if (r[k]) $('#c_' + k).classList.add('filled'); });
      toast('กรอกจากบัตรแล้ว — ตรวจความถูกต้อง แล้วใส่เบอร์โทร/รหัสไปรษณีย์');
    });
  };
  $('#csave', el).onclick = () => {
    const f = readForm();
    if (!f.name) return toast('ใส่ชื่อลูกค้า', true);
    const digits = f.phone.replace(/\D/g, '');
    if (f.phone && (digits.length < 9 || digits.length > 10)) return toast('เบอร์โทรไม่ถูกต้อง (9–10 หลัก)', true);
    if (f.zip && !/^\d{5}$/.test(f.zip)) return toast('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก', true);
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return toast('อีเมลไม่ถูกต้อง', true);
    const dup = myCustomers().find((x) => x.id !== d.id && ((digits && x.phone.replace(/\D/g, '') === digits) || (f.code && x.code === f.code)));
    if (dup && !confirm(`มีลูกค้า "${dup.name}" ที่ใช้${f.code && dup.code === f.code ? 'รหัสลูกค้า' : 'เบอร์'}นี้แล้ว บันทึกเป็นอีกคนหรือไม่?`)) return;
    const locSel = $('#c_loc', el);
    const rec = Object.assign({}, d, f, {
      id: d.id || `C-${randomId(8)}`, loc: isNew ? (locSel ? locSel.value : S.loc) : d.loc,
      updatedAt: Date.now(), dirty: true
    });
    const i = S.customers.findIndex((x) => x.id === rec.id);
    if (i >= 0) S.customers[i] = rec; else S.customers.unshift(rec);
    saveCustomers();
    toast(isNew ? 'สร้างลูกค้าแล้ว' : 'บันทึกแล้ว');
    syncNow();
    closeSheet();
    if (onSaved) onSaved(rec);
  };
}

/* ----- pay ----- */
function openPay() {
  if (!S.loc) return toast('เลือกทีมก่อนขาย', true);
  const t = cartTotal(), bal = cartBalance();
  const st0 = (S.data && S.data.settings) || {};
  const needCustomer = bal > 0 || S.cart.some(isCollect);
  const cc = custById(S.cartCust);
  const textCust = (S.cart.find((l) => l.customer) || {}).customer || ''; // ลูกค้าจากบิล Loyverse/บิลเก่า
  const st = { method: 'cash' };
  const el = sheet(`${head(S.cart.every(isCollect) ? 'รับชำระ' : 'ชำระเงิน')}
    <div class="total" style="border-top:0;margin-top:0"><span>รับเงินวันนี้</span><span class="num">${baht(t)}</span></div>
    ${bal > 0 ? `<div class="banner">ค้างเก็บภายหลัง ${baht(bal)} — ต้องเลือกลูกค้าเพื่อตามเก็บ</div>` : ''}
    <button class="li" id="pcust" style="width:100%;text-align:left;border:1px solid ${needCustomer && !cc && !textCust ? 'var(--warn)' : 'var(--line)'};border-radius:12px;padding:10px 12px">
      <span class="sp"><span class="mut small">ลูกค้า${needCustomer ? ' *' : ''}</span><br>${cc ? esc(custLabel(cc)) : textCust ? esc(textCust) : '<span class="mut">+ เลือก / สร้างลูกค้า</span>'}</span>
      <span class="mut small">${cc || textCust ? 'เปลี่ยน' : ''}</span></button>
    <div class="seg">${Object.keys(METHOD).map((m) => `<button data-mt="${m}">${METHOD[m]}</button>`).join('')}</div>
    <div id="mbody"></div>
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
  $('#pcust', el).onclick = () => openCustomers((c) => { setCartCust(c.id); openPay(); });
  $('#confirm', el).onclick = () => {
    let cash = 0, change = 0;
    if (st.method === 'cash') {
      const ci = $('#cash', el);
      cash = ci && ci.value !== '' ? r2(parseFloat(ci.value)) : t;
      if (cash < t) return toast('รับเงินน้อยกว่ายอดที่ต้องชำระ', true);
      change = r2(cash - t);
    }
    const customer = cc ? custLabel(cc) : textCust;
    const note = $('#note', el).value.trim();
    if (needCustomer && !customer) return toast('เลือกลูกค้าก่อน', true);
    if (st.method === 'other' && !note) return toast('ระบุช่องทางชำระในหมายเหตุ', true);
    createBill({ method: st.method, cash, change, note, customer, cust: cc });
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
    refBill: l.refBill || '', refLine: l.refLine || 0, comment: l.comment || '', discReason: l.discReason || ''
  }));
  const total = cartTotal();
  const bill = {
    id: newBillId(), loc: S.loc, createdAt: Date.now(), sellerId: u.id, sellerName: u.name, device: S.device,
    shiftId: sh ? sh.id : '', type: S.cart.every(isCollect) ? 'COLLECT' : 'SALE', lines,
    subtotal: total, discount: 0, total, balance: cartBalance(), method: p.method,
    cash: p.cash, change: p.change, note: p.note, customer: p.customer, synced: 0,
    customerId: p.cust ? p.cust.id : '',
    cust: p.cust ? { name: p.cust.name, phone: p.cust.phone, addr: custAddr(p.cust), code: p.cust.code } : null
  };
  S.bills.unshift(bill);
  saveBills();
  S.cart = []; saveCart(); setCartCust('');
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
    <div class="card"><div class="row"><div class="sp"><h3>${esc(u.name)}</h3><div class="mut small">${esc(ROLE_TH[u.role] || u.role)} · ${locs().length} ทีม: ${esc(locs().map((l) => l.id).join(', '))}</div></div>
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
    <div class="card"><div class="row"><div class="sp"><h3 style="font-size:16px">ลูกค้า</h3>
      <div class="mut small">${myCustomers().length} ราย · สร้าง / แก้ไขข้อมูลลูกค้าของทีม</div></div>
      <button class="btn pri" id="custSet">เปิด</button></div></div>
    <div class="card"><h3 style="font-size:16px">เครื่องพิมพ์ใบเสร็จ</h3>
      <label class="f">วิธีพิมพ์</label>
      <select class="inp" id="pm">
        <option value="none">ไม่พิมพ์ (ใช้แชร์รูปเมื่อต้องการ)</option>
        <option value="rawbt">ผ่านแอป RawBT (SUNMI / Android ทุกรุ่น)</option>
        <option value="ble">Bluetooth ตรงจากแอป (Android + Chrome, เครื่อง BLE)</option>
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
  $('#custSet', v).onclick = () => openCustomers();
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
      const src = imgOf(i);
      return `<button class="li" data-it="${esc(i.id)}" style="width:100%;text-align:left">${src ? `<img src="${src}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover">` : '<span style="width:44px;height:44px;border-radius:8px;background:var(--card2);flex:none"></span>'}<div class="sp"><div>${esc(i.name)}</div>
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
  const el = sheet(`${head(it.name)}
    <div class="card" style="margin-top:0"><div class="mut small" style="margin-bottom:6px">รูปสินค้า (แสดงในหน้าขาย)</div>
      <div class="imgpick"><div class="pv ${imgOf(it) ? '' : 'empty'}" id="ipv">${imgOf(it) ? `<img src="${imgOf(it)}" alt="">` : 'ยังไม่มีรูป'}</div>
        <div class="sp"><div class="mut small">ถ่ายรูปหรือเลือกจากเครื่อง ระบบครอปเป็นสี่เหลี่ยมให้</div>
          <div class="row" style="margin-top:6px"><button class="btn" id="ipick">เลือกรูป</button>${it.img ? '<button class="btn" id="idel">ลบรูป</button>' : ''}</div></div>
        <input type="file" accept="image/*" class="hidden" id="ifile"></div></div>
    <div id="rows"></div>
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
  const saveImg = async (data) => {
    if (!navigator.onLine) return toast('ต้องต่ออินเทอร์เน็ต', true);
    toast('กำลังบันทึกรูป…');
    try {
      const j = await api('saveItemImage', { itemId: it.id, image: data });
      S.data.items = j.items; store.set('data', S.data);
      Object.keys(j.images || {}).forEach((id) => putImg(id, j.images[id]));
      if (!data) { store.del('img_' + it.id); delete IMG[it.id]; }
      toast(data ? 'บันทึกรูปแล้ว' : 'ลบรูปแล้ว');
      editPlans(items().find((x) => x.id === it.id));
    } catch (x) { toast(x.message, true); }
  };
  $('#ipick', el).onclick = () => $('#ifile', el).click();
  $('#ifile', el).onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { saveImg(await squareJpeg(f)); } catch (x) { toast('อ่านรูปไม่ได้', true); }
  };
  const idel = $('#idel', el); if (idel) idel.onclick = () => { if (confirm('ลบรูปสินค้านี้?')) saveImg(''); };
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
async function openScanner(cb) {
  const onHit = typeof cb === 'function' ? cb : onCode;
  SCAN.done = false;
  sheet(`${head('สแกนบาร์โค้ด')}<div id="scanArea"><div class="mut">กำลังเปิดกล้อง…</div></div>
    <div class="mut small" style="margin-top:8px">เล็งบาร์โค้ดให้อยู่ในกรอบ · ใช้เครื่องยิงบาร์โค้ดได้ที่ช่องค้นหา</div>`, { onClose: stopScan });
  const hit = (code) => { if (SCAN.done) return; SCAN.done = true; closeSheet(); onHit(code); };
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

/* ---------- อ่านข้อความ OCR บัตรประชาชน → ชื่อ / ที่อยู่ / อำเภอ / จังหวัด ---------- */
function parseIdCard(text, provinces) {
  const T = String(text || '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ');
  const lines = T.split('\n').map((s) => s.trim()).filter(Boolean);
  const out = { name: '', address: '', district: '', province: '' };
  // ชื่อ: บรรทัด "ชื่อตัวและชื่อสกุล ..." หรือบรรทัดที่ขึ้นต้นด้วยคำนำหน้า
  const TITLE = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง)\s*/;
  for (let i = 0; i < lines.length && !out.name; i++) {
    let l = lines[i];
    const m = /ชื่อ\s*ตัว\s*และ\s*ชื่อ\s*สกุล\s*:?\s*(.*)$/.exec(l);
    if (m) l = m[1] || lines[i + 1] || '';
    else if (!TITLE.test(l)) continue;
    l = l.replace(/[^ก-๙a-zA-Z.\s]/g, '').replace(/\s+/g, ' ').trim().replace(/^(นางสาว|นาย|นาง)\s+/, '$1');
    if (/[ก-๙]{2,}/.test(l) && !/Name|Identification|ประจำตัว/.test(l)) out.name = l;
  }
  if (!out.name) { // อ่านชื่อไทยไม่ได้ → ใช้ชื่ออังกฤษบนบัตรแทน
    const en = /Name\s*:?\s*(Mr\.?|Mrs\.?|Miss|Ms\.?)?\s*([A-Za-z][A-Za-z\-]+)[\s\S]*?Last\s*name\s*:?\s*([A-Za-z][A-Za-z\-]+)/i.exec(T);
    if (en) out.name = (en[1] ? en[1].replace(/\.?$/, '.') + ' ' : '') + en[2] + ' ' + en[3];
  }
  // ที่อยู่: ตั้งแต่ "ที่อยู่" จนเจอวันออกบัตร/วันหมดอายุ
  let addr = '';
  const ai = lines.findIndex((l) => /ที่\s*อยู่/.test(l));
  if (ai >= 0) {
    const buf = [lines[ai].replace(/^.*?ที่\s*อยู่\s*:?\s*/, '')];
    for (let j = ai + 1; j < lines.length && buf.length < 4; j++) {
      if (/วัน\s*ออก|Date of|วัน\s*บัตร|หมด\s*อายุ|Expiry|เจ้า\s*พนักงาน|^\d{1,2}\s*[ก-๙]{2,}\.?\s*\d{4}$/.test(lines[j])) break;
      buf.push(lines[j]);
    }
    addr = buf.join(' ').replace(/\s+/g, ' ').trim();
  }
  if (!addr) return out;
  // จังหวัด
  let pm = /(?:จ\.|จังหวัด)\s*([ก-๙]+)/.exec(addr);
  const findProv = (w) => provinces.find((p) => p === w) || provinces.find((p) => w && (p.startsWith(w) || w.startsWith(p)));
  let prov = pm ? findProv(pm[1]) : '';
  if (!prov) {
    if (/กรุงเทพ/.test(addr)) prov = 'กรุงเทพมหานคร';
    else prov = provinces.filter((p) => addr.includes(p)).sort((a, b) => b.length - a.length)[0] || '';
  }
  out.province = prov || (pm ? pm[1] : '');
  // อำเภอ / เขต
  const dm = /(?:อ\.|อำเภอ|เขต)\s*([ก-๙]+)/.exec(addr);
  if (dm) out.district = dm[1];
  // ที่อยู่ = ส่วนก่อนอำเภอ/เขต (บ้านเลขที่ หมู่ ซอย ถนน ตำบล/แขวง)
  let cut = addr.length;
  if (dm) cut = Math.min(cut, dm.index);
  if (pm) cut = Math.min(cut, pm.index);
  else if (prov && addr.indexOf(prov) >= 0) cut = Math.min(cut, addr.indexOf(prov));
  out.address = addr.slice(0, cut).trim();
  return out;
}

/* ---------- สแกนบัตรประชาชน (OCR) ---------- */
// ตำแหน่งบนบัตร (สัดส่วนของกรอบ) ที่ปิดไว้ก่อนส่ง: แถบเลขบัตร/หัวบัตร และรูปหน้า
const IDC = { W: 1200, R: 85.6 / 54, MASK: [[0, 0, 1, 0.235], [0.71, 0.4, 0.29, 0.6]] };
function idcMask(ctx, w, h) {
  ctx.fillStyle = '#fff';
  IDC.MASK.forEach(([x, y, mw, mh]) => ctx.fillRect(x * w, y * h, mw * w, mh * h));
}
function openIdCardScan(onData) {
  const el = sheet(`${head('สแกนบัตรประชาชน')}
    <div class="idcam" id="idcam"><video playsinline muted></video>
      <div class="idframe"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i>
        <div class="idm idm1">เลขบัตร · ปิดไว้ ไม่ส่งออกจากเครื่อง</div><div class="idm idm2">รูปหน้า<br>ปิดไว้</div>
        <div class="idh">ชื่อ-สกุล</div><div class="idh idh2">ที่อยู่</div></div>
      <div class="idtip" id="idtip">กำลังเปิดกล้อง…</div></div>
    <ul class="mut small idguide">
      <li>ใช้ <b>ด้านหน้า</b>บัตร วางแนวนอนให้ขอบบัตรพอดีกรอบแดง</li>
      <li>ให้ชื่อ-สกุลและที่อยู่อยู่ตรงป้ายในกรอบ · ถือนิ่ง ๆ ให้ตัวหนังสือคมชัด</li>
      <li>เลี่ยงแสงสะท้อนบนบัตร · วางบนพื้นสีเข้ม เรียบ</li>
    </ul>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn" id="idfile" style="flex:0 0 auto">เลือกรูป</button>
      <button class="btn pri" id="idsnap" style="flex:1">ถ่ายบัตร</button></div>
    <input type="file" accept="image/*" capture="environment" id="idin" class="hidden">`, { onClose: stopScan });
  const vid = $('video', el), tip = $('#idtip', el);
  (async () => {
    try {
      SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      vid.srcObject = SCAN.stream; await vid.play();
      tip.textContent = 'วางบัตรให้พอดีกรอบ แล้วกด "ถ่ายบัตร"';
    } catch (e) { tip.textContent = 'เปิดกล้องไม่ได้ — กด "เลือกรูป" เพื่อถ่าย/เลือกรูปบัตรแทน'; }
  })();
  const toCard = (src, sx, sy, sw, sh) => {
    const c = document.createElement('canvas'); c.width = IDC.W; c.height = Math.round(IDC.W / IDC.R);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    idcMask(x, c.width, c.height);
    return c;
  };
  $('#idsnap', el).onclick = () => {
    if (!vid.videoWidth) return $('#idin', el).click();
    // แปลงตำแหน่งกรอบบนจอ → พิกัดในภาพจากกล้อง (video ใช้ object-fit: cover)
    const box = $('#idcam', el).getBoundingClientRect(), fr = $('.idframe', el).getBoundingClientRect();
    const sc = Math.max(box.width / vid.videoWidth, box.height / vid.videoHeight);
    const ox = (box.width - vid.videoWidth * sc) / 2, oy = (box.height - vid.videoHeight * sc) / 2;
    const card = toCard(vid, (fr.left - box.left - ox) / sc, (fr.top - box.top - oy) / sc, fr.width / sc, fr.height / sc);
    confirmCard(card);
  };
  $('#idfile', el).onclick = () => $('#idin', el).click();
  $('#idin', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      // รูปจากเครื่อง: ตัดกลางภาพตามสัดส่วนบัตร (ถ่ายให้บัตรเต็มภาพ)
      let w = im.width, h = w / IDC.R; if (h > im.height) { h = im.height; w = h * IDC.R; }
      confirmCard(toCard(im, (im.width - w) / 2, (im.height - h) / 2, w, h));
    } finally { URL.revokeObjectURL(url); }
  };
  function confirmCard(card) {
    stopScan();
    const data = card.toDataURL('image/jpeg', 0.88);
    const s2 = sheet(`${head('ตรวจรูปบัตร')}
      <img src="${data}" style="width:100%;border-radius:10px;background:#fff">
      <div class="mut small" style="margin:8px 0">ส่วนสีขาวคือเลขบัตรและรูปหน้าที่ปิดไว้ · ตัวหนังสือชื่อและที่อยู่ต้องอ่านออกชัด</div>
      <div class="row" style="gap:8px"><button class="btn" id="idre" style="flex:0 0 auto">ถ่ายใหม่</button>
      <button class="btn pri" id="idok" style="flex:1">อ่านข้อมูล</button></div>`);
    $('#idre', s2).onclick = () => openIdCardScan(onData);
    $('#idok', s2).onclick = async (e) => {
      if (!navigator.onLine) return toast('ต้องต่ออินเทอร์เน็ตเพื่ออ่านบัตร', true);
      e.target.disabled = true; e.target.textContent = 'กำลังอ่าน…';
      try {
        const j = await api('ocrIdCard', { image: data });
        const r = parseIdCard(j.text, PROVINCES);
        if (!r.name && !r.address) throw new Error('อ่านชื่อ/ที่อยู่ไม่ได้ — ถ่ายใหม่ให้ชัดและพอดีกรอบ');
        closeSheet(); onData(r);
      } catch (x) { e.target.disabled = false; e.target.textContent = 'อ่านข้อมูล'; toast(x.message, true); }
    };
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
    { t: 'hr' },
    { t: 'row', l: 'เลขที่', r: b.id, scale: 0.85 },
    { t: 'row', l: 'วันที่', r: dt(b.createdAt), scale: 0.85 }
  );
  if (b.cust) {
    ops.push({ t: 'row', l: 'ลูกค้า', r: b.cust.name, scale: 0.85 });
    if (b.cust.phone) ops.push({ t: 'row', l: 'โทร', r: b.cust.phone, scale: 0.85 });
    if (b.cust.addr) ops.push({ t: 'text', s: b.cust.addr, scale: 0.8 });
  } else if (b.customer) ops.push({ t: 'row', l: 'ลูกค้า', r: b.customer, scale: 0.85 });
  if (b.sellerName) ops.push({ t: 'row', l: 'พนักงาน', r: b.sellerName, scale: 0.85 });
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
    if (!col && l.plan && l.plan.kind === 'cash' && l.plan.total > l.due) {
      ops.push({ t: 'text', s: `   ราคาปกติ ${baht(l.plan.total)} ส่วนลด ${baht((l.plan.total - l.due) * l.qty)}`, scale: 0.8 });
    }
    if (l.comment) ops.push({ t: 'text', s: '   * ' + l.comment, scale: 0.8 });
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
      // ถ้าเครื่องยังไม่มี RawBT จะเปิดหน้า Play Store ให้ติดตั้ง
      const fallback = encodeURIComponent('https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter');
      location.href = 'intent:base64,' + bytesToB64(bytes) +
        '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=' + fallback + ';end;';
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
  const pc = pairFromUrl();
  if (pc) store.set('pair', pc);
  $('#loginBtn').onclick = startLogin;
  $('#qrBtn').onclick = startQrLogin;
  $('#me').onclick = () => go('settings');
  $('#qrNew').onclick = startQrLogin;
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
    if (pc) history.replaceState(null, '', location.pathname);
    showApp();
    syncNow();
    refreshData();
    checkPair();
    if (/Line\//i.test(navigator.userAgent)) fillPicture();
  } else {
    showLogin();
    if (store.get('loginPending', 0) || /[?&](code|liff\.state)=/.test(location.search)) startLogin();
  }
}

// สำหรับทดสอบ
window.__pbdpos = { canvasToEscPos, wrapText, drawDoc, receiptOps };

boot();
})();
