/* PBD POS — หน้าขายหน้างาน (PWA) */
(() => {
'use strict';

const CFG = window.POS_CONFIG || {};
const NATIVE = window.PBDNative || null;   // มีเมื่อเปิดในแอป PBD POS (APK)
{ const v = document.getElementById('loginVer'); if (v) v.textContent = 'PBD POS v' + (CFG.APP_VERSION || ''); }
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
const ROLE_TH = { sales: 'พนักงานขาย', Sales: 'พนักงานขาย', Staff: 'พนักงานขาย', Admin: 'ผู้ดูแลระบบ', BranchAdmin: 'แอดมินประจำสาขา', BranchManager: 'ผู้จัดการสาขา', TeamLead: 'หัวหน้าทีม' };
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
  prn: (() => {
    const p = Object.assign({ mode: /Android/i.test(navigator.userAgent) ? 'ble' : 'share', paper: 58, auto: false, chunk: 100 }, store.get('prn_bak', {}),
      store.get('prn', {}));
    if (p.mode === 'rawbt') p.mode = 'ble';   // เลิกใช้ RawBT แล้ว → Bluetooth ตรงจากแอป
    // เปิดในแอป PBD POS (APK) ครั้งแรก → ใช้เครื่องพิมพ์ของแอป
    if (window.PBDNative && !p.nativeInit) { p.mode = 'app'; p.nativeInit = 1; }
    delete p.ws;
    return p;
  })(),
  device: store.get('device', ''),
  view: 'sell', cat: '', q: '', itemView: store.get('itemView', 'grid'),
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
const savePrn = () => { const ok = store.set('prn', S.prn); store.set('prn_bak', S.prn); return ok; };

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
    // ID token ของ LINE หมดอายุใน 1 ชม. แต่ LIFF จำตัวเก่าไว้ → ถ้าใกล้หมด/หมดแล้ว ให้ล็อกอิน LINE ใหม่เพื่อขอตัวใหม่
    const relogin = () => {
      if (Date.now() - (store.get('liffRelogin', 0) || 0) < 60000) return false;   // กันวนซ้ำ
      store.set('liffRelogin', Date.now()); store.set('loginPending', 1);
      msg.textContent = 'กำลังต่ออายุการเข้าสู่ระบบ LINE…';
      try { liff.logout(); } catch (x) {}
      liff.login({ redirectUri: location.origin + location.pathname });
      return true;
    };
    let dec = null;
    try { dec = liff.getDecodedIDToken(); } catch (x) {}
    if (dec && dec.exp && dec.exp * 1000 < Date.now() + 60000 && relogin()) return;
    const idToken = liff.getIDToken();
    if (!idToken) throw new Error('LINE ไม่ส่ง ID token — เปิด scope openid ในการตั้งค่า LIFF');
    msg.textContent = 'กำลังตรวจสิทธิ์…';
    const t0 = Date.now();
    let pic = '';
    try { pic = (liff.getDecodedIDToken() || {}).picture || ''; } catch (x) {}
    let j;
    try { j = await api('login', { idToken }); }
    catch (e) { if (/expired/i.test(e.message) && relogin()) return; throw e; }
    store.del('liffRelogin');
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
  recvLoop();
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
  S.sctx = null; S.stock = {}; S.loanLines = []; S.loanHist = null; S.loanInbox = null; S.reqs = null;
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
  const q = $('#pqb'), nq = S.pq ? pqWait().length : 0;   // งานพิมพ์รอพิมพ์ (เครื่องรับ)
  if (q) { q.textContent = `รอพิมพ์ ${nq}`; q.classList.toggle('hidden', !nq); }
  $('#netDot').classList.toggle('off', !navigator.onLine);
  $('#teamName').textContent = S.loc ? locName(S.loc) : 'เลือกทีม';
  drawMe();
  const hb = $('#hamBtn');
  if (hb) { let d = $('.nb', hb); const n = reqInboxCount(); if (!d) { d = document.createElement('span'); d.className = 'nb'; hb.appendChild(d); } d.textContent = n; d.classList.toggle('hidden', !n); }
  const nl = loanInboxCount(), lb = $('#nav button[data-v="loan"]');
  if (lb) { let b = $('.nb', lb); if (!b) { b = document.createElement('span'); b.className = 'nb'; lb.appendChild(b); } b.textContent = nl; b.classList.toggle('hidden', !nl); }
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
  if ((S.view === 'loan' || S.view === 'stock') && !canStock()) S.view = 'sell';
  $$('#nav button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === S.view);
    if (b.dataset.v === 'loan' || b.dataset.v === 'stock') b.classList.toggle('hidden', !canStock());
  });
  const v = $('#view');
  ({ sell: renderSell, bills: renderBills, shift: renderShift, report: renderReport, settings: renderSettings,
    loan: renderLoan, stock: renderStock, printq: renderPrintQ, approve: renderApprove })[S.view](v);
  renderSide();
  bindBanners(v);
  renderBadge();
  renderCartBar();
}

/* ----- sell ----- */
function renderSell(v) {
  const cats = Array.from(new Set(items().map((i) => i.cat || i.type).filter(Boolean)));
  if (S.cat && cats.indexOf(S.cat) < 0) S.cat = '';
  v.innerHTML = `${banners()}
    ${!items().length ? `<div class="card mut">ยังไม่มีรายการสินค้า — ต่อเน็ตแล้วไปที่ ตั้งค่า › โหลดสินค้า/ราคาใหม่</div>` : ''}
    <div class="searchrow">
      <input class="search" id="q" placeholder="ค้นหา / ยิงบาร์โค้ด" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search">
      <button class="iconbtn" id="viewBtn" aria-label="${S.itemView === 'list' ? 'แสดงแบบตาราง' : 'แสดงแบบรายการ'}" title="สลับ ตาราง / รายการ">${S.itemView === 'list'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/></svg>'}</button>
      <button class="iconbtn" id="scanBtn" aria-label="สแกน"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/></svg></button>
    </div>
    ${cats.length ? `<select class="inp catsel" id="catSel" aria-label="หมวดสินค้า">${['', ...cats].map((c) => {
      const n = c ? items().filter((i) => (i.cat || i.type) === c).length : items().length;
      return `<option value="${esc(c)}" ${S.cat === c ? 'selected' : ''}>${esc(c || 'ทุกหมวดสินค้า')} (${n})</option>`;
    }).join('')}</select>` : ''}
    <div class="grid${S.itemView === 'list' ? ' lst' : ''}" id="grid"></div>`;
  $('#viewBtn', v).onclick = () => { S.itemView = S.itemView === 'list' ? 'grid' : 'list'; store.set('itemView', S.itemView); render(); };
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
  const cs = $('#catSel', v);
  if (cs) cs.onchange = () => { S.cat = cs.value; renderGrid(); };
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
    <div class="row" style="flex-wrap:wrap" id="rbtn">${receiptBtns(bill, fresh)}</div>
    ${!fresh ? `<div id="rreq">${reqNotes(bill)}</div>` : ''}
    ${fresh ? `<button class="btn ok block" style="margin-top:8px" data-close>ขายบิลถัดไป</button>` : ''}`);
  bindReceiptBtns(el, bill, fresh);
  const cv = await receiptCanvas(bill);
  const rp = $('#rp', el);
  if (!rp) return;
  if (fresh) { rp.appendChild(cv); return; }
  // เปิดจากเมนูบิล: ลายน้ำ "ใบเสร็จในระบบ" บนหน้าจอเท่านั้น (ไม่อยู่ในรูปที่พิมพ์/แชร์)
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;width:100%;max-width:340px;vertical-align:top';
  wrap.appendChild(cv);
  wrap.appendChild(watermarkCanvas(cv.width, cv.height, 'ใบเสร็จในระบบ'));
  rp.appendChild(wrap);
}

function watermarkCanvas(w, h, text) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;pointer-events:none';
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(229,37,42,0.28)';
  x.font = `600 ${Math.round(w / 15)}px Sarabun, Kanit, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const stepX = w * 0.55, stepY = w * 0.32;
  x.translate(w / 2, h / 2); x.rotate(-Math.PI / 4);
  const R = Math.hypot(w, h);
  for (let yy = -R; yy <= R; yy += stepY) {
    const off = (Math.round(yy / stepY) % 2) * stepX / 2;
    for (let xx = -R; xx <= R; xx += stepX) x.fillText(text, xx + off, yy);
  }
  return c;
}

/* ---------- คำขออนุมัติ: พิมพ์ซ้ำ / ยกเลิกบิล ---------- */
const REPRINT_ROLES = ['Admin', 'BranchAdmin', 'BranchManager', 'TeamLead'];
const canReprintDirect = () => REPRINT_ROLES.indexOf(user().role) >= 0;   // หัวหน้าทีม/ผู้จัดการ: พิมพ์ซ้ำได้เลย
const canVoidDirect = () => ['Admin', 'BranchAdmin'].indexOf(user().role) >= 0;   // แอดมินสาขา/แอดมินใหญ่: ยกเลิกได้เลย
const isApprover = () => canReprintDirect();
const reqsOf = (billId, type) => ((S.reqs && S.reqs.list) || []).filter((q) => q.mine && q.billId === billId && q.type === type);
const reqInbox = () => ((S.reqs && S.reqs.list) || []).filter((q) => q.canDecide);
const reqInboxCount = () => reqInbox().length;
function reprintReady(billId) {   // สิทธิ์พิมพ์ซ้ำที่อนุมัติแล้ว (ใช้ได้ครั้งเดียว · พิมพ์ไม่ออกลองซ้ำได้ใน 10 นาที)
  return reqsOf(billId, 'REPRINT').find((q) => q.status === 'APPROVED' || (q.status === 'USED' && Date.now() - q.usedAt < 10 * 60000));
}
async function loadReqs() {
  const j = await api('reqList', {});
  S.reqs = { list: j.requests || [], at: Date.now() };
  renderBadge(); renderSide();
  return S.reqs;
}
setInterval(() => { if (S.session && navigator.onLine && !document.hidden) loadReqs().catch(() => {}); }, 2 * 60000);
setTimeout(() => { if (S.session && navigator.onLine) loadReqs().catch(() => {}); }, 3000);

