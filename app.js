/* Straordinari v4 */
const LS_KEY = 'workdays_v1';
const CFG_KEY = 'workcfg_v4';
const OUTBOX_KEY = 'work_outbox_v1';

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

function todayLocalISO(){
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function minutesFromHHMM(hhmm){ const [h,m] = hhmm.split(':').map(Number); return h*60 + m; }
function hhmmFromMinutes(min){ const h = Math.floor(min/60), m = min%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function nowHHMM(){ const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function parseLS(){ try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function saveLS(obj){ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }
function parseCFG(){ try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } }
function saveCFG(cfg){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
function parseOutbox(){ try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; } }
function saveOutbox(arr){ localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr)); }
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 1500); }

function ensureDay(dateISO){
  const data = parseLS();
  if(!data[dateISO]) data[dateISO] = { start: null, breakStart: null, breakEnd: null, end: null, finalized:false, updatedAt: Date.now() };
  const cfg = parseCFG();
  const s = cfg.startFixed || '08:00';
  if(!data[dateISO].start) data[dateISO].start = s;
  data[dateISO].updatedAt = Date.now();
  saveLS(data);
}

function finalizePastDays(){
  const data = parseLS();
  const cfg = parseCFG();
  const defBS = cfg.defBreakStart || '12:30';
  const defBE = cfg.defBreakEnd || '14:00';
  const defEnd = cfg.defEnd || '17:30';
  const today = todayLocalISO();
  let changed = false;

  Object.keys(data).forEach(dk => {
    if(dk < today && !data[dk].finalized){
      const day = data[dk];
      if(!day.breakStart) day.breakStart = defBS;
      if(!day.breakEnd) day.breakEnd = defBE;
      if(!day.end) day.end = defEnd;
      day.finalized = true;
      day.updatedAt = Date.now();
      queueOutbox(dk, day);
      changed = true;
    }
  });
  if(changed) saveLS(data);
}

function computeNetDay(d){
  if(!(d.start && d.breakStart && d.breakEnd && d.end)) return null;
  // Net by intervals: (1->2) + (3->4)
  return (minutesFromHHMM(d.breakStart) - minutesFromHHMM(d.start)) + (minutesFromHHMM(d.end) - minutesFromHHMM(d.breakEnd));
}
function computeExtra(d){
  const net = computeNetDay(d);
  if(net === null) return null;
  return net - 8*60;
}
function daysInMonth(y, m){ return new Date(y, m, 0).getDate(); }

/* ===== Pagina principale ===== */
function updateOggiUI(){
  const data = parseLS();
  const today = todayLocalISO();
  ensureDay(today);
  const day = data[today];

  $('#startTime').textContent = day.start || '08:00';
  $('#breakStartTime').textContent = day.breakStart || '—';
  $('#breakEndTime').textContent = day.breakEnd || '—';
  $('#endTime').textContent = day.end || '—';

  const select = $('#azione');
  let next = 'breakStart';
  if(day.breakStart && !day.breakEnd) next = 'breakEnd';
  else if(day.breakStart && day.breakEnd && !day.end) next = 'end';
  else if(day.breakStart && day.breakEnd && day.end) next = 'end';
  select.value = next;

  const card = $('#oggiSummary');
  const { start, breakStart:bs, breakEnd:be, end } = day;
  if(start && bs && be && end){
    const net = (minutesFromHHMM(bs) - minutesFromHHMM(start)) + (minutesFromHHMM(end) - minutesFromHHMM(be));
    $('#oggiNet').textContent = `Lavoro netto: ${hhmmFromMinutes(net)} (prima ${start}–${bs} + dopo ${be}–${end})`;
    const extra = net - 8*60;
    const sign = extra >= 0 ? '+' : '−';
    $('#oggiExtra').textContent = `Straordinario oggi: ${sign}${hhmmFromMinutes(Math.abs(extra))}`;
    card.hidden = false;
  } else {
    card.hidden = true;
  }
}

function recordAction(){
  const select = $('#azione');
  const field = select.value;
  const data = parseLS();
  const today = todayLocalISO();
  ensureDay(today);
  const day = data[today];
  const now = nowHHMM();

  if(day[field]){
    if(!confirm(`La voce è già impostata su ${day[field]}. Vuoi sovrascrivere con ${now}?`)) return;
  }
  day[field] = now;
  day.updatedAt = Date.now();
  saveLS(data);
  queueOutbox(today, day);

  if(field === 'breakStart') $('#azione').value = 'breakEnd';
  if(field === 'breakEnd') $('#azione').value = 'end';

  updateOggiUI();
  toast('Registrato');
  trySync();
}

