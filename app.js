'use strict';
/* My Money — private finance tracker. All data lives in localStorage on this device. */
(() => {
const KEY = 'mymoney.v1';
const CATS = ['Food', 'Gas', 'Shopping/Fun', 'Car', 'Family', 'Other'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, forceCents) => {
  n = round2(n);
  const cents = forceCents || Math.abs(n % 1) > 0.004;
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
};

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a, b) => Math.round((b - a) / 864e5);
const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDateY = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const monthYear = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;

/* ---------- state ---------- */
function defaults() {
  return {
    v: 1,
    settings: { anchorPayday: iso(today()), checkBudget: 0, spendBudget: 0, theme: 'auto', pinHash: null, pinSalt: null, pinLen: 4 },
    plan: { family: 0, subs: 0, gas: 0, food: 0, car: 0, fun: 0, buffer: 0, tax: 0 },
    subs: [],
    debts: [],
    monthBudgets: {},
    payments: [],
    owed: [],
    spending: [],
    tax: { goal: 0, estLow: 0, estHigh: 0, estDate: '2027-01-15', dueDate: '2027-04-15', complete: false, tx: [] },
    paychecks: [],
    reminders: [],
    appleCare: { batteryReplaced: false, replacedDate: null, reviewed: false }
  };
}
function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    return merge(d, JSON.parse(raw));
  } catch (e) { return d; }
}
function merge(d, s) {
  const out = { ...d, ...s };
  for (const k of ['settings', 'plan', 'tax', 'appleCare']) out[k] = { ...d[k], ...(s[k] || {}) };
  return out;
}
let S = load();
let saveFailed = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); saveFailed = false; }
  catch (e) { if (!saveFailed) toast('⚠️ Could not save — storage is full or blocked'); saveFailed = true; }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const ui = { tab: 'home', homeSeg: 'overview', addSeg: 'spend', cat: 'Food', sumMonth: iso(today()).slice(0, 7), wiDebt: null, wiAmt: null, pc: null, draft: { amt: '', note: '' } };
let locked = false;

/* ---------- pay schedule ---------- */
const anchor = () => parse(S.settings.anchorPayday);
function periodStart(d) {
  const a = anchor();
  return addDays(a, Math.floor(diffDays(a, d) / 14) * 14);
}
function paydaysInMonth(y, m) {
  const a = anchor();
  let d = addDays(a, Math.ceil(diffDays(a, new Date(y, m, 1)) / 14) * 14);
  const out = [];
  while (d.getMonth() === m && d.getFullYear() === y) { out.push(d); d = addDays(d, 14); }
  return out;
}
function checkInfo(d) {
  const list = paydaysInMonth(d.getFullYear(), d.getMonth());
  const n = list.findIndex(x => iso(x) === iso(d)) + 1;
  return { n, total: list.length, kind: n === 1 ? 'family' : n >= 3 ? 'bonus' : 'regular' };
}
const KIND_LABEL = { family: 'Family-payment check', regular: 'Regular check', bonus: 'Bonus check' };
function periodBudgets(start) {
  const p = S.plan, kind = checkInfo(start).kind;
  return { Food: p.food / 2, Gas: p.gas / 2, 'Shopping/Fun': p.fun / 2, Car: p.car / 2, Family: kind === 'family' ? p.family : 0, Other: p.buffer / 2 };
}
function spentBy(fromIso, toIso) {
  const out = Object.fromEntries(CATS.map(c => [c, 0]));
  for (const s of S.spending) if (s.date >= fromIso && s.date < toIso) out[s.cat] = round2((out[s.cat] || 0) + s.amount);
  return out;
}
function catClass(spent, budget) {
  if (budget <= 0) return spent > 0 ? 'over' : '';
  const r = spent / budget;
  return r >= 1 ? 'over' : r >= 0.75 ? 'warn' : '';
}
const monthBudget = ym => (S.monthBudgets || {})[ym] ?? (S.settings.spendBudget || 0);
function currentPeriod() {
  const t = today(), s = periodStart(t), e = addDays(s, 14);
  const m = iso(t).slice(0, 7);
  const budget = monthBudget(m);
  const used = round2(S.spending.filter(x => x.date.startsWith(m) && x.cat !== 'Family').reduce((a, x) => a + x.amount, 0));
  return { start: s, end: e, budget, used, left: budget - used, daysToPay: diffDays(t, e), kind: checkInfo(s).kind, nextKind: checkInfo(e).kind };
}

/* ---------- debts & projections ---------- */
const debt = id => S.debts.find(d => d.id === id);
const openDebts = () => S.debts.filter(d => d.balance > 0.005);
const taxDone = () => S.tax.complete || iso(today()) > S.tax.dueDate;
function taxFreeAt(date) {
  if (S.tax.complete) return true;
  const due = parse(S.tax.dueDate);
  return date >= new Date(due.getFullYear(), due.getMonth() + 1, 1);
}
const planned = (d, date) => d.payment + (d.redirectTax && taxFreeAt(date) ? S.plan.tax : 0);
function aprAt(d, date) {
  if (d.promoEnd && date <= parse(d.promoEnd)) return d.apr;
  return d.promoEnd ? (d.postApr ?? d.apr) : d.apr;
}
const monthlyInterest = d => round2(d.balance * aprAt(d, today()) / 100 / 12);
function paidThisMonth(id) {
  const m = iso(today()).slice(0, 7);
  return S.payments.filter(p => p.debtId === id && p.type === 'pay' && p.date.startsWith(m)).reduce((a, p) => a + p.amount, 0);
}
/* Month-by-month snowball: every debt gets its planned payment; money freed by paid-off debts rolls to the next debt in order. */
function simulate(over = {}) {
  const t = today();
  const ds = S.debts.map(d => ({ d, bal: d.balance, interest: 0, paidOn: d.balance <= 0.005 ? t : null }));
  for (let m = 0; m <= 720; m++) {
    if (ds.every(x => x.bal <= 0.005)) break;
    const date = new Date(t.getFullYear(), t.getMonth() + m, 1);
    if (m > 0) for (const x of ds) if (x.bal > 0.005) { const i = x.bal * aprAt(x.d, date) / 100 / 12; x.bal += i; x.interest += i; }
    const plan = x => {
      let p = over[x.d.id] != null ? over[x.d.id] + (x.d.redirectTax && taxFreeAt(date) ? S.plan.tax : 0) : planned(x.d, date);
      if (m === 0) p = Math.max(0, p - paidThisMonth(x.d.id));
      return p;
    };
    let pool = ds.reduce((a, x) => a + plan(x), 0);
    for (const x of ds) if (x.bal > 0.005) { const p = Math.min(plan(x), x.bal); x.bal -= p; pool -= p; }
    for (const x of ds) if (x.bal > 0.005 && pool > 0.005) { const p = Math.min(pool, x.bal); x.bal -= p; pool -= p; }
    for (const x of ds) if (x.bal <= 0.005 && !x.paidOn) { x.paidOn = date; x.bal = 0; }
  }
  const by = {};
  for (const x of ds) by[x.d.id] = { paidOn: x.paidOn, interest: round2(x.interest) };
  const all = ds.every(x => x.paidOn);
  return { by, free: all ? ds.reduce((a, x) => x.paidOn > a ? x.paidOn : a, t) : null, totalInterest: round2(ds.reduce((a, x) => a + x.interest, 0)) };
}
function addDebtEntry(debtId, type, amount, date, note) {
  const d = debt(debtId); if (!d) return null;
  const want = type === 'pay' ? -amount : amount;
  const nb = Math.max(0, round2(d.balance + want));
  const e = { id: uid(), debtId, type, amount, delta: round2(nb - d.balance), date, note: note || '' };
  d.balance = nb; S.payments.push(e);
  return e.id;
}
function removeDebtEntry(id) {
  const i = S.payments.findIndex(p => p.id === id); if (i < 0) return;
  const e = S.payments[i], d = debt(e.debtId);
  if (d) d.balance = round2(d.balance - e.delta);
  S.payments.splice(i, 1);
}
const taxBalance = () => round2(S.tax.tx.reduce((a, t) => a + (t.type === 'deposit' ? t.amount : -t.amount), 0));
function addTaxTx(type, amount, date, note) { const id = uid(); S.tax.tx.push({ id, type, amount, date, note: note || '' }); return id; }