function receiptBtns(bill, fresh) {
  const today = ymd(bill.createdAt) === ymd(Date.now());
  let h = '';
  if (fresh || (today && canReprintDirect())) {
    h += `<button class="btn pri sp" id="pr">${fresh ? 'พิมพ์' : 'พิมพ์ซ้ำ'}</button><button class="btn sp" id="sh">แชร์รูป</button>`;
  } else if (!today) {
    h += '<div class="mut small sp">พิมพ์ซ้ำได้เฉพาะวันที่ขาย</div>';
  } else if (!bill.void) {
    const ok = reprintReady(bill.id), pend = reqsOf(bill.id, 'REPRINT').find((q) => q.status === 'PENDING');
    h += ok ? '<button class="btn pri sp" id="pra">พิมพ์ซ้ำ (อนุมัติแล้ว)</button>'
      : pend ? '<button class="btn sp" disabled>รออนุมัติพิมพ์ซ้ำ</button>'
      : '<button class="btn pri sp" id="rqp">ขอพิมพ์ซ้ำ</button>';
  }
  if (!fresh && !bill.void) {
    const vp = reqsOf(bill.id, 'VOID').find((q) => q.status === 'PENDING');
    h += canVoidDirect() ? '<button class="btn sp" id="vd">ยกเลิกบิล</button>'
      : vp ? '<button class="btn sp" disabled>รออนุมัติยกเลิกบิล</button>'
      : '<button class="btn sp" id="rqv">ขอยกเลิกบิล</button>';
  }
  return h;
}
function reqNotes(bill) {
  const rs = reqsOf(bill.id, 'REPRINT').concat(reqsOf(bill.id, 'VOID')).slice(0, 4);
  return rs.map((q) => `<div class="li small" style="padding:6px 0">
      <span class="tag ${q.status === 'PENDING' ? 'wait' : q.status === 'REJECTED' ? 'err' : 'ok'}">${q.type === 'VOID' ? 'ยกเลิกบิล' : 'พิมพ์ซ้ำ'} · ${esc(q.statusTh)}</span>
      <span class="sp mut">${hm(q.at)}${q.decidedBy ? ' · ' + esc(q.decidedBy) : ''}${q.note ? ' · ' + esc(q.note) : ''}</span>
      ${q.status === 'PENDING' ? `<button class="btn" data-rqc="${esc(q.id)}" style="flex:none;padding:4px 10px">ยกเลิกคำขอ</button>` : ''}</div>`).join('');
}
function bindReceiptBtns(el, bill, fresh) {
  const copy = fresh ? bill : Object.assign({}, bill, { copy: true });
  const redraw = () => {
    const rb = $('#rbtn', el); if (rb) rb.innerHTML = receiptBtns(bill, fresh);
    const rr = $('#rreq', el); if (rr) rr.innerHTML = reqNotes(bill);
    bindReceiptBtns(el, bill, fresh);
  };
  const on = (id, fn) => { const b = $(id, el); if (b) b.onclick = fn; };
  on('#pr', () => {
    if (!fresh && ymd(bill.createdAt) !== ymd(Date.now())) return toast('พิมพ์ซ้ำได้เฉพาะวันที่ขาย', true);
    printBill(copy);
  });
  on('#sh', async () => shareCanvas(await receiptCanvas(copy), `receipt-${bill.id}.png`));
  on('#vd', () => voidBill(bill.id));
  on('#pra', async (e) => {
    const q = reprintReady(bill.id);
    if (!q) return;
    e.target.disabled = true;
    try { await api('reqUse', { id: q.id }); if (q.status !== 'USED') { q.status = 'USED'; q.usedAt = Date.now(); } await printBill(copy); }
    catch (x) { toast(x.message, true); }
    loadReqs().then(redraw).catch(redraw);
  });
  on('#rqp', () => askReqReason('ขอพิมพ์ซ้ำ ' + bill.id, 'เหตุผล (ไม่บังคับ)', ['กระดาษติด/พิมพ์ไม่ออก', 'ลูกค้าขอเพิ่ม', 'ใบเสร็จหาย'], false,
    (r) => sendReq('REPRINT', bill, r, () => { closeSheet(); printBill(copy); }).then(redraw)));
  on('#rqv', () => askReqReason('ขอยกเลิกบิล ' + bill.id, 'เหตุผลที่ยกเลิกบิล *', ['ลูกค้ายกเลิก', 'คีย์ผิด', 'เปลี่ยนสินค้า'], true,
    (r) => sendReq('VOID', bill, r, () => voidBill(bill.id, r)).then(redraw)));
  $$('[data-rqc]', el).forEach((b) => { b.onclick = async () => {
    b.disabled = true;
    try { const r = await api('reqCancel', { id: b.dataset.rqc }); toast(r.message); } catch (x) { toast(x.message, true); }
    loadReqs().then(redraw).catch(redraw);
  }; });
}
function askReqReason(title, label, chips, required, cb) {
  const el = sheet(`${head(title)}
    <label class="f">${label}</label><input class="inp" id="qr" maxlength="200">
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${chips.map((t) => `<button class="chip" data-r="${t}">${t}</button>`).join('')}</div>
    <button class="btn pri block" id="qok" style="margin-top:14px">ส่งคำขอ</button>`);
  $$('[data-r]', el).forEach((b) => { b.onclick = () => { $('#qr', el).value = b.dataset.r; }; });
  $('#qok', el).onclick = () => {
    const r = $('#qr', el).value.trim();
    if (required && r.length < 2) return toast('ใส่เหตุผล', true);
    closeSheet(); cb(r);
  };
}
/** ส่งคำขอ · ถ้าเซิร์ฟเวอร์ตอบว่ามีสิทธิ์ทำเองได้ (direct) ก็ทำเลย */
async function sendReq(type, bill, reason, direct) {
  if (!navigator.onLine) return toast('ส่งคำขอต้องต่ออินเทอร์เน็ต', true);
  const local = S.bills.find((b) => b.id === bill.id);
  if (local && !local.synced) { await syncNow(); if (!local.synced) return toast('ส่งบิลนี้ขึ้นระบบไม่ได้ ยังส่งคำขอไม่ได้', true); }
  try {
    const r = await api('reqCreate', { type, billId: bill.id, reason });
    if (r.direct) return direct();
    toast(r.message || 'ส่งคำขอแล้ว');
    await loadReqs();
  } catch (x) { toast(x.message, true); }
}

/* ----- หน้าคำขออนุมัติ ----- */
function renderApprove(v) {
  const rs = S.reqs;
  if (!rs || Date.now() - rs.at > 60000) {
    if (navigator.onLine) loadReqs().then(() => { if (S.view === 'approve') render(); }).catch((e) => toast(e.message, true));
    if (!rs) { v.innerHTML = `${banners()}<div class="card mut">${navigator.onLine ? 'กำลังโหลดคำขอ…' : 'ต้องต่ออินเทอร์เน็ต'}</div>`; return; }
  }
  const inbox = reqInbox(), mine = rs.list.filter((q) => q.mine);
  const card = (q, act) => `<div class="li" style="display:block">
      <div class="row"><span class="tag ${q.type === 'VOID' ? 'err' : 'wait'}">${q.type === 'VOID' ? 'ขอยกเลิกบิล' : 'ขอพิมพ์ซ้ำ'}</span>
        <b class="sp num" style="margin-left:6px">${esc(q.billId)}</b><span class="mut small">${dt(q.at)}</span></div>
      <div class="small" style="margin-top:4px">${esc(locName(q.loc))} · ขอโดย ${esc(q.byName)}${q.reason ? ' · ' + esc(q.reason) : ''}</div>
      ${act ? `<div class="row" style="gap:8px;margin-top:8px"><button class="btn" data-bv="${esc(q.billId)}" style="flex:none">ดูบิล</button>
        <button class="btn" data-rj="${esc(q.id)}" style="flex:1">ไม่อนุมัติ</button><button class="btn ok" data-ap="${esc(q.id)}" style="flex:1">อนุมัติ</button></div>`
      : `<div class="small" style="margin-top:4px"><span class="tag ${q.status === 'PENDING' ? 'wait' : q.status === 'REJECTED' ? 'err' : 'ok'}">${esc(q.statusTh)}</span>
        <span class="mut">${q.decidedBy ? esc(q.decidedBy) + ' ' + dt(q.decidedAt) : ''}${q.note ? ' · ' + esc(q.note) : ''}</span></div>`}</div>`;
  v.innerHTML = `${banners()}
    <div class="row" style="margin-bottom:8px"><h2 class="sp" style="font-size:20px">คำขออนุมัติ</h2><button class="btn" id="rqr" style="flex:none">รีเฟรช</button></div>
    ${isApprover() ? `<div class="card"><h3 style="font-size:16px">รอคุณอนุมัติ · ${inbox.length}</h3>
      <div class="list">${inbox.map((q) => card(q, true)).join('') || '<div class="mut">ไม่มีคำขอที่รออนุมัติ</div>'}</div>
      <div class="mut small" style="margin-top:6px">พิมพ์ซ้ำ: หัวหน้าทีม / ผู้จัดการที่ดูแลทีม · ยกเลิกบิล: แอดมินสาขา / แอดมินใหญ่</div></div>` : ''}
    <div class="card"><h3 style="font-size:16px">คำขอของฉัน (3 วันล่าสุด)</h3>
      <div class="list">${mine.map((q) => card(q, false)).join('') || '<div class="mut">ยังไม่มีคำขอ</div>'}</div></div>`;
  $('#rqr', v).onclick = () => { S.reqs.at = 0; render(); };
  const decide = async (id, ok, note, btn) => {
    btn.disabled = true;
    try {
      const r = await api('reqDecide', { id, ok, note: note || '' });
      toast(r.message || 'บันทึกแล้ว');
      const q = S.reqs.list.find((x) => x.id === id);
      if (q && ok && q.type === 'VOID') { const lb = S.bills.find((b) => b.id === q.billId); if (lb) { lb.void = true; saveBills(); } }
      await loadReqs().catch(() => {});
      render();
    } catch (x) { btn.disabled = false; toast(x.message, true); }
  };
  $$('[data-ap]', v).forEach((b) => { b.onclick = () => {
    const q = S.reqs.list.find((x) => x.id === b.dataset.ap);
    if (q && q.type === 'VOID' && !confirm('อนุมัติยกเลิกบิล ' + q.billId + '? บิลจะถูกยกเลิกทันที')) return;
    decide(b.dataset.ap, true, '', b);
  }; });
  $$('[data-rj]', v).forEach((b) => { b.onclick = () => {
    const el = sheet(`${head('ไม่อนุมัติ')}<label class="f">เหตุผล *</label><input class="inp" id="rjr" maxlength="200">
      <button class="btn pri block" id="rjok" style="margin-top:12px">ยืนยันไม่อนุมัติ</button>`);
    $('#rjok', el).onclick = () => { const r = $('#rjr', el).value.trim(); if (!r) return toast('ใส่เหตุผล', true); closeSheet(); decide(b.dataset.rj, false, r, b); };
  }; });
  $$('[data-bv]', v).forEach((b) => { b.onclick = () => {
    const lb = S.bills.find((x) => x.id === b.dataset.bv);
    if (lb) showReceipt(lb); else toast('บิลนี้ไม่ได้อยู่ในเครื่องนี้ — ดูได้ที่หน้ารายงาน');
  }; });
}