/* ===== Picker ora/min ===== */
const picker = { field:null, date:null };
function buildPickerOptions(){
  const h = $('#pickHour'), m = $('#pickMin');
  if(h.options.length === 0){
    for(let i=0;i<24;i++){ const o = document.createElement('option'); o.value = String(i).padStart(2,'0'); o.textContent = o.value; h.appendChild(o); }
  }
  if(m.options.length === 0){
    for(let i=0;i<60;i++){ const o = document.createElement('option'); o.value = String(i).padStart(2,'0'); o.textContent = o.value; m.appendChild(o); }
  }
}
function openPicker(dateISO, field, presetHHMM){
  picker.field = field; picker.date = dateISO;
  buildPickerOptions();
  const [ph, pm] = (presetHHMM || '08:00').split(':');
  $('#pickHour').value = ph; $('#pickMin').value = pm;
  $('#modalPicker').classList.add('show');
  $('#modalPicker').setAttribute('aria-hidden','false');
}
function closePicker(){
  $('#modalPicker').classList.remove('show');
  $('#modalPicker').setAttribute('aria-hidden','true');
}
function applyPicker(){
  const hh = $('#pickHour').value, mm = $('#pickMin').value;
  const t = `${hh}:${mm}`;
  const data = parseLS();
  ensureDay(picker.date);
  const day = data[picker.date];
  day[picker.field] = t;
  day.updatedAt = Date.now();
  saveLS(data);
  queueOutbox(picker.date, day);
  closePicker();
  if(picker.date === todayLocalISO()) updateOggiUI();
  updateRecentiUI();
  updateTotaleUI();
  toast('Orario aggiornato');
  trySync();
}

/* ===== Orari recenti ===== */
let cloudCache = null; // map date->record from cloud
async function fetchCloudLast(days=90){
  const cfg = parseCFG();
  if(!cfg.syncEnabled || !cfg.syncUrl) return null;
  const res = await fetch(cfg.syncUrl + `?op=last&days=${days}`, { headers: { 'X-Auth': cfg.syncToken || '' } });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const arr = await res.json();
  const map = {};
  if(Array.isArray(arr)){
    for(const r of arr){
      map[r.date] = { start:r.start||null, breakStart:r.breakStart||null, breakEnd:r.breakEnd||null, end:r.end||null, finalized: !!r.finalized };
    }
  }
  return map;
}
function daysInMonthCount(y,m){ return new Date(y, m, 0).getDate(); }
function weekdayName(d){ return ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][d]; }

function computeExtraFromRec(rec){
  const net = rec && rec.start && rec.breakStart && rec.breakEnd && rec.end
    ? (minutesFromHHMM(rec.breakStart) - minutesFromHHMM(rec.start)) + (minutesFromHHMM(rec.end) - minutesFromHHMM(rec.breakEnd))
    : null;
  return (net===null) ? null : (net - 8*60);
}

async function updateRecentiUI(){
  const list = $('#recentiList');
  list.innerHTML = '';
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth()+1;
  const totalDays = daysInMonthCount(y, m);

  const cfg = parseCFG();
  const banner = $('#recentiBanner');
  const needOnline = !(cfg.syncEnabled && cfg.syncUrl);
  banner.hidden = !needOnline;
  if(needOnline && !navigator.onLine){
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Offline. Connettiti per caricare orari recenti dal cloud.';
    list.appendChild(p);
    return;
  }

  try { cloudCache = await fetchCloudLast(90); } catch (e){ console.warn('Cloud fetch error', e); cloudCache = null; }
  const local = parseLS();

  for(let d=1; d<=totalDays; d++){
    const dateISO = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const jsDate = new Date(dateISO + 'T00:00:00');
    const wd = jsDate.getDay();
    const weekend = (wd===0 || wd===6);
    const rec = (cloudCache && cloudCache[dateISO]) || local[dateISO] || { };
    const extra = computeExtraFromRec(rec);
    const extraStr = (extra===null) ? '—' : `${extra>=0?'+':'−'}${hhmmFromMinutes(Math.abs(extra))}`;

    const el = document.createElement('div');
    el.className = 'item' + (weekend ? ' weekend' : '');
    el.innerHTML = `
      <div class="muted">${dateISO} ${weekdayName(wd)}</div>
      <div class="extra">${extraStr}</div>
      <button class="editbtn" data-date="${dateISO}">Modifica</button>
    `;
    el.addEventListener('click', (ev) => { if(ev.target && ev.target.classList.contains('editbtn')) return; openDayDetail(dateISO); });
    el.querySelector('.editbtn').addEventListener('click', (ev) => { ev.stopPropagation(); openDayDetail(dateISO); });
    list.appendChild(el);
  }
}