/* ---------- reminders ---------- */
function nextCharge(day, from) {
  const dim = (y, m) => new Date(y, m + 1, 0).getDate();
  let d = new Date(from.getFullYear(), from.getMonth(), Math.min(day, dim(from.getFullYear(), from.getMonth())));
  if (d < from) d = new Date(from.getFullYear(), from.getMonth() + 1, Math.min(day, dim(from.getFullYear(), from.getMonth() + 1)));
  return d;
}
function reminders() {
  const t = today(), out = [];
  const add = (o) => out.push({ date: null, ...o });
  const ac = S.subs.find(s => /applecare/i.test(s.name));
  if (!S.appleCare.batteryReplaced) add({ id: 'ac', icon: '🔋', title: 'Keep AppleCare until the battery is replaced', detail: `Then review cancelling it${ac ? ` (${money(ac.amount)}/mo)` : ''}.`, action: ['appleBattery', 'Battery replaced'] });
  else if (!S.appleCare.reviewed) add({ id: 'ac', icon: '🔋', date: S.appleCare.replacedDate ? parse(S.appleCare.replacedDate) : t, title: 'Review / cancel AppleCare', detail: 'Battery is replaced — decide whether to keep paying.', action: ['appleReviewed', 'Done'] });
  add({ id: 'est', icon: '🧾', date: parse(S.tax.estDate), title: 'Estimated tax payment due', detail: `Fund: ${money(taxBalance())} of ${money(S.tax.goal)}` });
  add({ id: 'due', icon: '🏛️', date: parse(S.tax.dueDate), title: 'Tax day', detail: `Estimated owed ${money(S.tax.estLow)}–${money(S.tax.estHigh)}` });
  for (const d of S.debts) if (d.promoEnd && d.balance > 0) add({ id: 'promo' + d.id, icon: '⏳', date: parse(d.promoEnd), title: `${d.name} 0% promo ends`, detail: `Balance ${money(d.balance)} — pay it off before this date.` });
  for (const s of S.subs) {
    const d = nextCharge(s.day, t), n = diffDays(t, d);
    if (n <= 30) add({ id: 'sub' + s.id, icon: '🔁', date: d, title: `${s.name} — ${money(s.amount, true)}`, detail: s.business ? 'Subscription · business expense' : 'Subscription' });
  }
  let c = 0;
  for (let i = 0; i <= 12 && c < 2; i++) {
    const pd = addDays(periodStart(t), 14 * i);
    if (pd >= t && checkInfo(pd).kind === 'bonus') { add({ id: 'bonus' + iso(pd), icon: '💸', date: pd, title: 'Bonus check (3rd paycheck)', detail: 'Send it to debt.' }); c++; }
  }
  for (const r of S.reminders) if (!r.done) add({ id: r.id, custom: true, icon: '🔔', date: parse(r.date), title: r.title, detail: r.note || '' });
  return out.sort((a, b) => (a.date ? a.date.getTime() : -Infinity) - (b.date ? b.date.getTime() : -Infinity)).filter(r => !r.date || diffDays(t, r.date) > -8);
}