async function voidBill(id, presetReason) {
  if (!navigator.onLine) return toast('ยกเลิกบิลต้องต่ออินเทอร์เน็ต', true);
  const local = S.bills.find((b) => b.id === id);
  if (local && !local.synced) { await syncNow(); if (!local.synced) return toast('ส่งบิลนี้ขึ้นระบบไม่ได้ ยังยกเลิกไม่ได้', true); }
  const reason = presetReason || prompt('เหตุผลที่ยกเลิกบิล ' + id);
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
      ${b.status === 'VOID' ? '<span class="tag void">ยกเลิก</span>' : `<button class="mut small" data-vb="${esc(b.id)}">${canVoidDirect() ? 'ยกเลิกบิล' : 'ขอยกเลิกบิล'}</button>`}</div></div>`).join('') || '<div class="mut">-</div>'}</div></div>`;
  $$('[data-vb]', out).forEach((b) => { b.onclick = () => {
    if (canVoidDirect()) return voidBill(b.dataset.vb);
    const bill = { id: b.dataset.vb };
    askReqReason('ขอยกเลิกบิล ' + bill.id, 'เหตุผลที่ยกเลิกบิล *', ['ลูกค้ายกเลิก', 'คีย์ผิด', 'เปลี่ยนสินค้า'], true,
      (r) => sendReq('VOID', bill, r, () => voidBill(bill.id, r)));
  }; });
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
        ${NATIVE ? '<option value="app">เครื่องพิมพ์ของแอป PBD POS (SUNMI ในตัว / Bluetooth) · แนะนำ</option>' : ''}
        <option value="none">ไม่พิมพ์ (ใช้แชร์รูปเมื่อต้องการ)</option>
        <option value="sys">เครื่องพิมพ์ในตัว SUNMI / พิมพ์ผ่านระบบ Android</option>
        <option value="ble">Bluetooth ตรงจากแอป (Android + Chrome, เครื่อง BLE)</option>
        <option value="share">แชร์รูปใบเสร็จไปแอปเครื่องพิมพ์ (iPhone/iPad)</option>
        <option value="relay">ส่งไปพิมพ์ที่เครื่อง SUNMI/Android ผ่านอินเทอร์เน็ต (iPhone/iPad)</option>
      </select>
      <div id="relayBox" class="${p.mode === 'relay' ? '' : 'hidden'}" style="margin-top:10px">
        <label class="f">เครื่องรับงานพิมพ์</label>
        <div class="row" style="gap:8px"><select class="inp" id="rtg" style="flex:1"><option value="">${p.target ? esc(p.targetName || p.target) : 'กำลังค้นหา…'}</option></select>
          <button class="btn" id="rtr" style="flex:none">ค้นหา</button></div>
        <div class="mut small" style="margin-top:6px">เครื่องรับต้องเปิดแอป PBD POS ค้างไว้ และติ๊ก "รับงานพิมพ์จากเครื่องอื่น" ในหน้านี้ของเครื่องนั้น</div>
      </div>
      ${p.mode === 'app' ? `<div style="margin-top:10px"><label class="f">เครื่องพิมพ์</label>
        <div class="row" style="gap:8px"><select class="inp" id="nprn" style="flex:1"></select><button class="btn" id="nrf" style="flex:none">รีเฟรช</button></div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn sp" id="nbt">อนุญาต Bluetooth</button><button class="btn sp" id="nbs">จับคู่เครื่องพิมพ์ใหม่</button></div>
        <div class="mut small" style="margin-top:6px">SUNMI: เลือก "เครื่องพิมพ์ในตัว SUNMI" · เครื่องพกพา (เช่น MP210): จับคู่ใน Bluetooth ของ Android ก่อน แล้วกดรีเฟรช</div></div>` : ''}
      ${p.mode === 'ble' || p.mode === 'sys' || p.mode === 'app' ? `${p.mode === 'sys' ? '<div class="mut small" style="margin-top:8px">กดพิมพ์ → หน้าพิมพ์ของ Android เปิดขึ้น → เลือกเครื่องพิมพ์ในตัว (เช่น SUNMI / InnerPrinter / Built-in) → กดปุ่มพิมพ์ · ครั้งแรกให้ตั้งขนาดกระดาษ 58 มม. (หรือ 80 มม.)</div>' : ''}<label class="row" style="margin-top:12px"><input type="checkbox" id="rcv" ${p.recv ? 'checked' : ''}><span>รับงานพิมพ์จากเครื่องอื่น (เช่น iPhone) · เปิดแอปค้างไว้</span></label>
      <div id="rcvBox" class="${p.recv ? '' : 'hidden'}"><label class="f">ชื่อเครื่องนี้ (ให้เครื่องอื่นเห็น)</label>
        <input class="inp" id="rcn" maxlength="40" value="${esc(recvName())}"></div>` : ''}
      <label class="f">ขนาดกระดาษ</label>
      <div class="seg" style="grid-template-columns:1fr 1fr"><button data-pp="58">58 mm</button><button data-pp="80">80 mm</button></div>
      <div id="bleBox" class="${p.mode === 'ble' ? '' : 'hidden'}">
        <div class="row"><span class="sp small" id="bleSt"></span><button class="btn" id="bleC">ค้นหาเครื่องพิมพ์</button></div>
        <label class="f">เครื่องพิมพ์ที่เคยเชื่อมต่อ</label>
        <div class="list" id="bleList"><div class="mut small">กำลังโหลด…</div></div>
        <label class="f">ขนาดก้อนข้อมูล (ลดลงถ้าพิมพ์ขาด/ค้าง)</label>
        <select class="inp" id="ck">${[20, 100, 180, 512].map((n) => `<option ${p.chunk === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </div>
      <label class="row" style="margin-top:12px"><input type="checkbox" id="slw" ${p.slow ? 'checked' : ''}><span>เครื่องพิมพ์พกพา / พิมพ์หยุดกลางทาง — ส่งข้อมูลช้าลง</span></label>
      <label class="row" style="margin-top:12px"><input type="checkbox" id="ap" ${p.auto ? 'checked' : ''}><span>พิมพ์อัตโนมัติหลังขายเสร็จ</span></label>
      <button class="btn block" id="tp" style="margin-top:10px">พิมพ์ทดสอบ</button>
      <button class="btn pri block" id="prnSave" style="margin-top:8px">บันทึกการตั้งค่าเครื่องพิมพ์</button>
      <div class="mut small" style="margin-top:6px;text-align:center">${p.savedAt ? 'บันทึกล่าสุด ' + dt(p.savedAt) + ' · ' : ''}จำค่าไว้ในเครื่องนี้จนกว่าจะเปลี่ยน</div></div>
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
  $('#slw', v).onchange = (e) => { p.slow = e.target.checked; savePrn(); render(); };
  const ck = $('#ck', v); if (ck) ck.onchange = (e) => { p.chunk = +e.target.value; savePrn(); };
  $('#bleC', v).onclick = async () => { try { await bleConnect(); toast('เชื่อมต่อเครื่องพิมพ์แล้ว'); } catch (e) { toast(e.message, true); } bleStatus(); bleKnown(v); };
  bleStatus();
  if (p.mode === 'ble') bleKnown(v);
  if (p.mode === 'app') nativePrinterUi(v);
  const rcv = $('#rcv', v);
  if (rcv) rcv.onchange = (e) => { p.recv = e.target.checked; savePrn(); recvLoop(); render(); };
  const rcn = $('#rcn', v);
  if (rcn) rcn.oninput = rcn.onchange = (e) => { p.recvName = e.target.value.trim(); savePrn(); };
  $('#prnSave', v).onclick = () => {   // บันทึกค่าทั้งหมดในการ์ดนี้ (จำไว้ในเครื่องจนกว่าจะเปลี่ยน)
    const g = (id) => $(id, v);
    if (g('#pm')) p.mode = g('#pm').value;
    if (g('#ap')) p.auto = g('#ap').checked;
    if (g('#slw')) p.slow = g('#slw').checked;
    if (g('#ck')) p.chunk = +g('#ck').value;
    if (g('#rcv')) p.recv = g('#rcv').checked;
    if (g('#rcn')) p.recvName = g('#rcn').value.trim();
    const t = g('#rtg'); if (t && t.value) { p.target = t.value; p.targetName = t.selectedOptions[0] ? t.selectedOptions[0].textContent.replace(/ \(ยังไม่ออนไลน์ตอนนี้\)$/, '') : p.targetName; }
    p.savedAt = Date.now();
    if (savePrn()) { store.set('prn_bak', S.prn); toast('บันทึกการตั้งค่าเครื่องพิมพ์แล้ว — จำไว้จนกว่าจะเปลี่ยน'); } else toast('บันทึกไม่ได้ (พื้นที่ในเครื่องเต็ม)', true);
    recvLoop(); render();
  };
  const loadRecv = async () => {
    const sel = $('#rtg', v);
    if (!sel) return;
    try {
      if (!S.loc) { sel.innerHTML = '<option value="">เลือกทีมก่อน (มุมขวาบน)</option>'; return; }
      const j = await api('printReceivers', { loc: S.loc });   // เห็นเฉพาะเครื่องรับในสาขาเดียวกับทีมที่เลือกอยู่
      const rs = (j.receivers || []).filter((r) => r.device !== S.device);
      // เครื่องที่บันทึกไว้: จำไว้เสมอแม้ตอนนี้ออฟไลน์ (เปลี่ยนเมื่อผู้ใช้เลือกเครื่องใหม่เท่านั้น)
      const saved = p.target && !rs.some((r) => r.device === p.target) ? `<option value="${esc(p.target)}" selected>${esc(p.targetName || p.target)} (ยังไม่ออนไลน์ตอนนี้)</option>` : '';
      sel.innerHTML = rs.length || saved ? `<option value="">— เลือกเครื่อง —</option>` + saved + rs.map((r) => `<option value="${esc(r.device)}" ${r.device === p.target ? 'selected' : ''}>${esc(r.name)}${r.loc ? ' · ' + esc(locName(r.loc)) : ''}</option>`).join('')
        : `<option value="">ไม่พบเครื่องรับงานในสาขานี้ที่เปิดอยู่</option>`;
    } catch (e) { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
  };
  if (p.mode === 'relay') {
    loadRecv();
    $('#rtr', v).onclick = loadRecv;
    $('#rtg', v).onchange = (e) => { p.target = e.target.value; p.targetName = e.target.selectedOptions[0] ? e.target.selectedOptions[0].textContent.replace(/ \(ยังไม่ออนไลน์ตอนนี้\)$/, '') : ''; savePrn(); if (p.target) toast('จะส่งงานพิมพ์ไปที่ ' + p.targetName); };
  }
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
  ['header', 'ข้อความหัวใบเสร็จ (แสดงใต้เบอร์โทร)', 'textarea'],
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
    const sample = sampleBill();
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

function go(view) { closeSide(); S.view = view; window.scrollTo(0, 0); render(); }

/* ---------- เมนูด้านข้าง (แฮมเบอร์เกอร์) ---------- */
const STOCK_ROLES = ['Admin', 'BranchAdmin', 'BranchManager', 'TeamLead'];
const canStock = () => STOCK_ROLES.indexOf(user().role) >= 0;
const ICON = {
  bills: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  shift: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  report: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
  settings: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  open: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  collect: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/><path d="M16 15h2"/>',
  approve: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  printq: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><circle cx="18" cy="12" r="1"/>',
  loan: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  stock: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  sell: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6.2"/>'
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
function renderSide() {
  const side = $('#side');
  if (!side || !S.session) return;
  drawMe();
  const sh = S.loc ? openShift() : null;
  const it = (v, label, extra) => `<button class="si ${S.view === v ? 'on' : ''}" data-sv="${v}">${svg(v)}<span>${label}</span>${extra || ''}</button>`;
  side.innerHTML = `<div class="sme">${$('#me') ? $('#me').innerHTML : ''}</div>
    ${it('sell', 'ขาย')}
    ${(() => { const n = outstandingList().filter((o) => o.loc === S.loc).length;
      return `<button class="si" id="sideCol">${svg('collect')}<span>เก็บเพิ่ม / เก็บเงินดาวน์เพิ่ม</span>${n ? `<span class="r pend">${n}</span>` : ''}</button>`; })()}
    <button class="si" data-sv="shift" data-open="1">${svg('open')}<span>${sh ? 'ปิดกะ' : 'เปิดกะ'}</span>
      <span class="r mut small">${sh ? 'เปิดอยู่ ' + hm(sh.openAt) : S.loc ? 'ยังไม่เปิด' : ''}</span></button>
    ${it('bills', 'บิล', pendingBills().length ? `<span class="r pend">${pendingBills().length}</span>` : '')}
    ${it('shift', 'กะ/เงินสด')}
    ${it('report', 'รายงาน')}
    ${it('approve', 'คำขออนุมัติ', reqInboxCount() ? `<span class="r pend">${reqInboxCount()}</span>` : '')}
    ${canStock() ? `<div class="sect">สต็อกทีม</div>${it('loan', 'ยืม - คืน สินค้า', loanInboxCount() ? `<span class="r pend">${loanInboxCount()}</span>` : '')}${it('stock', 'สินค้าคงเหลือ')}` : ''}
    <div class="sect">ระบบ</div>
    ${S.prn.recv || S.pq.length ? it('printq', 'คิวงานพิมพ์', pqWait().length ? `<span class="r pend">${pqWait().length}</span>` : '') : ''}
    ${it('settings', 'ตั้งค่า')}
    <div class="grow"></div>
    <button class="logout" id="sideOut"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>ออกจากระบบ</button>
    <div class="ver">PBD POS ${esc(CFG.APP_VERSION || '')}</div>`;
  $$('[data-sv]', side).forEach((b) => { b.onclick = () => go(b.dataset.sv); });
  $('#sideCol', side).onclick = () => { if (S.view !== 'sell') go('sell'); else closeSide(); openCollect(); };
  $('#sideOut', side).onclick = () => {
    if (!pendingBills().length && !confirm('ออกจากระบบ?')) return;
    closeSide(); logout();
  };
}
function openSide() { renderSide(); $('#side').classList.add('open'); $('#sideOv').classList.remove('hidden'); }
function closeSide() { const s = $('#side'); if (s) s.classList.remove('open'); const o = $('#sideOv'); if (o) o.classList.add('hidden'); }

/* ---------- สต็อกทีม: สินค้าคงเหลือ / ยืม - คืน (ใช้ข้อมูลจาก PBDSTOCK ต้องต่อเน็ต) ---------- */
S.stock = {};
async function loadCtx(force) {
  if (!force && S.sctx && Date.now() - S.sctx.at < 10 * 60000) return S.sctx;
  if (!navigator.onLine) { if (S.sctx) return S.sctx; throw new Error('ต้องต่ออินเทอร์เน็ตเพื่อดูสต็อก'); }
  const j = await api('stockCtx', {});
  S.sctx = Object.assign(j, { at: Date.now() });
  return S.sctx;
}
async function loadStock(loc, force) {
  const c = S.stock[loc];
  if (!force && c && Date.now() - c.at < 2 * 60000) return c;
  if (!navigator.onLine) { if (c) return c; throw new Error('ต้องต่ออินเทอร์เน็ตเพื่อดูสต็อก'); }
  const j = await api('stockGet', { loc });
  S.stock[loc] = { qty: j.qty || {}, at: Date.now() };
  return S.stock[loc];
}
const sName = (id) => {
  const c = S.sctx || {};
  const l = (c.teams || []).concat(c.branches || []).find((x) => x.id === id);
  return l ? l.name : locName(id);
};
const sItem = (id) => ((S.sctx && S.sctx.items) || []).find((i) => i.id === id) || { id, name: id };
/** คลังที่ดูได้: หัวหน้าทีม = ทีมตัวเอง + สโตร์สาขา · ผู้จัดการ = สโตร์สาขา + ทุกทีมในสาขา */
function stockLocs() {
  const c = S.sctx;
  if (!c) return [];
  if (c.isTeamLead) return [c.myTeam, c.myBranch].filter(Boolean);
  const out = [];
  (c.branches || []).forEach((b) => {
    if (!c.teams.some((t) => t.parent === b.id) && b.id !== c.myBranch) return;
    out.push(b.id);
    c.teams.filter((t) => t.parent === b.id).forEach((t) => out.push(t.id));
  });
  return out;
}
const loanTeams = () => {
  const c = S.sctx;
  if (!c) return [];
  return c.isTeamLead ? (c.myTeam ? [c.myTeam] : []) : c.teams.map((t) => t.id);
};
const teamBranch = (team) => { const t = ((S.sctx && S.sctx.teams) || []).find((x) => x.id === team); return t ? t.parent : (S.sctx && S.sctx.myBranch); };
function stockWait(v, fn) {
  v.innerHTML = `${banners()}<div class="card mut">กำลังโหลดข้อมูลสต็อกจาก PBDSTOCK…</div>`;
  fn().then(() => { if (S.view === 'stock' || S.view === 'loan') render(); })
    .catch((e) => { v.innerHTML = `${banners()}<div class="banner">${esc(e.message)}</div><button class="btn block" id="sRetry">ลองใหม่</button>`; $('#sRetry', v).onclick = () => render(); });
}

function renderStock(v) {
  if (!S.sctx) return stockWait(v, () => loadCtx());
  const locsOk = stockLocs();
  if (!locsOk.length) { v.innerHTML = '<div class="card mut">บัญชีนี้ยังไม่มีคลังที่ดูได้</div>'; return; }
  if (locsOk.indexOf(S.stockLoc) < 0) S.stockLoc = locsOk.indexOf(S.loc) >= 0 ? S.loc : locsOk[0];
  const st = S.stock[S.stockLoc];
  if (!st) return stockWait(v, () => loadStock(S.stockLoc));
  const q = (S.stockQ || '').toLowerCase();
  const rows = Object.keys(st.qty).filter((id) => Number(st.qty[id]) !== 0).map((id) => ({ it: sItem(id), n: Number(st.qty[id]) }))
    .filter((r) => !q || (r.it.name + ' ' + r.it.id).toLowerCase().includes(q))
    .sort((a, b) => a.it.name.localeCompare(b.it.name, 'th'));
  const total = rows.reduce((a, r) => a + r.n, 0);
  v.innerHTML = `${banners()}
    <div class="row" style="gap:8px;margin-bottom:8px">
      <select class="inp" id="sl" style="flex:1">${locsOk.map((id) => `<option value="${esc(id)}" ${id === S.stockLoc ? 'selected' : ''}>${esc(sName(id))}${id === teamBranch(id) || (S.sctx.branches || []).some((b) => b.id === id) ? ' (สโตร์สาขา)' : ''}</option>`).join('')}</select>
      <button class="btn" id="sr" style="flex:none">รีเฟรช</button></div>
    <input class="search" id="sq" placeholder="ค้นหาสินค้า" value="${esc(S.stockQ || '')}" autocomplete="off" style="margin-bottom:8px">
    <div class="kpis"><div class="kpi"><div class="mut small">รวมคงเหลือ</div><div class="v num">${total} ชิ้น</div></div>
      <div class="kpi"><div class="mut small">อัปเดต</div><div class="v num" style="font-size:18px">${hm(st.at)}</div></div></div>
    <div class="card">${rows.map((r) => `<div class="stk"><div class="sp"><div>${esc(r.it.name)}</div><div class="mut small">${esc(r.it.id)}${r.it.cat ? ' · ' + esc(r.it.cat) : ''}</div></div>
      <div class="q num ${r.n < 0 ? 'neg' : ''}">${r.n}</div></div>`).join('') || '<div class="mut">ไม่มีสินค้าคงเหลือ</div>'}</div>
    <div class="mut small" style="margin-top:6px">จำนวนจากสมุดเคลื่อนไหวของ PBDSTOCK · ยอดติดลบ = ขายใน Loyverse มากกว่าที่เบิก</div>`;
  $('#sl', v).onchange = (e) => { S.stockLoc = e.target.value; render(); };
  $('#sr', v).onclick = () => { delete S.stock[S.stockLoc]; render(); };
  const sq = $('#sq', v);
  sq.oninput = () => { S.stockQ = sq.value; const pos = sq.selectionStart; render(); const n = $('#sq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
}

function renderLoan(v) {
  if (!S.sctx) return stockWait(v, () => loadCtx());
  const teams = loanTeams();
  if (!teams.length) { v.innerHTML = '<div class="card mut">บัญชีนี้ยังไม่ได้อยู่ในทีม — ให้ Admin ตั้งทีมในหน้าจัดการผู้ใช้</div>'; return; }
  // ยืม = ยืมของจากทีมอื่นในสาขาเดียวกันเข้าทีมเรา · คืน = คืนของให้ทีมที่ยืมมา (เอกสารโอนระหว่างทีม ย้ายสต็อกทันที)
  const tab = ['BORROW', 'GIVEBACK', 'APPROVE', 'HIST'].indexOf(S.loanTab) >= 0 ? S.loanTab : (loanInboxCount() ? 'APPROVE' : 'BORROW');
  if (teams.indexOf(S.loanTeam) < 0) S.loanTeam = teams.indexOf(S.loc) >= 0 ? S.loc : teams[0];
  const team = S.loanTeam, br = teamBranch(team);
  const others = ((S.sctx && S.sctx.teams) || []).filter((t) => t.parent === br && t.id !== team).map((t) => t.id);
  if (others.indexOf(S.loanOther) < 0) S.loanOther = others[0] || '';
  const other = S.loanOther;
  const nIn = loanInboxCount();
  const tabs = `<div class="chips" style="margin-bottom:8px">${[['BORROW', 'ยืม (จากทีมอื่น)'], ['GIVEBACK', 'คืน (ให้ทีมที่ยืม)'], ['APPROVE', 'รออนุมัติ' + (nIn ? ` (${nIn})` : '')], ['HIST', 'ประวัติ']].map(([k, t]) =>
    `<button class="chip ${tab === k ? 'on' : ''}" data-lt="${k}">${t}</button>`).join('')}</div>
    <label class="f" style="margin-top:0">ทีมของเรา</label>
    <select class="inp" id="lteam" style="margin-bottom:8px" ${teams.length < 2 ? 'disabled' : ''}>${teams.map((id) => `<option value="${esc(id)}" ${id === team ? 'selected' : ''}>${esc(sName(id))}</option>`).join('')}</select>
    ${tab !== 'HIST' && others.length ? `<label class="f" style="margin-top:0">${tab === 'BORROW' ? 'ยืมจากทีม' : 'คืนให้ทีม'}</label>
    <select class="inp" id="lother" style="margin-bottom:8px">${others.map((id) => `<option value="${esc(id)}" ${id === other ? 'selected' : ''}>${esc(sName(id))}</option>`).join('')}</select>` : ''}`;
  const bind = () => {
    $$('[data-lt]', v).forEach((b) => { b.onclick = () => { S.loanTab = b.dataset.lt; render(); }; });
    $('#lteam', v).onchange = (e) => { S.loanTeam = e.target.value; S.loanLines = []; render(); };
    const lo = $('#lother', v);
    if (lo) lo.onchange = (e) => { S.loanOther = e.target.value; S.loanLines = []; render(); };
  };
  const docKind = (d) => {   // ป้ายประวัติ เทียบกับทีมของเรา
    if (d.type === 'ISSUE') return ['เบิกสโตร์', 'ok'];
    if (d.type === 'RETURN') return ['คืนสโตร์', 'wait'];
    const back = /^POS คืน/.test(d.note || '');
    const k = d.to === team ? [back ? 'รับคืน' : 'ยืมเข้า', 'ok'] : [back ? 'คืนออก' : 'ให้ยืม', 'wait'];
    if (d.pending) return ['ขอ' + (back ? 'คืน' : 'ยืม'), 'wait'];
    if (d.status && d.status !== 'เสร็จแล้ว') return [k[0] + ' · ' + d.status, ''];
    return k;
  };
  if (tab === 'APPROVE') {
    const ib = S.loanInbox;
    if (!ib || Date.now() - ib.at > 60000) {
      if (!ib) { v.innerHTML = `${banners()}${tabs}<div class="card mut">กำลังโหลดคำขอที่รออนุมัติ…</div>`; bind(); }
      loadLoanInbox().then(() => { if (S.view === 'loan') render(); }).catch((e) => toast(e.message, true));
      if (!ib) return;
    }
    v.innerHTML = `${banners()}${tabs}
      <div class="row" style="margin-bottom:6px"><span class="mut small sp">คำขอยืม-คืนที่คุณอนุมัติได้ · ${ib.docs.length} รายการ</span><button class="btn" id="ir" style="flex:none">รีเฟรช</button></div>
      <div class="card list">${ib.docs.map((d) => `<div class="li" style="display:block">
        <div class="row"><span class="tag wait">${/^POS คืน/.test(d.note || '') ? 'ขอคืน' : 'ขอยืม'}</span><span class="sp num">${esc(d.date)}</span><b class="num">${d.total} ชิ้น</b></div>
        <div class="small" style="margin:2px 0">${esc(sName(d.from))} → ${esc(sName(d.to))}</div>
        <div class="small">${d.lines.map((l) => esc(l.name) + ' ×' + l.qty).join(', ')}</div>
        <div class="mut small">${esc(d.id)} · ขอโดย ${esc(d.by)}${d.note ? ' · ' + esc(d.note) : ''}</div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn" data-rj="${esc(d.id)}" style="flex:1">ไม่อนุมัติ</button>
          <button class="btn ok" data-ap="${esc(d.id)}" style="flex:1">อนุมัติ</button></div></div>`).join('') || '<div class="mut">ไม่มีคำขอที่รออนุมัติ</div>'}</div>
      <div class="mut small" style="margin-top:6px">ยืม: ทีมเจ้าของของเป็นผู้อนุมัติ · คืน: ทีมที่รับของคืนเป็นผู้อนุมัติ · สต็อกย้ายเมื่อกดอนุมัติ</div>`;
    bind();
    $('#ir', v).onclick = () => { S.loanInbox = null; render(); };
    const decide = async (id, ok, reason, btn) => {
      btn.disabled = true;
      try {
        const r = await api('loanDecide', { docId: id, ok, reason: reason || '' });
        toast(r.message || 'บันทึกแล้ว');
        S.loanInbox.docs = S.loanInbox.docs.filter((d) => d.id !== id);
        S.stock = {}; S.loanHist = null; renderBadge(); render();
      } catch (x) { btn.disabled = false; toast(x.message, true); }
    };
    $$('[data-ap]', v).forEach((b) => { b.onclick = () => { if (confirm('อนุมัติ ' + b.dataset.ap + ' และย้ายสต็อก?')) decide(b.dataset.ap, true, '', b); }; });
    $$('[data-rj]', v).forEach((b) => { b.onclick = () => {
      const el = sheet(`${head('ไม่อนุมัติ ' + esc(b.dataset.rj))}<label class="f">เหตุผล *</label><input class="inp" id="rjr" maxlength="200">
        <button class="btn pri block" id="rjok" style="margin-top:12px">ยืนยันไม่อนุมัติ</button>`);
      $('#rjok', el).onclick = (e) => { const r = $('#rjr', el).value.trim(); if (!r) return toast('ใส่เหตุผล', true); closeSheet(); decide(b.dataset.rj, false, r, e.target); };
    }; });
    return;
  }
  if (tab === 'HIST') {
    const h = S.loanHist && S.loanHist.team === team ? S.loanHist : null;
    if (!h) {
      v.innerHTML = `${banners()}${tabs}<div class="card mut">กำลังโหลดประวัติ…</div>`;
      bind();
      api('stockDocs', { loc: team, days: 90 }).then((j) => { S.loanHist = { team, docs: j.docs || [] }; if (S.view === 'loan') render(); })
        .catch((e) => toast(e.message, true));
      return;
    }
    v.innerHTML = `${banners()}${tabs}
      <div class="row" style="margin-bottom:6px"><span class="mut small sp">90 วันล่าสุด · ${h.docs.length} รายการ</span><button class="btn" id="hr" style="flex:none">รีเฟรช</button></div>
      <div class="card list">${h.docs.map((d) => `<div class="li" style="display:block">
        <div class="row"><span class="tag ${docKind(d)[1]}">${docKind(d)[0]}</span>
          <span class="sp num">${esc(d.date)}</span><b class="num">${d.total} ชิ้น</b></div>
        <div class="mut small">${esc(d.id)} · ${esc(sName(d.from))} → ${esc(sName(d.to))} · ${esc(d.by)}</div>
        <div class="small">${d.lines.map((l) => esc(l.name) + ' ×' + l.qty).join(', ')}</div>
        ${d.pending ? `<div class="small" style="color:var(--warn)">รออนุมัติจาก ${esc(sName(d.approverTeam))}</div>` : ''}
        ${d.note ? `<div class="mut small">${esc(d.note)}</div>` : ''}
        ${d.canCancel ? `<button class="btn" data-cx="${esc(d.id)}" style="margin-top:6px">ยกเลิกคำขอ</button>` : ''}
        ${d.canDecide ? `<button class="btn ok" data-go-ap="1" style="margin-top:6px">ไปอนุมัติ</button>` : ''}</div>`).join('') || '<div class="mut">ยังไม่มีรายการยืม-คืน</div>'}</div>`;
    bind();
    $('#hr', v).onclick = () => { S.loanHist = null; render(); };
    $$('[data-go-ap]', v).forEach((b) => { b.onclick = () => { S.loanTab = 'APPROVE'; S.loanInbox = null; render(); }; });
    $$('[data-cx]', v).forEach((b) => { b.onclick = async () => {
      if (!confirm('ยกเลิกคำขอ ' + b.dataset.cx + '?')) return;
      b.disabled = true;
      try { const r = await api('loanCancel', { docId: b.dataset.cx }); toast(r.message || 'ยกเลิกแล้ว'); S.loanHist = null; render(); }
      catch (x) { b.disabled = false; toast(x.message, true); }
    }; });
    return;
  }
  if (!other) { v.innerHTML = `${banners()}${tabs}<div class="card mut">สาขานี้ไม่มีทีมอื่นให้ยืม-คืน</div>`; bind(); return; }
  const from = tab === 'BORROW' ? other : team, to = tab === 'BORROW' ? team : other;
  // ยอดค้างคืน (ยืมจากทีมนั้น − คืนแล้ว) จากประวัติ 90 วัน
  if (tab === 'GIVEBACK' && !(S.loanHist && S.loanHist.team === team)) {
    v.innerHTML = `${banners()}${tabs}<div class="card mut">กำลังโหลดยอดค้างคืน…</div>`; bind();
    api('stockDocs', { loc: team, days: 90 }).then((j) => { S.loanHist = { team, docs: j.docs || [] }; if (S.view === 'loan') render(); }).catch((e) => toast(e.message, true));
    return;
  }
  const owe = {};
  if (tab === 'GIVEBACK') (S.loanHist.docs || []).forEach((d) => {
    if (d.type !== 'T2T' || (d.status && d.status !== 'เสร็จแล้ว')) return;
    const sign = d.from === other && d.to === team && !/^POS คืน/.test(d.note || '') ? 1 : d.from === team && d.to === other && /^POS คืน/.test(d.note || '') ? -1 : 0;
    if (sign) (d.lines || []).forEach((l) => { owe[l.name] = (owe[l.name] || 0) + sign * l.qty; });
  });
  const oweList = Object.keys(owe).filter((k) => owe[k] > 0);
  const src = S.stock[from];
  if (!src) { v.innerHTML = `${banners()}${tabs}<div class="card mut">กำลังโหลดสต็อก ${esc(sName(from))}…</div>`; bind();
    loadStock(from).then(() => { if (S.view === 'loan') render(); }).catch((e) => toast(e.message, true)); return; }
  if (S.loanKey !== tab + team + other) { S.loanKey = tab + team + other; S.loanLines = []; S.loanNote = ''; }
  const lines = S.loanLines || (S.loanLines = []);
  const have = (id) => Number(src.qty[id] || 0);
  const tot = lines.reduce((a, l) => a + l.qty, 0);
  v.innerHTML = `${banners()}${tabs}
    <div class="card" style="margin-bottom:8px"><div class="row"><span class="sp">${esc(sName(from))}</span><span class="mut">→</span><span class="sp" style="text-align:right">${esc(sName(to))}</span></div>
      <div class="mut small">${tab === 'BORROW' ? 'ยืมของจากทีม ' + esc(sName(other)) + ' เข้าทีมเรา' : 'คืนของให้ทีม ' + esc(sName(other))} · ส่งคำขอ แล้วย้ายสต็อกเมื่อผู้จัดการ/หัวหน้าทีม ${esc(sName(other))} อนุมัติ</div></div>
    ${tab === 'GIVEBACK' ? `<div class="card" style="margin-bottom:8px"><div class="row"><b class="sp" style="font-size:14px">ค้างคืนทีม ${esc(sName(other))}</b>${oweList.length ? '<button class="btn" id="lall" style="flex:none;padding:6px 12px">ใส่ทั้งหมด</button>' : ''}</div>
      <div class="small ${oweList.length ? '' : 'mut'}" style="margin-top:4px">${oweList.length ? oweList.map((k) => esc(k) + ' ×' + owe[k]).join(', ') : 'ไม่มียอดค้างคืน (ดูจากประวัติ 90 วัน)'}</div></div>` : ''}
    <div class="row" style="gap:8px;margin-bottom:6px"><button class="btn pri" id="ladd" style="flex:1">+ เพิ่มสินค้า</button>
      <button class="iconbtn" id="lscan" aria-label="สแกน"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/></svg></button></div>
    <div class="card">${lines.map((l, i) => `<div class="ln"><div class="sp"><div>${esc(sItem(l.itemId).name)}</div>
        <div class="small ${l.qty > have(l.itemId) ? '' : 'mut'}" ${l.qty > have(l.itemId) ? 'style="color:var(--warn)"' : ''}>${tab === 'BORROW' ? esc(sName(other)) + ' มี' : 'ทีมเรามี'} ${have(l.itemId)}</div></div>
        <button class="qbtn" data-m="${i}">−</button><span class="qv">${l.qty}</span><button class="qbtn" data-p="${i}">+</button>
        <button class="qbtn" data-x="${i}" aria-label="ลบ">×</button></div>`).join('') || '<div class="mut">ยังไม่มีรายการ — กด "+ เพิ่มสินค้า" หรือสแกนบาร์โค้ด</div>'}</div>
    <input class="inp" id="lnote" placeholder="หมายเหตุ (ไม่บังคับ)" maxlength="200" value="${esc(S.loanNote || '')}" style="margin-top:8px">
    <button class="btn ${tab === 'BORROW' ? 'ok' : 'pri'} block" id="lgo" style="margin-top:10px" ${tot ? '' : 'disabled'}>ส่งคำขอ${tab === 'BORROW' ? 'ยืม' : 'คืน'} ${tot} ชิ้น</button>`;
  bind();
  const addItem = (it) => keypad(`${it.name}`, `จำนวนที่${tab === 'BORROW' ? 'ยืม' : 'คืน'} · ${tab === 'BORROW' ? sName(other) + ' มี' : 'ทีมเรามี'} ${have(it.id)}`, [], (n) => {
    n = Math.round(n);
    if (!(n > 0)) return toast('กรอกจำนวน', true);
    const ex = lines.find((l) => l.itemId === it.id);
    if (ex) ex.qty += n; else lines.push({ itemId: it.id, qty: n });
    closeSheet(); render();
  });
  $('#ladd', v).onclick = () => pickStockItem(src, tab, addItem);
  const la = $('#lall', v);
  if (la) la.onclick = () => {
    const items = S.sctx.items || [];
    oweList.forEach((k) => { const it = items.find((x) => x.name === k); if (!it) return; const ex = lines.find((l) => l.itemId === it.id); if (ex) ex.qty = owe[k]; else lines.push({ itemId: it.id, qty: owe[k] }); });
    render();
  };
  $('#lscan', v).onclick = () => openScanner((code) => {
    const c = String(code).trim();
    const it = (S.sctx.items || []).find((x) => x.barcode === c || x.id === c);
    if (it) addItem(it); else toast('ไม่พบสินค้า: ' + c, true);
  });
  $$('[data-m]', v).forEach((b) => { b.onclick = () => { const l = lines[+b.dataset.m]; if (l.qty > 1) l.qty--; render(); }; });
  $$('[data-p]', v).forEach((b) => { b.onclick = () => { lines[+b.dataset.p].qty++; render(); }; });
  $$('[data-x]', v).forEach((b) => { b.onclick = () => { lines.splice(+b.dataset.x, 1); render(); }; });
  $('#lnote', v).oninput = (e) => { S.loanNote = e.target.value; };
  $('#lgo', v).onclick = () => {
    if (!navigator.onLine) return toast('ต้องต่ออินเทอร์เน็ตเพื่อยืม-คืน', true);
    const el = sheet(`${head(tab === 'BORROW' ? 'ส่งคำขอยืมสินค้า' : 'ส่งคำขอคืนสินค้า')}
      <div class="mut">${esc(sName(from))} → ${esc(sName(to))}</div>
      <div class="card" style="margin:10px 0">${lines.map((l) => `<div class="row"><span class="sp">${esc(sItem(l.itemId).name)}</span><b class="num">${l.qty}</b></div>`).join('')}</div>
      <div class="mut small" style="margin-bottom:10px">สต็อกจะย้ายเมื่อผู้จัดการหรือหัวหน้าทีม ${esc(sName(other))} กดอนุมัติ</div>
      <button class="btn ok block" id="lok">ส่งคำขอ ${tot} ชิ้น</button>`);
    $('#lok', el).onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'กำลังบันทึก…';
      try {
        const r = await api('stockMove', { type: tab, from, to, lines, note: S.loanNote || '' });
        closeSheet();
        toast(r.message || 'บันทึกแล้ว');
        S.loanLines = []; S.loanNote = ''; S.loanKey = ''; delete S.stock[from]; delete S.stock[to]; S.loanHist = null;
        render();
      } catch (x) { e.target.disabled = false; e.target.textContent = 'ส่งคำขอ ' + tot + ' ชิ้น'; toast(x.message, true); }
    };
  };
}
/* ---------- คำขอยืม-คืนที่รออนุมัติ (ตัวเลขบนเมนู) ---------- */
const loanInboxCount = () => (canStock() && S.loanInbox ? S.loanInbox.docs.length : 0);
async function loadLoanInbox() {
  const j = await api('stockDocs', { inbox: true, days: 30 });
  S.loanInbox = { docs: (j.docs || []).filter((d) => d.canDecide), at: Date.now() };
  renderBadge();
  return S.loanInbox;
}
setInterval(() => {
  if (S.session && canStock() && navigator.onLine && !document.hidden) loadLoanInbox().catch(() => {});
}, 3 * 60000);
setTimeout(() => { if (S.session && canStock() && navigator.onLine) loadLoanInbox().catch(() => {}); }, 4000);

function pickStockItem(src, tab, cb) {
  const all = (S.sctx.items || []);
  const el = sheet(`${head('เลือกสินค้า')}
    <input class="search" id="pq" placeholder="ค้นหาชื่อ / รหัส" autocomplete="off" style="margin-bottom:8px">
    <div class="list" id="pl"></div>`);
  const draw = () => {
    const q = $('#pq', el).value.trim().toLowerCase();
    const list = all.filter((i) => !q || (i.name + ' ' + i.id).toLowerCase().includes(q))
      .sort((a, b) => (Number(src.qty[b.id] || 0) > 0) - (Number(src.qty[a.id] || 0) > 0) || a.name.localeCompare(b.name, 'th')).slice(0, 80);
    $('#pl', el).innerHTML = list.map((i) => `<button class="li" data-pi="${esc(i.id)}" style="width:100%;text-align:left">
      <span class="sp">${esc(i.name)}<br><span class="mut small">${esc(i.id)}</span></span>
      <span class="num ${Number(src.qty[i.id] || 0) > 0 ? '' : 'mut'}">${tab === 'BORROW' ? 'ทีมนั้นมี' : 'ทีมเรามี'} ${Number(src.qty[i.id] || 0)}</span></button>`).join('') || '<div class="mut">ไม่พบสินค้า</div>';
    $$('[data-pi]', el).forEach((b) => { b.onclick = () => cb(all.find((x) => x.id === b.dataset.pi)); });
  };
  $('#pq', el).oninput = draw;
  draw();
}

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

/** แยกบรรทัดตามที่พิมพ์ไว้ · บรรทัดว่างตรงกลางคงไว้เป็นช่องว่าง (ตัดเฉพาะบรรทัดว่างหัว/ท้าย) */
const multiline = (s, extra) => String(s || '').replace(/^\s*\n|\n\s*$/g, '').replace(/^\s+$/, '').split(/\r?\n/)
  .filter((x, i, a) => a.length > 1 || x.trim())
  .map((x) => Object.assign({ t: 'text', s: x.trim() ? x : ' ', align: 'center' }, extra));

function receiptOps(b, stIn) {
  const st = stIn || (S.data && S.data.settings) || {};
  const ops = [];
  if (st.logo) ops.push({ t: 'img', src: st.logo, w: 0.6, maxH: 5.5, dither: true });
  ops.push({ t: 'text', s: st.shopName || 'PBD GROUP', align: 'center', bold: true, scale: 1.3 });
  ops.push(...multiline(st.address, { scale: 0.85 }));
  if (st.phone) ops.push({ t: 'text', s: 'โทร ' + st.phone, align: 'center', scale: 0.85 });
  ops.push(...multiline(st.header, { scale: 0.85 }));
  if (b.copy) ops.push({ t: 'text', s: '*** สำเนา (พิมพ์ซ้ำ ' + dt(Date.now()) + ') ***', align: 'center', bold: true, scale: 0.85 });
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
/** บิลตัวอย่างสำหรับพิมพ์ทดสอบ/ดูตัวอย่าง — ใช้สินค้าและแผนราคาจริงจากส่วนกลาง (ถ้ามี) */
function sampleBill() {
  const its = items().filter((i) => !i.hidden);
  const findPlan = (kind, skip) => {
    for (const it of its) { if (it.id === skip) continue; const p = plansOf(it).find((x) => x.kind === kind && x.total > 0); if (p) return { it, p }; }
    return null;
  };
  const c = findPlan('cash') || { it: { id: 'X1', name: 'กล้อง PBD9888LB Alexander Silver 2 เลนส์' }, p: { kind: 'cash', total: 4900, units: 1 } };
  const i = findPlan('inst', c.it.id) || findPlan('inst') || { it: { id: 'X2', name: 'ไฟโซลาร์เซลล์ PBD Nova X7' }, p: { kind: 'inst', total: 5900, down: 800, inst: 850, n: 6, units: 1 } };
  const cp = planOf(c.p), ip = planOf(i.p);
  const part = Math.max(100, Math.round(ip.down / 2 / 100) * 100);
  const lines = [
    { key: 'S1', id: c.it.id, name: c.it.name, plan: cp, stage: 'full', due: cp.total, price: cp.total, qty: 1, comment: '' },
    { key: 'S2', id: i.it.id, name: i.it.name, plan: ip, stage: ip.down > part ? 'splitDown' : 'down', due: ip.down,
      price: ip.down > part ? part : ip.down, qty: 1, comment: 'ติดตั้งหน้าบ้าน' }
  ];
  const total = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const balance = lines.reduce((a, l) => a + lineBal(l), 0);
  const cash = Math.ceil(total / 1000) * 1000;
  const d = new Date(), ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return {
    id: `${S.loc || 'LS1'}-${ymd}-TEST01`, loc: S.loc || 'LS1', createdAt: Date.now(), sellerName: user().name || 'พนักงานขาย',
    cust: { name: 'ลูกค้าตัวอย่าง ใจดี', phone: '0812345678', addr: '99/9 ม.1 ต.มะขามเตี้ย อ.เมืองสุราษฎร์ธานี จ.สุราษฎร์ธานี' },
    lines, subtotal: total, discount: 0, total, balance, method: 'cash', cash, change: cash - total, note: ''
  };
}
function testOps() {
  return [
    { t: 'text', s: '*** พิมพ์ทดสอบ ***', align: 'center', bold: true, scale: 1.2 },
    { t: 'text', s: 'ไม่ใช่ใบเสร็จจริง', align: 'center', scale: 0.85 },
    { t: 'gap', h: 0.3 },
    ...receiptOps(sampleBill()).filter((o) => !(o.t === 'gap' && o.h === 1)),
    { t: 'text', s: 'ภาษาไทย สระ ุ ู ิ ี ึ ื ่ ้ ๊ ๋ ์ ครบ', align: 'center', scale: 0.8 },
    { t: 'text', s: `กระดาษ ${S.prn.paper} mm · ${S.prn.mode || ''} · ${dt(Date.now())}`, align: 'center', scale: 0.8 },
    { t: 'text', s: '*** พิมพ์ทดสอบ ***', align: 'center', bold: true },
    { t: 'gap', h: 1 }
  ];
}

/* ---------- ESC/POS raster ---------- */
function canvasToEscPos(cv) {
  const w = cv.width, h = cv.height;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const bw = Math.ceil(w / 8), band = S.prn.slow ? 24 : 64;   // แบ่งรูปเป็นแถบเล็ก เครื่องพกพาบัฟเฟอร์น้อยจะไม่ค้าง
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
  el.textContent = !navigator.bluetooth ? 'เบราว์เซอร์นี้ไม่รองรับ Bluetooth (ใช้ Chrome บน Android หรือแชร์รูป)'
    : BLE.ch ? 'เชื่อมต่อแล้ว: ' + (BLE.dev.name || 'เครื่องพิมพ์')
    : 'ยังไม่เชื่อมต่อ' + (store.get('bleName', '') ? ' (ล่าสุด: ' + store.get('bleName', '') + ')' : '');
}
async function bleAttach(dev) {
  // Android มักต่อไม่ติดครั้งแรก ("Connection attempt failed") — ลองใหม่สูงสุด 3 ครั้ง
  let server = dev.gatt.connected ? dev.gatt : null, err;
  for (let i = 0; !server && i < 3; i++) {
    try { server = await dev.gatt.connect(); } catch (e) { err = e; await sleep(700); }
  }
  if (!server) throw new Error('ต่อเครื่องพิมพ์ ' + (dev.name || '') + ' ไม่ได้ — เปิดเครื่องพิมพ์ให้อยู่ใกล้ ปิดแอปอื่นที่ต่อเครื่องพิมพ์อยู่ แล้วปิด-เปิดเครื่องพิมพ์ใหม่' + (err ? ' (' + err.message + ')' : ''));
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
  throw new Error('ไม่พบช่องส่งข้อมูลของเครื่องพิมพ์ — เครื่องนี้อาจไม่รองรับ Bluetooth แบบ BLE (ใช้แชร์รูปแทน)');
}
/** รายการเครื่องพิมพ์ Bluetooth ที่เคยอนุญาตให้แอปนี้ใช้ (Chrome Android) */
async function bleKnown(v) {
  const box = $('#bleList', v);
  if (!box) return;
  if (!navigator.bluetooth) { box.innerHTML = '<div class="mut small">เบราว์เซอร์นี้ไม่รองรับ Bluetooth — ใช้ Chrome บน Android หรือเลือกแชร์รูป</div>'; return; }
  if (!navigator.bluetooth.getDevices) {
    box.innerHTML = `<div class="card" style="background:var(--bg);margin:0">
      <b>ให้ Chrome จำเครื่องพิมพ์ (ไม่ต้องค้นหาใหม่ทุกครั้งที่เปิดแอป)</b>
      <ol class="small" style="margin:6px 0 0 18px;padding:0;line-height:1.7">
        <li>เปิด Chrome พิมพ์ในช่องที่อยู่ <b>chrome://flags</b></li>
        <li>ค้นหา <b>Web Bluetooth new permissions backend</b></li>
        <li>เปลี่ยนเป็น <b>Enabled</b> แล้วกด <b>Relaunch</b></li>
        <li>เปิดแอปนี้ กด "ค้นหาเครื่องพิมพ์" เลือกเครื่องพิมพ์อีกครั้ง — ครั้งต่อไปจะต่อให้เอง</li>
      </ol>
      <button class="btn" id="cpFlag" style="margin-top:8px">คัดลอก chrome://flags/#enable-web-bluetooth-new-permissions-backend</button></div>`;
    const cp = $('#cpFlag', box);
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText('chrome://flags/#enable-web-bluetooth-new-permissions-backend'); toast('คัดลอกแล้ว — วางในช่องที่อยู่ของ Chrome'); }
      catch (x) { toast('คัดลอกไม่ได้ — พิมพ์ chrome://flags เอง', true); }
    };
    return;
  }
  let devs = [];
  try { devs = await navigator.bluetooth.getDevices(); } catch (x) {}
  const cur = store.get('bleName', '');
  box.innerHTML = devs.length ? devs.map((d, i) => `<div class="li"><span class="sp">${esc(d.name || 'ไม่มีชื่อ')}${d.name === cur ? ' <span class="tag ok">ใช้อยู่</span>' : ''}</span>
      <button class="btn" data-bu="${i}" style="flex:none">ใช้เครื่องนี้</button>${d.forget ? `<button class="btn" data-bf="${i}" style="flex:none">ลืม</button>` : ''}</div>`).join('')
    : '<div class="mut small">ยังไม่มี — กด "ค้นหาเครื่องพิมพ์" (Chrome จะแสดงเครื่อง Bluetooth ใกล้เคียงให้เลือก)</div>';
  $$('[data-bu]', box).forEach((b) => { b.onclick = async () => {
    try { BLE.ch = null; BLE.dev = null; await bleAttach(devs[+b.dataset.bu]); toast('เชื่อมต่อ ' + (devs[+b.dataset.bu].name || '') + ' แล้ว'); }
    catch (e) { toast('เชื่อมต่อไม่ได้: ' + e.message + ' — เปิดเครื่องพิมพ์ให้อยู่ใกล้ แล้วลองใหม่', true); }
    bleStatus(); bleKnown(v);
  }; });
  $$('[data-bf]', box).forEach((b) => { b.onclick = async () => {
    const d = devs[+b.dataset.bf];
    try { await d.forget(); } catch (x) {}
    if (d.name === cur) store.del('bleName');
    bleKnown(v);
  }; });
}
async function bleConnect() {
  if (!navigator.bluetooth) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Bluetooth — ใช้ Chrome บน Android หรือเลือกแชร์รูป');
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  await bleAttach(dev);
}
async function bleEnsure(canPick = true) {
  if (BLE.ch) return;
  if (BLE.dev) return bleAttach(BLE.dev);
  if (navigator.bluetooth && navigator.bluetooth.getDevices) {
    const name = store.get('bleName', '');
    const devs = await navigator.bluetooth.getDevices();
    const d = devs.find((x) => x.name === name) || devs[0];
    if (d) return bleAttach(d);
  }
  // เลือกเครื่องพิมพ์ใหม่ได้เฉพาะตอนผู้ใช้แตะปุ่ม (ข้อกำหนดของ Chrome)
  if (!canPick) throw new Error('ยังไม่ได้เชื่อมต่อเครื่องพิมพ์ — แตะปุ่ม "พิมพ์" เพื่อเลือกเครื่องพิมพ์');
  await bleConnect();
}
async function bleWrite(bytes) {
  await bleEnsure(false);
  const slow = !!S.prn.slow;
  const n = slow ? Math.min(S.prn.chunk || 100, 100) : (S.prn.chunk || 100);
  const pr = BLE.ch.properties;
  // โหมดส่งช้า: ใช้แบบรอตอบรับ (ไม่ทำข้อมูลหล่น) ถ้าเครื่องรองรับ + เว้นจังหวะให้หัวพิมพ์ทัน
  let noResp = pr.writeWithoutResponse && BLE.ch.writeValueWithoutResponse && !(slow && pr.write);
  const once = (part) => (noResp ? BLE.ch.writeValueWithoutResponse(part)
    : (BLE.ch.writeValueWithResponse ? BLE.ch.writeValueWithResponse(part) : BLE.ch.writeValue(part)));
  for (let i = 0; i < bytes.length; i += n) {
    const part = bytes.slice(i, i + n);
    // "GATT operation failed" มักเกิดชั่วคราวกับเครื่องพิมพ์พกพา — รอแล้วส่งก้อนเดิมซ้ำ (ต่อใหม่ถ้าหลุด) สูงสุด 4 ครั้ง
    for (let t = 0; ; t++) {
      try { await once(part); break; }
      catch (e) {
        if (t >= 3) throw new Error('ส่งข้อมูลไปเครื่องพิมพ์ไม่สำเร็จ (' + e.message + ') — ลองติ๊ก "ส่งข้อมูลช้าลง" หรือลดขนาดก้อนข้อมูลเป็น 20');
        await sleep(250 * (t + 1));
        if (BLE.dev && !BLE.dev.gatt.connected) { BLE.ch = null; await bleAttach(BLE.dev); }
        // แบบรอตอบรับล้มเหลว → สลับไปส่งแบบไม่รอตอบรับ (เว้นจังหวะนานขึ้น) ถ้าเครื่องรองรับ
        if (!noResp && BLE.ch.properties.writeWithoutResponse && BLE.ch.writeValueWithoutResponse) noResp = true;
      }
    }
    await sleep(noResp ? (slow ? 30 : 8) : (slow ? 10 : 0));
  }
}