/* ===== Dettaglio giorno ===== */
function renderDayRows(dateISO){
  const data = ((cloudCache && cloudCache[dateISO]) || parseLS()[dateISO] || {});
  const rowsHost = $('#dayRows'); rowsHost.innerHTML = '';
  const defs = [
    ['start','Inizio lavoro', data.start || '—'],
    ['breakStart','Inizio pausa', data.breakStart || '—'],
    ['breakEnd','Fine pausa', data.breakEnd || '—'],
    ['end','Uscita', data.end || '—']
  ];
  for(const [field, label, val] of defs){
    const row = document.createElement('div'); row.className = 'row';
    const time = document.createElement('div'); time.className='time'; time.textContent = val;
    const left = document.createElement('div'); left.textContent = label;
    const btn = document.createElement('button'); btn.className='btn ghost'; btn.textContent='Modifica';
    btn.addEventListener('click', () => {
      const preset = (val && val.includes(':')) ? val : (field==='start' ? (parseCFG().startFixed || '08:00') : '12:00');
      openPicker(dateISO, field, preset);
    });
    row.appendChild(left); row.appendChild(time); row.appendChild(btn);
    rowsHost.appendChild(row);
  }
}
function openDayDetail(dateISO){
  $('#dayTitle').textContent = `Giornata ${dateISO}`;
  renderDayRows(dateISO);
  $('#modalDay').classList.add('show');
  $('#modalDay').setAttribute('aria-hidden','false');
}
function closeDayDetail(){
  $('#modalDay').classList.remove('show');
  $('#modalDay').setAttribute('aria-hidden','true');
}

/* ===== Totale mensile ===== */
function ymOf(date){ return date.toISOString().slice(0,7); }
function ymCurrent(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function sumMonthLocal(ym){
  const data = parseLS();
  let total = 0;
  for(const k of Object.keys(data)){
    if(k.startsWith(ym)){
      const e = computeExtra(data[k]);
      if(e !== null) total += e;
    }
  }
  return total;
}

async function monthTotalFromCloud(ym){
  const cfg = parseCFG();
  if(!cfg.syncEnabled || !cfg.syncUrl) return null;
  const url = `${cfg.syncUrl}?op=month&ym=${encodeURIComponent(ym)}`;
  const res = await fetch(url, { headers: { 'X-Auth': cfg.syncToken || '' } });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const js = await res.json();
  if(js && typeof js.totalExtraMinutes === 'number') return js.totalExtraMinutes;
  return null;
}

async function updateTotaleUI(){
  const ym = ymCurrent();
  const cfg = parseCFG();
  const banner = $('#totaleBanner');
  const needOnline = !(cfg.syncEnabled && cfg.syncUrl);
  banner.hidden = !needOnline;

  let total = null;
  if(cfg.syncEnabled && cfg.syncUrl && navigator.onLine){
    try { total = await monthTotalFromCloud(ym); } catch(e){ console.warn('Cloud month error', e); }
  }
  if(total === null){
    // fallback locale
    total = sumMonthLocal(ym);
  }
  const sign = total >= 0 ? '+' : '−';
  $('#bigTotal').textContent = `${sign}${hhmmFromMinutes(Math.abs(total))}`;
}

/* Month picker modal */
function buildMonthOptions(){
  const sel = $('#pickMonth');
  if(sel.options.length>0){ sel.options.length = 0; }
  const now = new Date();
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  // last 12 months BEFORE current month
  const opts = [];
  for(let i=1;i<=12;i++){
    const dt = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const label = `${months[dt.getMonth()]} ${dt.getFullYear()}`;
    opts.push({ym, label});
  }
  for(const o of opts){
    const op = document.createElement('option'); op.value = o.ym; op.textContent = o.label; sel.appendChild(op);
  }
  sel.selectedIndex = 0; // start from previous month
}
function openMonthPicker(){
  buildMonthOptions();
  $('#modalMonth').classList.add('show');
  $('#modalMonth').setAttribute('aria-hidden','false');
}
function closeMonthPicker(){
  $('#modalMonth').classList.remove('show');
  $('#modalMonth').setAttribute('aria-hidden','true');
}

async function confirmMonthPicker(){
  const ym = $('#pickMonth').value;
  closeMonthPicker();
  // fetch from cloud if possible, else local
  let total = null;
  const cfg = parseCFG();
  if(cfg.syncEnabled && cfg.syncUrl && navigator.onLine){
    try { total = await monthTotalFromCloud(ym); } catch(e){ console.warn('Cloud month error', e); }
  }
  if(total === null) total = sumMonthLocal(ym);
  $('#monthResultTitle').textContent = `Totale ${ym}`;
  const sign = total >= 0 ? '+' : '−';
  $('#monthResultValue').textContent = `${sign}${hhmmFromMinutes(Math.abs(total))}`;
  $('#modalMonthResult').classList.add('show');
  $('#modalMonthResult').setAttribute('aria-hidden','false');
}

/* ===== Outbox & Sync ===== */
function queueOutbox(dateISO, day){
  const out = parseOutbox();
  const idx = out.findIndex(x => x.date === dateISO);
  const item = {
    date: dateISO,
    day: { start: day.start||null, breakStart: day.breakStart||null, breakEnd: day.breakEnd||null, end: day.end||null, finalized: !!day.finalized },
    tzOffsetMinutes: new Date().getTimezoneOffset()*-1,
    deviceTimestamp: Date.now()
  };
  if(idx >= 0) out[idx] = item; else out.push(item);
  saveOutbox(out);
}

async function trySync(){
  const cfg = parseCFG();
  if(!cfg.syncEnabled || !cfg.syncUrl) return;
  if(!navigator.onLine) return;
  const out = parseOutbox();
  if(out.length === 0) return;
  try{
    if(cfg.syncType === 'appsScript'){
      let okCount = 0;
      for(const item of out){
        const res = await fetch(cfg.syncUrl, {
          method: 'POST',
          headers: {'Content-Type':'application/json', 'X-Auth': cfg.syncToken || ''},
          body: JSON.stringify({ op:'upsert', payload: item })
        });
        if(!res.ok) throw new Error('HTTP '+res.status);
        const js = await res.json();
        if(js && js.status === 'ok') okCount++;
      }
      if(okCount === out.length){
        saveOutbox([]);
        toast('Sync completata');
      }
    }
  }catch(e){ console.warn('Sync error', e); }
}

/* ===== Init ===== */
function initTabs(){
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      $$('.page').forEach(p => p.classList.remove('visible'));
      $('#'+target).classList.add('visible');
      if(target==='page-recenti') updateRecentiUI();
      if(target==='page-totale') updateTotaleUI();
    });
  });
}