/* ---------- ui helpers ---------- */
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}
const bar = (ratio, cls = '') => `<div class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(1, ratio)) * 100}%"></i></div>`;
const seg = (key, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-act="seg" data-key="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;
const item = (t, s, v, act, id = '', extra = '') => `<button class="item" data-act="${act}" data-id="${esc(id)}" ${extra}><div class="grow"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>${v ? `<div class="v">${v}</div>` : ''}</button>`;
const dateChip = d => `<div class="date"><small>${d.toLocaleDateString('en-US', { month: 'short' })}</small><b>${d.getDate()}</b></div>`;

function ask(msg, ok = 'Yes', danger = true) {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'overlay'; el.style.zIndex = 70;
    el.innerHTML = `<div class="sheet"><div class="grab"></div><p style="font-size:17px;white-space:pre-line">${esc(msg)}</p><div class="btns"><button class="btn" data-n>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-y>${esc(ok)}</button></div></div>`;
    document.body.appendChild(el);
    const done = v => { el.remove(); res(v); };
    el.onclick = e => { if (e.target === el || e.target.closest('[data-n]')) done(false); else if (e.target.closest('[data-y]')) done(true); };
  });
}
function fieldHTML(f) {
  const v = f.value ?? '';
  if (f.type === 'checkbox') return `<label class="f chk"><input type="checkbox" name="${f.k}" ${f.value ? 'checked' : ''}><span>${f.label}</span></label>`;
  if (f.type === 'select') return `<label class="f"><span>${f.label}</span><select name="${f.k}">${f.options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  if (f.type === 'number') return `<label class="f"><span>${f.label}</span><input name="${f.k}" type="number" inputmode="decimal" step="any" value="${esc(v)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}></label>`;
  if (f.type === 'pin') return `<label class="f"><span>${f.label}</span><input name="${f.k}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>`;
  return `<label class="f"><span>${f.label}</span><input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}></label>`;
}
function openForm({ title, fields, submit = 'Save', onSubmit, onDelete, note }) {
  const el = document.createElement('div'); el.className = 'overlay';
  el.innerHTML = `<form class="sheet" novalidate><div class="grab"></div><h2>${esc(title)}</h2>${note ? `<p class="muted small">${note}</p>` : ''}${fields.map(fieldHTML).join('')}
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${esc(submit)}</button></div>
    ${onDelete ? '<div class="btns"><button type="button" class="btn danger" data-del>Delete</button></div>' : ''}</form>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  if (onDelete) $('[data-del]', el).onclick = async () => { if (await ask('Delete this?', 'Delete')) { close(); onDelete(); } };
  $('form', el).onsubmit = ev => {
    ev.preventDefault();
    const vals = {}; let bad = false;
    for (const f of fields) {
      const inp = $(`[name="${f.k}"]`, el);
      let v = f.type === 'checkbox' ? inp.checked : inp.value.trim();
      if (f.type === 'number') v = v === '' ? null : parseFloat(v);
      if (f.req && (v === '' || v === null || Number.isNaN(v))) { inp.classList.add('err'); bad = true; }
      if (f.type === 'date' && v === '') v = null;
      vals[f.k] = v;
    }
    if (bad) return;
    Promise.resolve(onSubmit(vals)).then(r => { if (r !== false) close(); });
  };
  const first = $('input:not([type=checkbox]),select', el); if (first && matchMedia('(pointer:fine)').matches) first.focus();
}
const commit = (msg) => { save(); render(); if (msg) toast(msg); };

/* ---------- views ---------- */
function viewHome() {
  const body = ui.homeSeg === 'overview' ? homeOverview() : ui.homeSeg === 'reminders' ? remindersView() : summaryView();
  return `<h1>Home</h1>` + seg('homeSeg', [['overview', 'Overview'], ['reminders', 'Reminders'], ['summary', 'Summary']], ui.homeSeg) + body;
}
function homeOverview() {
  const P = currentPeriod(), sim = simulate();
  const totalDebt = S.debts.reduce((a, d) => a + d.balance, 0);
  const cap = S.debts[0], capSim = cap && sim.by[cap.id];
  const bal = taxBalance(), goal = S.tax.goal;
  const owed = S.owed.filter(o => !o.received);
  const rem = reminders().slice(0, 3);
  const cls = catClass(P.used, P.budget);
  const nextBadge = P.nextKind === 'bonus' ? '<span class="badge good">Bonus check → debt</span>' : P.nextKind === 'family' ? '<span class="badge">Family check</span>' : '';
  return `
  <div class="card">
    <div class="flex between"><span class="muted small">Spending money left this month</span>${nextBadge}</div>
    <div class="big ${P.left < 0 ? 'overc' : ''}">${money(P.left)}</div>
    ${bar(P.budget ? P.used / P.budget : 0, cls)}
    <div class="flex between small muted"><span>${money(P.used)} of ${money(P.budget)} spent</span><span>${new Date().toLocaleDateString('en-US', { month: 'long' })}</span></div>
    <div class="gap"></div>
    <div class="flex between"><span><b>${P.daysToPay}</b> day${P.daysToPay === 1 ? '' : 's'} until payday</span><span class="muted small">${fmtDate(P.end)}</span></div>
  </div>
  <div class="card">
    <div class="muted small">Total debt remaining</div>
    <div class="big">${money(totalDebt)}</div>
    ${sim.free ? `<div class="small muted">Debt-free ${monthYear(sim.free)} at your current plan</div>` : '<div class="small overc">Payments don’t cover interest — raise a payment</div>'}
    ${cap ? `<div class="gap"></div><div class="flex between"><b>${esc(cap.name)}</b><span>${money(cap.balance)}</span></div>
      ${bar(cap.startBalance ? 1 - cap.balance / cap.startBalance : 0)}
      <div class="flex between small muted"><span>${Math.max(0, Math.round((1 - cap.balance / (cap.startBalance || 1)) * 100))}% paid</span><span>${cap.balance <= 0 ? 'Paid off 🎉' : capSim && capSim.paidOn ? 'Payoff ' + monthYear(capSim.paidOn) : 'No payoff date'}</span></div>` : ''}
    ${owed.length ? `<div class="gap"></div><span class="badge good">Owed to me: ${owed.map(o => o.low === o.high ? money(o.low) : money(o.low) + '–' + money(o.high)).join(' + ')}</span>` : ''}
  </div>
  <div class="card">
    <div class="flex between"><span class="muted small">Tax fund</span><span class="badge ${S.tax.complete ? 'good' : ''}">${S.tax.complete ? 'Complete' : 'Due ' + fmtDate(parse(S.tax.dueDate))}</span></div>
    <div class="mid">${money(bal)} <span class="muted small" style="font-weight:500">of ${money(goal)}</span></div>
    ${bar(goal ? bal / goal : 0)}
    <div class="small muted">${bal >= goal ? 'Goal reached' : money(goal - bal) + ' to go'}</div>
  </div>
  ${rem.length ? `<h2>Next up</h2><div class="list">${rem.map(remRow).join('')}</div>` : ''}`;
}
function remRow(r) {
  const n = r.date ? diffDays(today(), r.date) : null;
  const when = r.date ? `<div class="small ${n < 0 ? 'overc' : n <= 7 ? 'warnc' : 'muted'}" style="font-weight:600">${inDays(n)}</div>` : '';
  return `<div class="item">${r.date ? dateChip(r.date) : `<div class="date"><b>${r.icon}</b></div>`}<div class="grow"><div class="t">${esc(r.title)}</div>${r.detail ? `<div class="s">${esc(r.detail)}</div>` : ''}${when}
    ${r.action ? `<button class="btn sm primary" style="margin-top:8px" data-act="${r.action[0]}">${r.action[1]}</button>` : ''}
    ${r.custom ? `<div class="flex" style="margin-top:8px"><button class="btn sm" data-act="remDone" data-id="${r.id}">Done</button><button class="btn sm ghost" data-act="remEdit" data-id="${r.id}">Edit</button></div>` : ''}</div></div>`;
}
function remindersView() {
  const list = reminders();
  return `<div class="list">${list.length ? list.map(remRow).join('') : '<div class="empty">Nothing coming up.</div>'}</div>
  <button class="btn block" data-act="remAdd">+ Add reminder</button>`;
}
function summaryView() {
  const [y, m] = ui.sumMonth.split('-').map(Number);
  const f = `${y}-${pad(m)}-01`, to = iso(new Date(y, m, 1)), p = S.plan;
  const spent = spentBy(f, to);
  const planMap = { Food: p.food, Gas: p.gas, 'Shopping/Fun': p.fun, Car: p.car, Family: p.family, Other: p.buffer };
  const totPlan = CATS.reduce((a, c) => a + planMap[c], 0), totAct = CATS.reduce((a, c) => a + spent[c], 0);
  const mdate = new Date(y, m - 1, 1);
  const debtPlan = S.debts.reduce((a, d) => a + planned(d, mdate), 0);
  const debtAct = S.payments.filter(x => x.type === 'pay' && x.date >= f && x.date < to).reduce((a, x) => a + x.amount, 0);
  const savePlan = taxFreeAt(mdate) ? 0 : p.tax;
  const saveAct = S.tax.tx.filter(x => x.date >= f && x.date < to).reduce((a, x) => a + (x.type === 'deposit' ? x.amount : -x.amount), 0);
  const income = S.paychecks.filter(x => x.date >= f && x.date < to);
  const incTot = income.reduce((a, x) => a + x.amount, 0);
  const row = (n, pl, ac) => { const c = catClass(ac, pl); return `<tr><td>${n}</td><td>${money(pl)}</td><td class="${c === 'over' ? 'overc' : c === 'warn' ? 'warnc' : ''}">${money(ac)}</td></tr>`; };
  return `<div class="flex between" style="margin-bottom:10px"><button class="btn sm" data-act="sumPrev">‹</button><b>${mdate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b><button class="btn sm" data-act="sumNext">›</button></div>
  <div class="card"><table class="sum"><tr><th></th><th>Planned</th><th>Actual</th></tr>
    ${CATS.map(c => row(c === 'Other' ? 'Other (buffer)' : c, planMap[c], spent[c])).join('')}
    <tr><td>Subscriptions</td><td>${money(p.subs)}</td><td class="muted">auto</td></tr>
    <tr class="tot"><td>Spending</td><td>${money(totPlan + p.subs)}</td><td>${money(totAct)}</td></tr></table></div>
  <div class="card"><table class="sum"><tr><th></th><th>Planned</th><th>Actual</th></tr>
    <tr><td>To debt</td><td>${money(debtPlan)}</td><td class="${debtAct >= debtPlan ? 'ok' : ''}">${money(debtAct)}</td></tr>
    <tr><td>To savings (tax)</td><td>${money(savePlan)}</td><td class="${saveAct >= savePlan ? 'ok' : ''}">${money(saveAct)}</td></tr></table>
    <p class="small muted" style="margin-top:10px">Paychecks logged: ${income.length} · ${money(incTot)}${income.some(i => i.kind === 'bonus') ? ' · includes a bonus check' : ''}</p></div>`;
}

function viewAdd() {
  return `<h1>Add</h1>` + seg('addSeg', [['spend', 'Spending'], ['paycheck', 'Paycheck']], ui.addSeg) + (ui.addSeg === 'spend' ? addSpend() : addPaycheck());
}
function addSpend() {
  const P = currentPeriod();
  const recent = [...S.spending].reverse().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const cls = catClass(P.used, P.budget);
  return `<div class="card"><div class="flex between"><div class="muted small">Spending money left this month</div><button class="btn sm" data-act="setBudget">Set amount</button></div><div class="mid ${cls === 'over' ? 'overc' : cls === 'warn' ? 'warnc' : ''}">${money(P.left)} <span class="muted small" style="font-weight:500">of ${money(P.budget)}</span></div>${bar(P.budget ? P.used / P.budget : 0, cls)}</div>
  <div class="card">
    <input id="amt" class="amt" type="number" inputmode="decimal" step="any" placeholder="$0" value="${esc(ui.draft.amt)}" data-live="draft">
    <div class="chips">${CATS.map(c => `<button class="chip ${c === ui.cat ? 'on' : ''}" data-act="cat" data-val="${c}">${c}</button>`).join('')}</div>
    <label class="f"><span>Note</span><input id="note" type="text" placeholder="optional" value="${esc(ui.draft.note)}" data-live="draft"></label>
    <label class="f"><span>Date</span><input id="sdate" type="date" value="${iso(today())}"></label>
    <button class="btn primary block" data-act="addSpend">Add spending</button></div>
  <h2>Recent</h2><div class="list">${recent.length ? recent.map(s => item(`${esc(s.cat)}${s.note ? ' · ' + esc(s.note) : ''}`, fmtDate(parse(s.date)), money(s.amount, true), 'editSpend', s.id)).join('') : '<div class="empty">No spending logged yet.</div>'}</div>`;
}

function buildTemplate(kind) {
  const p = S.plan, open = openDebts(), target = open[0], half = x => round2(x / 2), b = [];
  const add = (key, label, amount, type = 'spend', extra = {}) => b.push({ key, label, amount: round2(amount), type, ...extra });
  if (kind === 'family') add('family', 'Family contribution', p.family);
  add('gas', 'Gas', half(p.gas)); add('food', 'Food', half(p.food));
  if (kind === 'regular') { add('subs', 'Subscriptions', p.subs); add('car', 'Car maintenance fund', p.car); add('fun', 'Shopping / fun', p.fun); add('buffer', 'Buffer', p.buffer); }
  if (kind !== 'bonus' && !taxDone()) add('tax', 'Tax fund', half(p.tax), 'tax');
  if (kind === 'family') for (const d of open) if (d !== target && d.payment > 0) add('min_' + d.id, `${d.name} payment`, d.payment, 'debt', { debtId: d.id });
  add('rem', target ? `${target.name} (remainder)` : 'Left over', 0, 'rem', { debtId: target ? target.id : null });
  return b;
}
function pcInit() {
  const t = today(), ps = periodStart(t), pe = addDays(ps, 14);
  const near = diffDays(t, ps) <= diffDays(t, pe) ? ps : pe;
  const kind = checkInfo(near).kind;
  ui.pc = { date: iso(near), amount: S.settings.checkBudget, kind, buckets: buildTemplate(kind), log: true };
}
const pcRemainder = () => round2(ui.pc.amount - ui.pc.buckets.filter(b => b.type !== 'rem').reduce((a, b) => a + b.amount, 0));
function addPaycheck() {
  if (!ui.pc) pcInit();
  const pc = ui.pc, rem = pcRemainder();
  const info = checkInfo(parse(pc.date));
  const recent = [...S.paychecks].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return `<div class="card">
    <label class="f"><span>Paycheck amount</span><input id="pcamt" class="amt" type="number" inputmode="decimal" step="any" value="${pc.amount}" data-live="pcamt"></label>
    <div class="small muted" style="margin:-6px 0 10px">Anything above your budgeted ${money(S.settings.checkBudget)} flows to debt.</div>
    <div class="flex"><label class="f grow" style="margin:0"><span>Date</span><input id="pcdate" type="date" value="${pc.date}"></label>
    <label class="f grow" style="margin:0"><span>Template</span><select id="pckind">${['family', 'regular', 'bonus'].map(k => `<option value="${k}" ${k === pc.kind ? 'selected' : ''}>${k === 'family' ? 'Family-payment check' : k === 'regular' ? 'Regular check' : 'Bonus check'}</option>`).join('')}</select></label></div>
    ${info.kind === 'bonus' ? '<div class="note good" style="margin-top:12px">This is the 3rd paycheck this month — a bonus check. Send it to debt.</div>' : ''}
  </div>
  <div class="card"><h3>Where it goes</h3><div class="small muted" style="margin-bottom:6px">Tap an amount to tweak before saving.</div>
    ${pc.buckets.map((b, i) => b.type === 'rem'
      ? `<div class="alloc rem"><label>${esc(b.label)}</label><span class="remv ${rem < 0 ? 'overc' : 'ok'}" id="remv">${money(rem)}</span></div>`
      : `<div class="alloc"><label for="b${i}">${esc(b.label)}</label><input id="b${i}" type="number" inputmode="decimal" step="any" value="${b.amount}" data-live="bucket" data-i="${i}"></div>`).join('')}
    <p class="small overc" id="remwarn" ${rem < 0 ? '' : 'hidden'}>Buckets add up to more than the paycheck.</p>
    <label class="f chk" style="margin-top:12px"><input type="checkbox" id="pclog" ${pc.log ? 'checked' : ''}><span>Also log debt payments &amp; tax deposit</span></label>
    <button class="btn primary block" data-act="savePc">Save paycheck</button></div>
  ${recent.length ? `<h2>Saved paychecks</h2><div class="list">${recent.map(p => item(`${fmtDate(parse(p.date))} · ${KIND_LABEL[p.kind] || 'Paycheck'}`, p.allocations.filter(a => a.type === 'rem' || a.type === 'tax').map(a => `${a.label.replace(' (remainder)', '')} ${money(a.amount)}`).join(' · '), money(p.amount), 'viewPc', p.id)).join('')}</div>` : ''}`;
}

function viewDebts() {
  const sim = simulate(), total = S.debts.reduce((a, d) => a + d.balance, 0);
  const owed = S.owed;
  if (!ui.wiDebt || !debt(ui.wiDebt)) ui.wiDebt = (openDebts()[0] || S.debts[0] || {}).id;
  const wd = debt(ui.wiDebt);
  const cur = wd ? wd.payment : 0;
  if (ui.wiAmt == null) ui.wiAmt = cur;
  const max = Math.max(3000, Math.ceil(cur * 2 / 250) * 250);
  return `<h1>Debts</h1>
  <div class="card"><div class="muted small">Total remaining</div><div class="big">${money(total)}</div>
    <div class="small muted">${sim.free ? `Debt-free ${monthYear(sim.free)} · ${money(sim.totalInterest)} total interest` : 'Not paid off at current payments'}</div></div>
  ${S.debts.map((d, i) => {
    const r = sim.by[d.id], pay = planned(d, today());
    const ontrack = d.promoEnd && r.paidOn ? r.paidOn <= parse(d.promoEnd) : null;
    return `<div class="card">
      <div class="flex between"><h3>${i + 1}. ${esc(d.name)}</h3><button class="btn sm ghost" data-act="editDebt" data-id="${d.id}">Edit</button></div>
      <div class="mid">${money(d.balance, true)}</div>
      ${bar(d.startBalance ? 1 - d.balance / d.startBalance : 0)}
      <div class="small muted">APR ${aprAt(d, today())}%${d.promoEnd ? ` until ${fmtDateY(parse(d.promoEnd))} (then ${d.postApr ?? d.apr}%)` : ''} · interest ≈ <b>${money(monthlyInterest(d), true)}</b>/mo</div>
      <div class="small muted">Plan: ${money(pay)}/mo${d.payment === 0 ? ' — set your minimum in Edit' : ''}${d.redirectTax && pay > d.payment ? ' (includes freed tax money)' : ''}</div>
      <div class="small" style="margin-top:4px">${d.balance <= 0 ? '<span class="ok"><b>Paid off 🎉</b></span>' : r.paidOn ? `Payoff <b>${monthYear(r.paidOn)}</b> · ${money(r.interest)} interest` : '<span class="overc">Never at this payment</span>'}
        ${ontrack === true ? '<span class="badge good">before promo ends</span>' : ontrack === false ? '<span class="badge bad">after promo ends!</span>' : ''}</div>
      <div class="btns"><button class="btn primary" data-act="logPay" data-id="${d.id}">Log payment</button><button class="btn" data-act="debtMore" data-id="${d.id}">More…</button></div></div>`;
  }).join('')}
  <button class="btn block" data-act="addDebt">+ Add debt</button>
  <h2>Owed to me</h2>
  <div class="list">${owed.length ? owed.map(o => item(esc(o.from), o.received ? 'Received & applied' : 'Tap when you get it — applies to ' + esc((openDebts()[0] || {}).name || 'debt'), o.received ? '✓ ' + money(o.amount || 0) : (o.low === o.high ? money(o.low) : money(o.low) + '–' + money(o.high)), 'owedItem', o.id)).join('') : '<div class="empty">Nothing owed to you.</div>'}</div>
  <button class="btn block" data-act="addOwed">+ Add expected money</button>
  <h2>What if I pay more?</h2>
  <div class="card">
    <label class="f"><span>Debt</span><select id="wiDebt">${S.debts.map(d => `<option value="${d.id}" ${d.id === ui.wiDebt ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <div class="flex between"><span class="muted small">Monthly payment (base)</span><span class="mid" id="wiVal">${money(ui.wiAmt)}</span></div>
    <input type="range" id="wiRange" min="0" max="${max}" step="25" value="${Math.min(ui.wiAmt, max)}" data-live="wi">
    <div id="wiOut">${whatIfOut()}</div></div>
  <h2>Payment history</h2>
  <div class="list">${S.payments.length ? [...S.payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15).map(p => { const d = debt(p.debtId); return item(`${esc(d ? d.name : 'Debt')} · ${p.type === 'pay' ? 'Payment' : p.type === 'interest' ? 'Interest' : 'Adjustment'}${p.note ? ' · ' + esc(p.note) : ''}`, fmtDate(parse(p.date)), (p.type === 'pay' ? '−' : '+') + money(Math.abs(p.amount), true), 'delPay', p.id); }).join('') : '<div class="empty">No payments logged yet.</div>'}</div>`;
}
function whatIfOut() {
  const d = debt(ui.wiDebt); if (!d) return '';
  const base = simulate(), alt = simulate({ [d.id]: ui.wiAmt });
  const a = base.by[d.id], b = alt.by[d.id];
  const line = r => r.paidOn ? `${monthYear(r.paidOn)} · ${money(r.interest)} interest` : 'Never paid off';
  const saved = round2(base.totalInterest - alt.totalInterest);
  let delta = '';
  if (alt.free && base.free) {
    const months = (base.free.getFullYear() - alt.free.getFullYear()) * 12 + base.free.getMonth() - alt.free.getMonth();
    delta = `<div class="note good" style="margin:10px 0 0">Debt-free ${monthYear(alt.free)}${months ? ` — ${Math.abs(months)} month${Math.abs(months) === 1 ? '' : 's'} ${months > 0 ? 'sooner' : 'later'}` : ''}${saved ? `, ${saved > 0 ? 'saves' : 'costs'} ${money(Math.abs(saved))} in interest` : ''}.</div>`;
  } else if (!alt.free) delta = '<div class="note" style="margin:10px 0 0">At this payment the debts never get paid off.</div>';
  return `<table class="sum" style="margin-top:6px"><tr><th></th><th>Current plan</th><th>What-if</th></tr>
    <tr><td>${esc(d.name)}</td><td style="font-size:13px">${line(a)}</td><td style="font-size:13px">${line(b)}</td></tr></table>${delta}`;
}

function viewTaxes() {
  const t = S.tax, bal = taxBalance(), t0 = today();
  const estD = parse(t.estDate), dueD = parse(t.dueDate);
  // projection: per-paycheck deposits until tax day
  let proj = bal, pd = addDays(periodStart(t0), 14);
  if (!t.complete) for (let i = 0; pd <= dueD && i < 60; i++, pd = addDays(pd, 14)) if (checkInfo(pd).kind !== 'bonus') proj += S.plan.tax / 2;
  const short = t.goal - proj;
  const tx = [...t.tx].sort((a, b) => b.date.localeCompare(a.date));
  return `<h1>Taxes</h1>
  <div class="card"><div class="flex between"><span class="muted small">Tax fund</span>${t.complete ? '<span class="badge good">Complete</span>' : ''}</div>
    <div class="big">${money(bal)}</div>${bar(t.goal ? bal / t.goal : 0)}
    <div class="flex between small muted"><span>Goal ${money(t.goal)}</span><span>${bal >= t.goal ? 'Goal reached' : money(t.goal - bal) + ' to go'}</span></div>
    <div class="small muted" style="margin-top:6px">Estimated owed: ${money(t.estLow)}–${money(t.estHigh)} (2026 1099 income)</div>
    ${t.complete ? `<div class="note good" style="margin-top:10px">Fund marked complete — the ${money(S.plan.tax)}/month is going to ${esc((openDebts()[0] || {}).name || 'debt')}.</div>`
      : `<div class="small" style="margin-top:6px">Projected by tax day: <b>${money(proj)}</b> ${short > 0 ? `<span class="warnc">(${money(short)} short of goal — bonus checks can fill the gap)</span>` : '<span class="ok">(goal met)</span>'}</div>`}
    <div class="btns"><button class="btn primary" data-act="taxDep">Deposit</button><button class="btn" data-act="taxWd">Withdraw</button></div>
    <div class="btns"><button class="btn ghost" data-act="taxOwed">${t.complete ? 'Reopen / update amount owed' : 'Actual owed is lower? Mark complete'}</button></div></div>
  <h2>Deadlines</h2>
  <div class="list">
    <div class="item">${dateChip(estD)}<div class="grow"><div class="t">Estimated tax payment</div><div class="s">${inDays(diffDays(t0, estD))}</div></div></div>
    <div class="item">${dateChip(dueD)}<div class="grow"><div class="t">Tax day</div><div class="s">${inDays(diffDays(t0, dueD))}</div></div></div></div>
  <h2>History</h2>
  <div class="list">${tx.map(x => item(`${x.type === 'deposit' ? 'Deposit' : 'Withdrawal'}${x.note ? ' · ' + esc(x.note) : ''}`, fmtDate(parse(x.date)), `<span class="${x.type === 'deposit' ? 'ok' : 'overc'}">${x.type === 'deposit' ? '+' : '−'}${money(x.amount, true)}</span>`, 'delTax', x.id)).join('') || '<div class="empty">No transactions.</div>'}</div>`;
}

function viewSettings() {
  const p = S.plan, subsTot = S.subs.reduce((a, s) => a + s.amount, 0), biz = S.subs.filter(s => s.business).reduce((a, s) => a + s.amount, 0);
  const debtPlan = S.debts.reduce((a, d) => a + d.payment, 0);
  const planTot = p.family + p.subs + p.gas + p.food + p.car + p.fun + p.buffer + (S.tax.complete ? 0 : p.tax) + debtPlan;
  const income = S.settings.checkBudget * 2;
  return `<h1>Settings</h1>
  <h2>Pay &amp; plan</h2>
  <div class="list">
    ${item('Pay schedule', `Every 2 weeks · a payday: ${fmtDateY(anchor())}`, money(S.settings.checkBudget) + '/check · ' + money(S.settings.spendBudget) + ' spending/mo', 'editPay')}
    ${item('Monthly plan', `Family ${money(p.family)} · Gas ${money(p.gas)} · Food ${money(p.food)} · Car ${money(p.car)} · Fun ${money(p.fun)} · Buffer ${money(p.buffer)} · Tax ${money(p.tax)} · Subs ${money(p.subs)}`, '', 'editPlan')}
  </div>
  <div class="card small"><div class="flex between"><span>Plan total (incl. debt payments)</span><b>${money(planTot)}</b></div>
    <div class="flex between"><span>Income budget</span><b>${money(income)}</b></div>
    <div class="flex between"><span>Unassigned (goes to debt)</span><b class="${income - planTot < 0 ? 'overc' : ''}">${money(income - planTot)}</b></div></div>
  <h2>Subscriptions · ${money(subsTot, true)}/mo <span style="text-transform:none">(${money(biz, true)} business)</span></h2>
  <div class="list">${S.subs.map(s => item(`${esc(s.name)}${s.business ? ' <span class="badge">business</span>' : ''}`, `Billed on the ${ordinal(s.day)}`, money(s.amount, true), 'editSub', s.id)).join('')}</div>
  <button class="btn block" data-act="addSub">+ Add subscription</button>
  <h2>Tax fund</h2>
  <div class="list">${item('Goal & dates', `Goal ${money(S.tax.goal)} · est. ${money(S.tax.estLow)}–${money(S.tax.estHigh)}`, '', 'editTax')}</div>
  <h2>Reminders</h2>
  <div class="list">${S.reminders.map(r => item(esc(r.title), fmtDate(parse(r.date)) + (r.done ? ' · done' : ''), '', 'remEdit', r.id)).join('')}${item('Add reminder', '', '＋', 'remAdd')}
  ${item('AppleCare', S.appleCare.batteryReplaced ? (S.appleCare.reviewed ? 'Reviewed' : 'Battery replaced — review it') : 'Waiting for battery replacement', '', 'appleReset')}</div>
  <h2>Appearance</h2>
  ${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], S.settings.theme)}
  <h2>Privacy &amp; security</h2>
  <div class="list">${item('PIN lock', S.settings.pinHash ? 'On — asks after the app is in the background for a minute' : 'Off', S.settings.pinHash ? 'Change' : 'Set up', 'pinSet')}${S.settings.pinHash ? item('Turn off PIN', '', '', 'pinOff') : ''}</div>
  <p class="small muted" style="margin:0 4px 8px">Your data never leaves this device — no accounts, no servers, no analytics. The PIN keeps people out of the app but doesn’t encrypt the stored data.</p>
  <h2>Backup</h2>
  <div class="btns" style="margin-top:0"><button class="btn" data-act="export">Export backup</button><button class="btn" data-act="import">Import backup</button></div>
  <p class="small muted" style="margin:8px 4px">Export regularly — if you clear Safari data or delete the app, the data goes with it.</p>
  <div class="btns"><button class="btn danger" data-act="reset">Erase all data</button></div>`;
}

const views = { home: viewHome, add: viewAdd, debts: viewDebts, taxes: viewTaxes, settings: viewSettings };
function render() {
  const theme = S.settings.theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme;
  if (locked) { $('#view').innerHTML = ''; return; }
  $('#view').innerHTML = views[ui.tab]();
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.tab));
}

/* ---------- actions ---------- */
const A = {
  setBudget() {
    const ym = iso(today()).slice(0, 7), name = new Date().toLocaleDateString('en-US', { month: 'long' });
    openForm({ title: `Spending money for ${name}`, note: 'How much you have to spend this month. Change it any month.', fields: [
      { k: 'amt', label: 'Amount', type: 'number', value: monthBudget(ym), req: true }, { k: 'def', label: 'Also use as the default for future months', type: 'checkbox', value: false }],
      onSubmit: v => { if (v.amt < 0) return false; S.monthBudgets = S.monthBudgets || {}; S.monthBudgets[ym] = round2(v.amt); if (v.def) S.settings.spendBudget = round2(v.amt); commit('Saved'); } });
  },
  tab(el) { ui.tab = el.dataset.v; scrollTo(0, 0); render(); },
  seg(el) {
    const { key, val } = el.dataset;
    if (key === 'theme') { S.settings.theme = val; return commit(); }
    ui[key] = val; if (key === 'addSeg' && val === 'paycheck') ui.pc = null; render();
  },
  cat(el) { ui.cat = el.dataset.val; $$('.chip').forEach(c => c.classList.toggle('on', c === el)); },
  addSpend() {
    const amt = num($('#amt').value);
    if (amt <= 0) { $('#amt').classList.add('err'); return $('#amt').focus(); }
    S.spending.push({ id: uid(), amount: round2(amt), cat: ui.cat, note: $('#note').value.trim(), date: $('#sdate').value || iso(today()) });
    ui.draft = { amt: '', note: '' }; commit('Added ' + money(amt, true));
  },
  editSpend(el) {
    const s = S.spending.find(x => x.id === el.dataset.id); if (!s) return;
    openForm({ title: 'Edit spending', fields: [
      { k: 'amount', label: 'Amount', type: 'number', value: s.amount, req: true }, { k: 'cat', label: 'Category', type: 'select', value: s.cat, options: CATS.map(c => [c, c]) },
      { k: 'note', label: 'Note', value: s.note }, { k: 'date', label: 'Date', type: 'date', value: s.date, req: true }],
      onSubmit: v => { Object.assign(s, { amount: round2(v.amount), cat: v.cat, note: v.note, date: v.date }); commit(); },
      onDelete: () => { S.spending = S.spending.filter(x => x !== s); commit(); } });
  },
  savePc() {
    const pc = ui.pc, rem = pcRemainder();
    if (pc.amount <= 0) return toast('Enter the paycheck amount');
    if (rem < 0) return toast('Buckets exceed the paycheck');
    const allocs = pc.buckets.map(b => ({ ...b, amount: b.type === 'rem' ? rem : b.amount }));
    const rec = { id: uid(), date: pc.date, kind: pc.kind === 'bonus' || checkInfo(parse(pc.date)).kind === 'bonus' ? 'bonus' : pc.kind, amount: pc.amount, allocations: allocs, linked: [] };
    if (pc.log) for (const a of allocs) {
      if (a.amount <= 0) continue;
      if (a.type === 'tax') rec.linked.push(['tax', addTaxTx('deposit', a.amount, pc.date, 'Paycheck')]);
      else if ((a.type === 'debt' || a.type === 'rem') && a.debtId) { const id = addDebtEntry(a.debtId, 'pay', a.amount, pc.date, 'Paycheck'); if (id) rec.linked.push(['debt', id]); }
    }
    S.paychecks.push(rec); ui.pc = null; commit('Paycheck saved');
  },
  async viewPc(el) {
    const p = S.paychecks.find(x => x.id === el.dataset.id); if (!p) return;
    const body = p.allocations.filter(a => a.amount > 0).map(a => `${a.label}: ${money(a.amount)}`).join('\n');
    if (await ask(`${fmtDateY(parse(p.date))} — ${money(p.amount)}\n\n${body}\n\nDelete this paycheck${p.linked.length ? ' and the payments/deposits it logged' : ''}?`, 'Delete')) {
      for (const [k, id] of p.linked) { if (k === 'debt') removeDebtEntry(id); else S.tax.tx = S.tax.tx.filter(t => t.id !== id); }
      S.paychecks = S.paychecks.filter(x => x !== p); commit('Deleted');
    }
  },
  logPay(el) {
    const d = debt(el.dataset.id);
    openForm({ title: `Payment to ${d.name}`, fields: [{ k: 'amount', label: 'Amount', type: 'number', value: planned(d, today()) || '', req: true }, { k: 'date', label: 'Date', type: 'date', value: iso(today()), req: true }, { k: 'note', label: 'Note' }],
      onSubmit: v => { if (v.amount <= 0) return false; addDebtEntry(d.id, 'pay', round2(v.amount), v.date, v.note); commit('Payment logged'); } });
  },
  debtMore(el) {
    const d = debt(el.dataset.id);
    openForm({ title: d.name, note: `Interest this month at ${aprAt(d, today())}% ≈ ${money(monthlyInterest(d), true)}.`, fields: [
      { k: 'what', label: 'Action', type: 'select', value: 'balance', options: [['balance', 'Set balance to match statement'], ['interest', `Add this month’s interest (${money(monthlyInterest(d), true)})`]] }, { k: 'amount', label: 'New balance (for “set balance”)', type: 'number', value: d.balance }],
      submit: 'Apply', onSubmit: v => {
        if (v.what === 'interest') addDebtEntry(d.id, 'interest', monthlyInterest(d), iso(today()), 'Monthly interest');
        else { if (v.amount == null || v.amount < 0) return false; const delta = round2(v.amount - d.balance); if (delta) addDebtEntry(d.id, 'adjust', delta, iso(today()), 'Balance update'); }
        commit('Updated'); } });
  },
  async delPay(el) {
    const p = S.payments.find(x => x.id === el.dataset.id);
    if (p && await ask('Remove this entry and restore the balance?', 'Remove')) { removeDebtEntry(p.id); commit('Removed'); }
  },
  addDebt() { debtForm(null); }, editDebt(el) { debtForm(debt(el.dataset.id)); },
  owedItem(el) {
    const o = S.owed.find(x => x.id === el.dataset.id), target = openDebts()[0];
    if (o.received) return openForm({ title: o.from, fields: [], submit: 'OK', onSubmit: () => true, onDelete: () => { S.owed = S.owed.filter(x => x !== o); commit(); } });
    openForm({ title: o.from, note: `Mark received to apply it to ${target ? esc(target.name) : 'your debt'}.`, fields: [
      { k: 'amount', label: 'Amount received', type: 'number', value: round2((o.low + o.high) / 2), req: true }, { k: 'date', label: 'Date', type: 'date', value: iso(today()), req: true }],
      submit: 'Received — apply to debt', onSubmit: v => {
        if (v.amount <= 0) return false;
        if (target) addDebtEntry(target.id, 'pay', round2(v.amount), v.date, 'Reimbursement: ' + o.from);
        Object.assign(o, { received: true, amount: round2(v.amount) }); commit('Applied to ' + (target ? target.name : 'debt')); },
      onDelete: () => { S.owed = S.owed.filter(x => x !== o); commit(); } });
  },
  addOwed() {
    openForm({ title: 'Money owed to me', fields: [{ k: 'from', label: 'From / what for', req: true }, { k: 'low', label: 'Low estimate', type: 'number', req: true }, { k: 'high', label: 'High estimate', type: 'number', req: true }],
      onSubmit: v => { S.owed.push({ id: uid(), from: v.from, low: v.low, high: Math.max(v.low, v.high), received: false }); commit(); } });
  },
  taxDep() { taxForm('deposit'); },
  taxWd() { taxForm('withdraw'); },
  taxOwed() {
    const t = S.tax;
    openForm({ title: 'Actual amount owed', note: 'Once you know the real number, set it here. Marking the fund complete redirects the monthly tax-fund money to your debt.', fields: [
      { k: 'goal', label: 'Amount owed (new goal)', type: 'number', value: t.goal, req: true }, { k: 'complete', label: 'Mark fund complete', type: 'checkbox', value: t.complete }],
      onSubmit: v => { t.goal = v.goal; t.complete = v.complete; commit(v.complete ? 'Fund complete — money redirected to debt' : 'Saved'); } });
  },
  async delTax(el) {
    const x = S.tax.tx.find(t => t.id === el.dataset.id);
    if (x && await ask('Delete this transaction?', 'Delete')) { S.tax.tx = S.tax.tx.filter(t => t !== x); commit('Deleted'); }
  },
  sumPrev() { shiftMonth(-1); }, sumNext() { shiftMonth(1); },
  async appleBattery() { if (await ask('Battery replaced? You’ll get a reminder to review AppleCare.', 'Yes, replaced', false)) { Object.assign(S.appleCare, { batteryReplaced: true, replacedDate: iso(today()) }); commit(); } },
  async appleReviewed() {
    const ac = S.subs.find(s => /applecare/i.test(s.name));
    const cancel = ac && await ask(`Remove AppleCare (${money(ac.amount)}/mo) from your subscriptions?`, 'Remove it');
    if (cancel) S.subs = S.subs.filter(s => s !== ac);
    S.appleCare.reviewed = true; commit('AppleCare reminder cleared');
  },
  async appleReset() { if (await ask('Reset the AppleCare reminder?', 'Reset', false)) { S.appleCare = { batteryReplaced: false, replacedDate: null, reviewed: false }; commit(); } },
  remAdd() { remForm(null); }, remEdit(el) { remForm(S.reminders.find(r => r.id === el.dataset.id)); },
  remDone(el) { const r = S.reminders.find(x => x.id === el.dataset.id); if (r) { r.done = true; commit('Done'); } },
  editPay() {
    openForm({ title: 'Pay schedule', note: 'Pick any real payday (past or future). Every 14 days from it is a payday; the first of each month is your family-payment check and a 3rd in a month is a bonus check.', fields: [
      { k: 'anchor', label: 'A payday date', type: 'date', value: S.settings.anchorPayday, req: true }, { k: 'budget', label: 'Budgeted take-home per check', type: 'number', value: S.settings.checkBudget, req: true }, { k: 'spend', label: 'Default spending money per month (Family not counted)', type: 'number', value: S.settings.spendBudget, req: true }],
      onSubmit: v => { S.settings.anchorPayday = v.anchor; S.settings.checkBudget = v.budget; S.settings.spendBudget = v.spend; ui.pc = null; commit('Saved'); } });
  },
  editPlan() {
    const p = S.plan, L = { family: 'Family contribution', subs: 'Subscriptions (budget)', gas: 'Gas', food: 'Food', car: 'Car maintenance fund', fun: 'Shopping / fun (hard limit)', buffer: 'Buffer', tax: 'Tax fund' };
    openForm({ title: 'Monthly plan', note: 'Debt payments are edited on each debt. Gas, food and tax split evenly across 2 checks.', fields: Object.keys(L).map(k => ({ k, label: L[k], type: 'number', value: p[k], req: true })),
      onSubmit: v => { for (const k of Object.keys(L)) p[k] = v[k]; ui.pc = null; commit('Plan saved'); } });
  },
  addSub() { subForm(null); }, editSub(el) { subForm(S.subs.find(s => s.id === el.dataset.id)); },
  editTax() {
    const t = S.tax;
    openForm({ title: 'Tax fund', fields: [
      { k: 'goal', label: 'Goal', type: 'number', value: t.goal, req: true }, { k: 'estLow', label: 'Estimated owed (low)', type: 'number', value: t.estLow }, { k: 'estHigh', label: 'Estimated owed (high)', type: 'number', value: t.estHigh },
      { k: 'estDate', label: 'Estimated payment date', type: 'date', value: t.estDate, req: true }, { k: 'dueDate', label: 'Tax day', type: 'date', value: t.dueDate, req: true }, { k: 'complete', label: 'Fund complete', type: 'checkbox', value: t.complete }],
      onSubmit: v => { Object.assign(t, { goal: v.goal, estLow: v.estLow ?? v.goal, estHigh: v.estHigh ?? v.goal, estDate: v.estDate, dueDate: v.dueDate, complete: v.complete }); commit('Saved'); } });
  },
  async pinSet() {
    openForm({ title: S.settings.pinHash ? 'Change PIN' : 'Set a PIN', fields: [...(S.settings.pinHash ? [{ k: 'old', label: 'Current PIN', type: 'pin', req: true }] : []), { k: 'a', label: 'New PIN (4–6 digits)', type: 'pin', req: true }, { k: 'b', label: 'Repeat PIN', type: 'pin', req: true }],
      onSubmit: v => {
        (async () => {
          if (S.settings.pinHash && await hashPin(v.old, S.settings.pinSalt) !== S.settings.pinHash) return toast('Current PIN is wrong');
          if (!/^\d{4,6}$/.test(v.a)) return toast('Use 4–6 digits');
          if (v.a !== v.b) return toast('PINs don’t match');
          const salt = uid() + uid();
          Object.assign(S.settings, { pinSalt: salt, pinHash: await hashPin(v.a, salt), pinLen: v.a.length }); commit('PIN set');
        })();
      } });
  },
  pinOff() {
    openForm({ title: 'Turn off PIN', fields: [{ k: 'pin', label: 'Enter your PIN', type: 'pin', req: true }], onSubmit: v => {
      (async () => { if (await hashPin(v.pin, S.settings.pinSalt) !== S.settings.pinHash) return toast('Wrong PIN'); Object.assign(S.settings, { pinHash: null, pinSalt: null }); commit('PIN removed'); })(); } });
  },
  export() { exportData(); },
  import() { $('#importFile').click(); },
  async reset() {
    if (await ask('Erase ALL data on this device? This cannot be undone. (Export a backup first.)', 'Erase') && await ask('Really erase everything?', 'Yes, erase')) { S = defaults(); ui.pc = null; ui.wiAmt = null; ui.wiDebt = null; commit('Reset to starting data'); }
  }
};
function shiftMonth(n) { const [y, m] = ui.sumMonth.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); ui.sumMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); }
function taxForm(type) {
  const w = type === 'withdraw';
  openForm({ title: w ? 'Withdraw from tax fund' : 'Deposit to tax fund', note: w ? '<b>This money is for taxes.</b>' : '', fields: [{ k: 'amount', label: 'Amount', type: 'number', req: true }, { k: 'date', label: 'Date', type: 'date', value: iso(today()), req: true }, { k: 'note', label: 'Note' }],
    submit: w ? 'Withdraw anyway' : 'Deposit', onSubmit: async v => { if (v.amount <= 0) return false; if (w && !(await ask('This money is for taxes.\n\nWithdraw ' + money(v.amount, true) + ' anyway?', 'Withdraw'))) return false; addTaxTx(type, round2(v.amount), v.date, v.note); commit(w ? 'Withdrawal logged' : 'Deposit logged'); } });
}
function debtForm(d) {
  const nw = !d;
  openForm({ title: nw ? 'Add debt' : 'Edit ' + d.name, fields: [
    { k: 'name', label: 'Name', value: d?.name, req: true }, { k: 'balance', label: 'Balance', type: 'number', value: d?.balance, req: true }, { k: 'apr', label: d && d.promoEnd ? 'APR during promo (%)' : 'APR (%)', type: 'number', value: d?.apr ?? 0, req: true },
    { k: 'payment', label: 'Monthly payment (minimum / target)', type: 'number', value: d?.payment ?? 0, req: true },
    { k: 'promoEnd', label: '0% promo end date (optional)', type: 'date', value: d?.promoEnd }, { k: 'postApr', label: 'APR after promo (%)', type: 'number', value: d?.postApr, ph: 'optional' },
    { k: 'redirectTax', label: 'Gets the tax-fund money once the fund is done', type: 'checkbox', value: d?.redirectTax }],
    onSubmit: v => {
      const vals = { name: v.name, balance: round2(v.balance), apr: v.apr, payment: v.payment, promoEnd: v.promoEnd, postApr: v.postApr, redirectTax: v.redirectTax };
      if (nw) S.debts.push({ id: uid(), startBalance: vals.balance, ...vals });
      else { Object.assign(d, vals); if (d.balance > d.startBalance) d.startBalance = d.balance; }
      ui.wiAmt = null; commit('Saved'); },
    onDelete: nw ? null : () => { S.debts = S.debts.filter(x => x !== d); ui.wiAmt = null; commit(); } });
}
function subForm(s) {
  openForm({ title: s ? 'Edit subscription' : 'Add subscription', fields: [{ k: 'name', label: 'Name', value: s?.name, req: true }, { k: 'amount', label: 'Amount per month', type: 'number', value: s?.amount, req: true },
    { k: 'day', label: 'Billing day of month (1–31)', type: 'number', value: s?.day ?? 1, req: true }, { k: 'business', label: 'Business expense', type: 'checkbox', value: s?.business }],
    onSubmit: v => { const o = { name: v.name, amount: round2(v.amount), day: Math.min(31, Math.max(1, Math.round(v.day))), business: v.business }; if (s) Object.assign(s, o); else S.subs.push({ id: uid(), ...o }); commit('Saved'); },
    onDelete: s ? () => { S.subs = S.subs.filter(x => x !== s); commit(); } : null });
}
function remForm(r) {
  openForm({ title: r ? 'Edit reminder' : 'Add reminder', fields: [{ k: 'title', label: 'Title', value: r?.title, req: true }, { k: 'date', label: 'Date', type: 'date', value: r?.date || iso(today()), req: true }, { k: 'note', label: 'Note', value: r?.note }, ...(r ? [{ k: 'done', label: 'Done', type: 'checkbox', value: r.done }] : [])],
    onSubmit: v => { if (r) Object.assign(r, { title: v.title, date: v.date, note: v.note, done: v.done }); else S.reminders.push({ id: uid(), title: v.title, date: v.date, note: v.note, done: false }); commit('Saved'); },
    onDelete: r ? () => { S.reminders = S.reminders.filter(x => x !== r); commit(); } : null });
}