/* ---------- print / share ---------- */
async function shareCanvas(cv, name) {
  if (NATIVE && NATIVE.shareImage) { NATIVE.shareImage(cv.toDataURL('image/png'), name); return; }
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
async function printOps(ops, local, opts = {}) {
  if (printing) return false;
  if (S.prn.mode === 'relay' && !local) return relaySend(ops);
  printing = true;
  try {
    // Bluetooth: เชื่อมต่อก่อนวาดใบเสร็จ เพื่อให้ยังอยู่ใน "การแตะ" ของผู้ใช้ (Chrome จะยอมเปิดหน้าเลือกเครื่องพิมพ์)
    if (S.prn.mode === 'ble' && !(local && S.prn.mode === 'relay')) {
      if (opts.auto) {
        try { await bleEnsure(false); }
        catch (e) { toast('รอพิมพ์: ' + e.message, true); return false; }
      } else await bleEnsure(true);
    }
    const cv = await drawDoc(ops);
    const mode = local && S.prn.mode === 'relay' ? 'share' : S.prn.mode;
    if (mode === 'none' || mode === 'share') { await shareCanvas(cv, `pbd-${Date.now()}.png`); return true; }
    if (mode === 'sys') { await printSystem(cv); return true; }
    if (mode === 'app') {
      toast('กำลังพิมพ์…');
      await nativePrint(canvasToEscPos(cv));
      toast('ส่งไปเครื่องพิมพ์แล้ว');
      return true;
    }
    const bytes = canvasToEscPos(cv);
    toast('กำลังพิมพ์…');
    await bleWrite(bytes);
    toast('ส่งไปเครื่องพิมพ์แล้ว');
    return true;
  } catch (e) {
    toast('พิมพ์ไม่ได้: ' + e.message, true);
    return false;
  } finally { printing = false; }
}
const printBill = (b) => printOps(receiptOps(b));

/* ---------- แอป PBD POS (APK): เครื่องพิมพ์ SUNMI ในตัว / Bluetooth SPP ผ่าน window.PBDNative ---------- */
const NCB = {};
window.PBDNativeCb = (id, ok, msg) => { const c = NCB[id]; if (c) { delete NCB[id]; if (ok) c.res(); else c.rej(new Error(msg || 'พิมพ์ไม่ได้')); } };
window.PBDNativeEvent = (k, v) => { if (k === 'bt' && S.view === 'settings') render(); };
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function nativePrinters() { try { return JSON.parse(NATIVE.printers()) || []; } catch (x) { return []; } }
function nativeInfo() { try { return JSON.parse(NATIVE.info()) || {}; } catch (x) { return {}; } }
function nativePrint(bytes) {
  const p = S.prn;
  if (!p.ntarget) {   // ยังไม่ได้เลือก: ใช้ SUNMI ในตัวถ้ามี
    const l = nativePrinters(), sm = l.find((x) => x.kind === 'sunmi');
    if (sm) { p.ntarget = sm.id; p.ntargetName = sm.name; savePrn(); }
  }
  if (!p.ntarget) return Promise.reject(new Error('ยังไม่ได้เลือกเครื่องพิมพ์ — ไปที่ ตั้งค่า › เครื่องพิมพ์ใบเสร็จ'));
  const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
  return new Promise((res, rej) => {
    NCB[id] = { res, rej };
    NATIVE.print(id, p.ntarget, b64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), !!p.slow);
    setTimeout(() => { if (NCB[id]) { delete NCB[id]; rej(new Error('เครื่องพิมพ์ไม่ตอบสนอง')); } }, 90000);
  });
}
function nativePrinterUi(v) {
  const p = S.prn, sel = $('#nprn', v);
  if (!sel) return;
  const fill = () => {
    const l = nativePrinters(), inf = nativeInfo();
    if (!p.ntarget) { const sm = l.find((x) => x.kind === 'sunmi'); if (sm) { p.ntarget = sm.id; p.ntargetName = sm.name; savePrn(); } }
    const has = l.some((x) => x.id === p.ntarget);
    sel.innerHTML = (l.length ? '' : '<option value="">ไม่พบเครื่องพิมพ์ — จับคู่ Bluetooth ก่อน</option>')
      + (p.ntarget && !has ? `<option value="${esc(p.ntarget)}">${esc(p.ntargetName || p.ntarget)} (ไม่พบตอนนี้)</option>` : '')
      + l.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.kind === 'bt' ? ' · Bluetooth' : ''}</option>`).join('');
    sel.value = p.ntarget || (l[0] ? l[0].id : '');
    const nb = $('#nbt', v); if (nb) nb.classList.toggle('hidden', inf.bt !== false);
  };
  sel.onchange = () => { const o = sel.options[sel.selectedIndex]; p.ntarget = sel.value; p.ntargetName = o ? o.textContent : ''; savePrn(); };
  $('#nrf', v).onclick = fill;
  $('#nbt', v).onclick = () => NATIVE.requestBluetooth();
  $('#nbs', v).onclick = () => NATIVE.openBluetoothSettings();
  fill();
  setTimeout(fill, 1200);   // บริการ SUNMI อาจเชื่อมต่อช้ากว่าหน้าเว็บเล็กน้อย
}

/** พิมพ์ผ่านระบบพิมพ์ของ Android (SUNMI มีบริการพิมพ์ของเครื่องพิมพ์ในตัวให้เลือก) — ส่งรูปใบเสร็จขนาดหน้ากระดาษจริง */
async function printSystem(cv) {
  const url = cv.toDataURL('image/png');
  let box = document.getElementById('printArea');
  if (!box) { box = document.createElement('div'); box.id = 'printArea'; document.body.appendChild(box); }
  const mm = S.prn.paper === 80 ? 80 : 58;
  let st = document.getElementById('printCss');
  if (!st) { st = document.createElement('style'); st.id = 'printCss'; document.head.appendChild(st); }
  st.textContent = `#printArea{display:none}
@media print{@page{size:${mm}mm ${Math.ceil(cv.height / cv.width * mm) + 4}mm;margin:0}
html,body{background:#fff!important;margin:0!important;padding:0!important}
body>*:not(#printArea){display:none!important}
#printArea{display:block!important}#printArea img{display:block;width:${mm}mm;height:auto}}`;
  box.innerHTML = '';
  const im = new Image();
  im.src = url;
  box.appendChild(im);
  await new Promise((r) => { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
  window.print();
  setTimeout(() => { box.innerHTML = ''; }, 1500);
}

/* ---------- ส่งงานพิมพ์ข้ามเครื่อง (iPhone/iPad → เครื่อง SUNMI/Android ที่เปิด PBD POS ค้างไว้) ---------- */
// รูปโลโก้/QR ไม่ส่งไปด้วย: ส่งเป็นชื่ออ้างอิง แล้วเครื่องรับใช้รูปจากตั้งค่าร้านของตัวเอง (ข้อมูลเล็ก ส่งเร็ว)
function packOps(ops) {
  const st = (S.data && S.data.settings) || {};
  return ops.map((o) => {
    if (o.t !== 'img') return o;
    const ref = ['logo', 'footerQr', 'payQr'].find((k) => st[k] && st[k] === o.src);
    return ref ? Object.assign({}, o, { src: '', ref }) : null;
  }).filter(Boolean);
}
function unpackOps(ops) {
  const st = (S.data && S.data.settings) || {};
  return (ops || []).map((o) => (o.t === 'img' && o.ref ? Object.assign({}, o, { src: st[o.ref] || '' }) : o)).filter((o) => o.t !== 'img' || o.src);
}
async function relaySend(ops) {
  const p = S.prn;
  if (!p.target) { toast('ยังไม่ได้เลือกเครื่องรับงานพิมพ์ — ไปที่ ตั้งค่า › เครื่องพิมพ์', true); return; }
  if (!navigator.onLine) { toast('ต้องต่ออินเทอร์เน็ตเพื่อส่งไปพิมพ์', true); return; }
  try {
    toast('กำลังส่งไปพิมพ์…');
    const r = await api('printSend', { target: p.target, loc: S.loc || '', ops: packOps(ops) });
    toast('ส่งไปพิมพ์ที่ ' + (r.name || p.targetName || 'เครื่องรับ') + ' แล้ว');
  } catch (e) { toast('ส่งไปพิมพ์ไม่ได้: ' + e.message, true); }
}
const RECV = { timer: 0, busy: false, skip: {}, auto: false, retry: 0 };
const recvName = () => S.prn.recvName || `${deviceModel()} · ${S.loc ? locName(S.loc) : ''}`;
/* ---------- คิวงานพิมพ์ (เครื่องรับ): รอพิมพ์ / พิมพ์แล้ว — เก็บในเครื่องนี้ ----------
 * งานที่รับมาเข้าคิวเป็น "รอพิมพ์" ก่อนเสมอ · กดพิมพ์สำเร็จ = "พิมพ์แล้ว" (พิมพ์ซ้ำได้)
 * กด "ไว้ทีหลัง" = ยังรอพิมพ์อยู่ในคิว · เก็บสูงสุด 60 งาน งานที่พิมพ์แล้วเกิน 3 วันลบอัตโนมัติ */
S.pq = store.get('pq', []);
S.pqf = 'all';
const pqWait = () => S.pq.filter((j) => j.status === 'wait');
function pqSave() {
  const cut = Date.now() - 3 * 864e5;
  S.pq = S.pq.filter((j) => j.status === 'wait' || (j.doneAt || j.got) > cut).slice(-60);
  if (!store.set('pq', S.pq)) {   // เต็มพื้นที่: ทิ้งข้อมูลพิมพ์ของงานที่พิมพ์แล้ว (เก็บแค่ประวัติ)
    S.pq.forEach((j) => { if (j.status === 'done') j.ops = null; });
    store.set('pq', S.pq);
  }
}
function pqForget(ids) { store.set('pqx', (store.get('pqx', []) || []).concat(ids).slice(-200)); }
function pqAdd(job) {
  const id = String(job.id || ((job.at || Date.now()) + '|' + (job.from || '')));
  if (S.pq.some((j) => j.id === id) || (store.get('pqx', []) || []).indexOf(id) >= 0) return false;   // ยกเลิกไปแล้วไม่รับซ้ำ
  S.pq.push({ id, from: job.from || '-', title: job.title || '', at: job.at || Date.now(), got: Date.now(), ops: job.ops || [], status: 'wait', n: 0 });
  pqSave();
  return true;
}
function pqRefresh() { renderBadge(); if (S.view === 'printq') render(); else renderSide(); }
const canAutoPrint = () => S.prn.mode === 'ble' || S.prn.mode === 'app';
async function pqPrint(id, auto) {
  const j = S.pq.find((x) => x.id === id);
  if (!j) return false;
  if (!j.ops || !j.ops.length) { toast('งานนี้ไม่มีข้อมูลสำหรับพิมพ์แล้ว', true); return false; }
  const ok = await printOps(unpackOps(j.ops), true, { auto: !!auto });
  if (ok !== false) { j.status = 'done'; j.doneAt = Date.now(); j.n = (j.n || 0) + 1; pqSave(); }
  pqRefresh();
  return ok !== false;
}
function recvLoop() {
  clearTimeout(RECV.timer);
  if (!S.prn.recv || !S.session) return;
  RECV.timer = setTimeout(async () => {
    if (!document.hidden && navigator.onLine && !RECV.busy) {
      RECV.busy = true;
      try {
        const j = await api('printPoll', { device: S.device, name: recvName(), loc: S.loc || '' });
        let added = 0;
        (j.jobs || []).forEach((job) => { if (pqAdd(job)) added++; });
        if (added) { pqRefresh(); showRecvJob(); }
      } catch (e) { /* ลองรอบหน้า */ }
      RECV.busy = false;
    }
    recvLoop();
  }, 4000);
}
/** งานพิมพ์ที่รับมา: โหมด Bluetooth พิมพ์ได้เอง · โหมดอื่นแตะ "พิมพ์" เอง */
async function showRecvJob() {
  if ($('#rjob') || RECV.auto) return;
  const wait = pqWait().filter((j) => !RECV.skip[j.id]);
  const job = wait[0];
  if (!job) return;
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (x) {}
  if (canAutoPrint()) {   // พิมพ์อัตโนมัติทันทีที่งานเข้าคิว (Bluetooth)
    RECV.auto = true;
    const ok = await pqPrint(job.id, true);
    RECV.auto = false;
    if (!ok) { RECV.skip[job.id] = 1; RECV.retry = setTimeout(() => { RECV.skip = {}; showRecvJob(); }, 30000); return; }   // ไม่สำเร็จ → ค้าง "รอพิมพ์" ลองใหม่ใน 30 วิ
    toast('พิมพ์งานจาก ' + job.from);
    return showRecvJob();
  }
  if (S.view === 'printq') return;   // ต้องแตะพิมพ์เอง: อยู่หน้าคิวแล้ว ไม่ต้องเด้ง
  const el = sheet(`${head('งานพิมพ์จาก ' + esc(job.from))}
    <div id="rjob" class="mut small">${job.title ? esc(job.title) + ' · ' : ''}${hm(job.at)}${wait.length > 1 ? ` · รออีก ${wait.length - 1} งาน` : ''}</div>
    <div class="receipt-prev" id="rjp"></div>
    <div class="row" style="gap:8px"><button class="btn" id="rjx" style="flex:none">ไว้ทีหลัง</button>
      <button class="btn" id="rjq" style="flex:none">ดูคิว</button>
      <button class="btn pri" id="rjok" style="flex:1">พิมพ์</button></div>`);
  drawDoc(unpackOps(job.ops)).then((cv) => { const b = $('#rjp', el); if (b) b.appendChild(cv); });
  const next = () => { closeSheet(); setTimeout(showRecvJob, 300); };
  $('#rjok', el).onclick = () => { pqPrint(job.id); next(); };
  $('#rjx', el).onclick = () => { RECV.skip[job.id] = 1; next(); };
  $('#rjq', el).onclick = () => { RECV.skip[job.id] = 1; closeSheet(); go('printq'); };
}
function renderPrintQ(v) {
  const f = S.pqf, all = S.pq.slice().sort((a, b) => b.got - a.got);
  const list = all.filter((j) => f === 'all' || j.status === f), nw = pqWait().length;
  const chip = (k, label, n) => `<button class="chip ${f === k ? 'on' : ''}" data-pf="${k}">${label}${n != null ? ' ' + n : ''}</button>`;
  v.innerHTML = `${banners()}
    <div class="row" style="margin-bottom:8px"><h3 class="sp" style="font-size:17px">คิวงานพิมพ์</h3>
      <span class="small" style="color:${S.prn.recv ? 'var(--ok)' : 'var(--mut)'}">${S.prn.recv ? '● รับงานอยู่' + (canAutoPrint() ? ' · พิมพ์อัตโนมัติ' : '') : 'ปิดรับงาน'}</span></div>
    ${S.prn.recv && !canAutoPrint() ? '<div class="banner"><span class="sp">ยังพิมพ์อัตโนมัติไม่ได้ — ต้องแตะพิมพ์ทีละงาน · เปิด "พิมพ์อัตโนมัติไม่ต้องแตะ" ที่ ตั้งค่า › เครื่องพิมพ์ใบเสร็จ</span></div>' : ''}
    <div class="chips">${chip('all', 'ทั้งหมด', all.length)}${chip('wait', 'รอพิมพ์', nw)}${chip('done', 'พิมพ์แล้ว', all.length - nw)}</div>
    ${nw > 1 && canAutoPrint() ? `<button class="btn pri block" id="pqAll" style="margin-bottom:10px">พิมพ์ที่รอทั้งหมด (${nw})</button>` : ''}
    <div class="card list">${list.length ? list.map((j) => `
      <div class="li">
        <div class="sp"><div class="num">${hm(j.at)} · ${esc(j.from)}</div>
          <div class="mut small">${j.title ? esc(j.title) + ' · ' : ''}รับเมื่อ ${dt(j.got)}${j.status === 'done' ? ' · พิมพ์ ' + hm(j.doneAt) + (j.n > 1 ? ' (' + j.n + ' ครั้ง)' : '') : ''}</div></div>
        <div style="text-align:right;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <span class="tag ${j.status === 'done' ? 'ok' : 'wait'}">${j.status === 'done' ? 'พิมพ์แล้ว' : 'รอพิมพ์'}</span>
          <div class="row" style="gap:6px">${j.status !== 'done' ? `<button class="btn" data-px="${esc(j.id)}" style="padding:6px 12px">ยกเลิก</button>` : ''}
          ${j.ops && j.ops.length ? `<button class="btn ${j.status === 'done' ? '' : 'pri'}" data-pp="${esc(j.id)}" style="padding:6px 12px">${j.status === 'done' ? 'พิมพ์ซ้ำ' : 'พิมพ์'}</button>` : ''}</div>
        </div>
      </div>`).join('') : `<div class="mut">${f === 'wait' ? 'ไม่มีงานรอพิมพ์' : 'ยังไม่มีงานพิมพ์ที่รับมา'}</div>`}</div>
    ${nw > 1 ? `<button class="btn block" id="pqXall" style="margin-top:10px">ยกเลิกงานที่รอพิมพ์ทั้งหมด (${nw})</button>` : ''}
    ${all.length - nw ? '<button class="btn block" id="pqClr" style="margin-top:10px">ล้างงานที่พิมพ์แล้ว</button>' : ''}
    ${S.prn.recv ? '' : '<div class="mut small" style="margin-top:10px">เปิดรับงานได้ที่ ตั้งค่า › เครื่องพิมพ์ใบเสร็จ › รับงานพิมพ์จากเครื่องอื่น</div>'}`;
  $$('[data-pf]', v).forEach((b) => { b.onclick = () => { S.pqf = b.dataset.pf; render(); }; });
  $$('[data-pp]', v).forEach((b) => { b.onclick = () => { b.disabled = true; pqPrint(b.dataset.pp); }; });
  const pa = $('#pqAll', v);
  if (pa) pa.onclick = async () => { pa.disabled = true; for (const j of pqWait()) { if (!(await pqPrint(j.id))) break; } };
  const pc = $('#pqClr', v);
  if (pc) pc.onclick = () => { S.pq = S.pq.filter((j) => j.status !== 'done'); pqSave(); render(); };
  $$('[data-px]', v).forEach((b) => { b.onclick = () => {
    const j = S.pq.find((x) => x.id === b.dataset.px);
    if (!confirm('ยกเลิกงานพิมพ์' + (j ? ' ' + hm(j.at) + ' · ' + j.from : '') + '?')) return;
    pqForget([b.dataset.px]); S.pq = S.pq.filter((x) => x.id !== b.dataset.px); pqSave(); renderBadge(); render(); toast('ยกเลิกงานพิมพ์แล้ว');
  }; });
  const px = $('#pqXall', v);
  if (px) px.onclick = () => {
    if (!confirm('ยกเลิกงานที่รอพิมพ์ทั้งหมด ' + nw + ' งาน?')) return;
    pqForget(pqWait().map((j) => j.id)); S.pq = S.pq.filter((j) => j.status === 'done'); pqSave(); renderBadge(); render(); toast('ยกเลิกงานที่รอพิมพ์แล้ว');
  };
}

/* ---------- boot ---------- */
function boot() {
  const pc = pairFromUrl();
  if (pc) store.set('pair', pc);
  $('#loginBtn').onclick = startLogin;
  $('#qrBtn').onclick = startQrLogin;
  $('#me').onclick = () => go('settings');
  $('#hamBtn').onclick = openSide;
  $('#sideOv').onclick = closeSide;
  $('#qrNew').onclick = startQrLogin;
  $('#teamBtn').onclick = openTeamPicker;
  $('#cartbar').onclick = openCart;
  $('#pqb').onclick = () => go('printq');
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
    recvLoop();
    if (/Line\//i.test(navigator.userAgent)) fillPicture();
  } else {
    showLogin();
    if (store.get('loginPending', 0) || /[?&](code|liff\.state)=/.test(location.search)) startLogin();
  }
}

// สำหรับทดสอบ
window.__pbdpos = { canvasToEscPos, wrapText, drawDoc, receiptOps, testOps };

boot();
})();