function eagerSetup(){
  if(!localStorage.getItem(CFG_KEY)){
    saveCFG({startFixed:'08:00', defBreakStart:'12:30', defBreakEnd:'14:00', defEnd:'17:30', syncEnabled:false});
  }
  finalizePastDays();
  ensureDay(todayLocalISO());
  updateOggiUI();
  updateTotaleUI();
}

window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  eagerSetup();
  $('#btnRegistra').addEventListener('click', recordAction);
  // Attach "Modifica" on main page:
  $$('#rowsOggi .btn.ghost').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.getAttribute('data-edit');
      const today = todayLocalISO();
      const data = parseLS()[today] || {};
      const current = (data[field] && data[field].includes(':')) ? data[field] : (field==='start' ? (parseCFG().startFixed || '08:00') : '12:00');
      openPicker(today, field, current);
    });
  });
  // Picker modal
  $('#btnPickerOk').addEventListener('click', applyPicker);
  $('#btnPickerCancel').addEventListener('click', closePicker);
  $('#modalPicker').addEventListener('click', (e) => { if(e.target.id==='modalPicker') closePicker(); });
  // Day modal
  $('#btnDayClose').addEventListener('click', () => { closeDayDetail(); updateRecentiUI(); });
  $('#modalDay').addEventListener('click', (e) => { if(e.target.id==='modalDay') { closeDayDetail(); updateRecentiUI(); } });
  // Month picker & result
  $('#btnVerificaMesi').addEventListener('click', openMonthPicker);
  $('#btnMonthOk').addEventListener('click', confirmMonthPicker);
  $('#btnMonthCancel').addEventListener('click', closeMonthPicker);
  $('#modalMonth').addEventListener('click', (e) => { if(e.target.id==='modalMonth') closeMonthPicker(); });
  $('#btnMonthResultClose').addEventListener('click', () => {
    $('#modalMonthResult').classList.remove('show');
    $('#modalMonthResult').setAttribute('aria-hidden','true');
  });

  window.addEventListener('online', trySync);
});