/* ---------- backup ---------- */
async function exportData() {
  const name = `mymoney-backup-${iso(today())}.json`;
  const blob = new Blob([JSON.stringify({ app: 'mymoney', version: 1, exportedAt: new Date().toISOString(), data: S }, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Backup downloaded');
}
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), data = j.data || j;
    if (!data.plan || !Array.isArray(data.debts) || !data.tax) throw new Error('bad');
    if (!(await ask(`Replace everything on this device with the backup${j.exportedAt ? ' from ' + j.exportedAt.slice(0, 10) : ''}?`, 'Replace', false))) return;
    S = merge(defaults(), data); ui.pc = null; ui.wiAmt = null; ui.wiDebt = null; commit('Backup restored');
  } catch (err) { alert('That file isn’t a valid My Money backup.'); }
});

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.closest('#lock')) return;
  const fn = A[el.dataset.act]; if (fn) fn(el);
});
document.addEventListener('input', e => {
  const t = e.target, live = t.dataset.live; if (!live) return;
  t.classList.remove('err');
  if (live === 'draft') ui.draft = { amt: $('#amt').value, note: $('#note').value };
  else if (live === 'pcamt') { ui.pc.amount = num(t.value); updateRem(); }
  else if (live === 'bucket') { ui.pc.buckets[+t.dataset.i].amount = num(t.value); updateRem(); }
  else if (live === 'wi') { ui.wiAmt = +t.value; $('#wiVal').textContent = money(ui.wiAmt); $('#wiOut').innerHTML = whatIfOut(); }
});
function updateRem() { const r = pcRemainder(), el = $('#remv'); el.textContent = money(r); el.className = 'remv ' + (r < 0 ? 'overc' : 'ok'); $('#remwarn').hidden = r >= 0; }
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'pckind') { ui.pc.kind = t.value; ui.pc.buckets = buildTemplate(t.value); render(); }
  else if (t.id === 'pcdate') { ui.pc.date = t.value || ui.pc.date; ui.pc.kind = checkInfo(parse(ui.pc.date)).kind; ui.pc.buckets = buildTemplate(ui.pc.kind); render(); }
  else if (t.id === 'pclog') ui.pc.log = t.checked;
  else if (t.id === 'wiDebt') { ui.wiDebt = t.value; ui.wiAmt = null; render(); }
});

/* ---------- PIN lock ---------- */
async function hashPin(pin, salt) {
  const s = `${salt}:${pin}`;
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'x' + h;
}
function showLock() {
  locked = true; render();
  const el = $('#lock'), len = S.settings.pinLen || 4; let entry = '';
  const draw = () => { $('.dots', el).innerHTML = Array.from({ length: len }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join(''); };
  el.innerHTML = `<h1>My Money</h1><div class="muted">Enter PIN</div><div class="dots"></div><div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => `<button class="${k === '' ? 'blank' : ''}" data-k="${k}">${k}</button>`).join('')}</div>`;
  el.hidden = false; draw();
  el.onclick = async e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k;
    if (k === '⌫') entry = entry.slice(0, -1); else if (k !== '' && entry.length < len) entry += k;
    draw();
    if (entry.length === len) {
      if (await hashPin(entry, S.settings.pinSalt) === S.settings.pinHash) { el.hidden = true; el.innerHTML = ''; locked = false; render(); }
      else { const d = $('.dots', el); d.classList.add('shake'); setTimeout(() => { d.classList.remove('shake'); entry = ''; draw(); }, 350); }
    }
  };
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.settings.pinHash && !locked && hiddenAt && Date.now() - hiddenAt > 60000) showLock();
  else if (!document.hidden && !locked) render();
});

/* ---------- boot ---------- */
if (S.settings.pinHash) showLock(); else render();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
