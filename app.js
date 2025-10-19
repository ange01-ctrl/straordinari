/* Straordinari v5.3 */
const LS_KEY='workdays_v1',CFG_KEY='workcfg_v5_3',OUTBOX_KEY='work_outbox_v1';
const DEFAULT_ENDPOINT='https://script.google.com/macros/s/AKfycbynmO8K0yUVXtkTAEeSgMCw5i5AAv_bvmnju7_05izCodK6k89c7ANgbGgN5jgRH1S9/exec';
const APP_VER='5.4.1';
const $=(s,e=document)=>e.querySelector(s),$$=(s,e=document)=>[...e.querySelectorAll(s)];

function todayLocalISO(){const d=new Date();return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function minutesFromHHMM(h){const [a,b]=h.split(':').map(Number);return a*60+b;}
function hhmmFromMinutes(m){const h=Math.floor(m/60),n=m%60;return`${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}`;}
function nowHHMM(){const d=new Date();return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function parseLS(){try{return JSON.parse(localStorage.getItem(LS_KEY))||{}}catch{return{}}}
function saveLS(o){localStorage.setItem(LS_KEY, JSON.stringify(o));}
function parseCFG(){try{return JSON.parse(localStorage.getItem(CFG_KEY))||{}}catch{return{}}}
function saveCFG(c){localStorage.setItem(CFG_KEY, JSON.stringify(c));}
function parseOutbox(){try{return JSON.parse(localStorage.getItem(OUTBOX_KEY))||[]}catch{return[]}}
function saveOutbox(a){localStorage.setItem(OUTBOX_KEY, JSON.stringify(a));}
function toast(m){const t=$('#toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1500);}

function ensureDay(d){
  const data=parseLS();
  if(!data[d]) data[d]={start:null,breakStart:null,breakEnd:null,end:null,finalized:false,updatedAt:Date.now()};
  const cfg=parseCFG(); const s=cfg.startFixed||'08:00';
  if(!data[d].start) data[d].start=s;
  data[d].updatedAt=Date.now(); saveLS(data);
}

function finalizePastDays(){
  const data=parseLS();
  const cfg=parseCFG();
  const bs=cfg.defBreakStart||'12:30', be=cfg.defBreakEnd||'14:00', en=cfg.defEnd||'17:30';
  const t=todayLocalISO(); let ch=false;
  Object.keys(data).forEach(k=>{
    if(k<t && !data[k].finalized){
      const day=data[k];
      if(!day.breakStart) day.breakStart=bs;
      if(!day.breakEnd) day.breakEnd=be;
      if(!day.end) day.end=en;
      day.finalized=true; day.updatedAt=Date.now();
      queueOutbox(k,day); ch=true;
    }
  });
  if(ch) saveLS(data);
}

function computeNetDay(d){
  if(!(d.start && d.breakStart && d.breakEnd && d.end)) return null;
  return (minutesFromHHMM(d.breakStart)-minutesFromHHMM(d.start)) + (minutesFromHHMM(d.end)-minutesFromHHMM(d.breakEnd));
}
function computeExtra(d){ const n=computeNetDay(d); if(n===null) return null; return n - 8*60; }
function daysInMonthCount(y,m){ return new Date(y, m, 0).getDate(); }
function weekdayName(d){ return ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][d]; }

/* Pagina principale */
function updateOggiUI(){
  const data=parseLS(); const t=todayLocalISO(); ensureDay(t); const day=data[t];
  $('#startTime').textContent=day.start||'08:00';
  $('#breakStartTime').textContent=day.breakStart||'—';
  $('#breakEndTime').textContent=day.breakEnd||'—';
  $('#endTime').textContent=day.end||'—';
  let next='breakStart';
  if(day.breakStart && !day.breakEnd) next='breakEnd';
  else if(day.breakStart && day.breakEnd && !day.end) next='end';
  else if(day.breakStart && day.breakEnd && day.end) next='end';
  $('#azione').value=next;
  const {start, breakStart:bs, breakEnd:be, end} = day;
  const card=$('#oggiSummary');
  if(start && bs && be && end){
    const net=(minutesFromHHMM(bs)-minutesFromHHMM(start)) + (minutesFromHHMM(end)-minutesFromHHMM(be));
    $('#oggiNet').textContent=`Lavoro netto: ${hhmmFromMinutes(net)} (prima ${start}–${bs} + dopo ${be}–${end})`;
    const extra=net - 8*60; const s=extra>=0?'+':'−';
    $('#oggiExtra').textContent=`Straordinario oggi: ${s}${hhmmFromMinutes(Math.abs(extra))}`;
    card.hidden=false;
  } else card.hidden=true;
}
function recordAction(){
  const field=$('#azione').value; const data=parseLS(); const t=todayLocalISO(); ensureDay(t); const day=data[t]; const now=nowHHMM();
  if(day[field]){ if(!confirm(`La voce è già impostata su ${day[field]}. Vuoi sovrascrivere con ${now}?`)) return; }
  day[field]=now; day.updatedAt=Date.now(); saveLS(data); queueOutbox(t,day);
  if(field==='breakStart') $('#azione').value='breakEnd';
  if(field==='breakEnd') $('#azione').value='end';
  updateOggiUI(); toast('Registrato'); trySync();
}

/* Picker ora/min */
const picker={field:null,date:null};
function buildPickerOptions(){
  const h=$('#pickHour'), m=$('#pickMin');
  if(h.options.length===0){ for(let i=0;i<24;i++){ const o=document.createElement('option'); o.value=String(i).padStart(2,'0'); o.textContent=o.value; h.appendChild(o);} }
  if(m.options.length===0){ for(let i=0;i<60;i++){ const o=document.createElement('option'); o.value=String(i).padStart(2,'0'); o.textContent=o.value; m.appendChild(o);} }
  h.addEventListener('change', updatePickerReadout);
  m.addEventListener('change', updatePickerReadout);
}
function updatePickerReadout(){ const hh=$('#pickHour')?.value||'00', mm=$('#pickMin')?.value||'00'; const r=$('#pickerReadout'); if(r) r.textContent=`${hh}:${mm}`; }
function openPicker(dateISO, field, presetHHMM){
  picker.field=field; picker.date=dateISO; buildPickerOptions();
  const [ph, pm] = (presetHHMM||'08:00').split(':');
  $('#pickHour').value=ph; $('#pickMin').value=pm; updatePickerReadout();
  $('#modalPicker').classList.add('show'); $('#modalPicker').setAttribute('aria-hidden','false');
}
function closePicker(){ $('#modalPicker').classList.remove('show'); $('#modalPicker').setAttribute('aria-hidden','true'); }
function applyPicker(){
  const hh=$('#pickHour').value, mm=$('#pickMin').value; const t=`${hh}:${mm}`;
  const data=parseLS(); ensureDay(picker.date); const day=data[picker.date];
  day[picker.field]=t; day.updatedAt=Date.now(); saveLS(data); queueOutbox(picker.date,day);
  closePicker(); if(picker.date===todayLocalISO()) updateOggiUI(); updateRecentiUI(); updateTotaleUI(); toast('Orario aggiornato'); trySync();
}

/* Orari recenti */
let cloudCache=null;
async function fetchCloudLast(days=90){
  const cfg=parseCFG(); if(!cfg.syncEnabled || !cfg.syncUrl) return null;
  const r=await fetch(cfg.syncUrl+`?op=last&days=${days}`, { headers:{'X-Auth': cfg.syncToken || ''} });
  if(!r.ok) throw new Error('HTTP '+r.status);
  const arr=await r.json(); const map={};
  if(Array.isArray(arr)){ for(const a of arr){ map[a.date]={ start:a.start||null, breakStart:a.breakStart||null, breakEnd:a.breakEnd||null, end:a.end||null, finalized: !!a.finalized }; } }
  return map;
}
async function updateRecentiUI(){
  const list=$('#recentiList'); list.innerHTML='';
  const d=new Date(); const y=d.getFullYear(), m=d.getMonth()+1; const totalDays=daysInMonthCount(y,m);
  const cfg=parseCFG(); const banner=$('#recentiBanner'); const needOnline=!(cfg.syncEnabled && cfg.syncUrl); banner.hidden=!needOnline;
  if(needOnline && !navigator.onLine){ const p=document.createElement('p'); p.className='muted'; p.textContent='Offline. Connettiti per caricare orari recenti dal cloud.'; list.appendChild(p); return; }
  try{ cloudCache = await fetchCloudLast(90); } catch(e){ console.warn('Cloud fetch error', e); cloudCache=null; }
  const local=parseLS();
  for(let i=1;i<=totalDays;i++){
    const iso=`${y}-${String(m).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    const wd=new Date(iso+'T00:00:00').getDay(); const weekend=(wd===0||wd===6);
    const rec=(cloudCache && cloudCache[iso]) || local[iso] || {};
    const extra=computeExtra(rec); const extraStr=(extra===null)?'—':`${extra>=0?'+':'−'}${hhmmFromMinutes(Math.abs(extra))}`;
    const el=document.createElement('div'); el.className='item'+(weekend?' weekend':'');
    el.innerHTML = `<div class="muted">${iso} ${weekdayName(wd)}</div><div class="extra">${extraStr}</div><button class="editbtn" data-date="${iso}">Modifica</button>`;
    el.addEventListener('click', (ev)=>{ if(ev.target && ev.target.classList.contains('editbtn')) return; openDayDetail(iso); });
    el.querySelector('.editbtn').addEventListener('click', (ev)=>{ ev.stopPropagation(); openDayDetail(iso); });
    list.appendChild(el);
  }
}

/* Dettaglio giorno */
function renderDayRows(dateISO){
  const data=((cloudCache && cloudCache[dateISO]) || parseLS()[dateISO] || {});
  const host=$('#dayRows'); host.innerHTML='';
  [['start','Inizio lavoro',data.start||'—'],['breakStart','Inizio pausa',data.breakStart||'—'],['breakEnd','Fine pausa',data.breakEnd||'—'],['end','Uscita',data.end||'—']].forEach(([f,l,v])=>{
    const r=document.createElement('div'); r.className='row';
    const t=document.createElement('div'); t.className='time'; t.textContent=v;
    const left=document.createElement('div'); left.textContent=l;
    const b=document.createElement('button'); b.className='btn ghost'; b.textContent='Modifica';
    b.addEventListener('click', ()=>{ const preset=(v&&v.includes(':'))?v:(f==='start'?(parseCFG().startFixed||'08:00'):'12:00'); openPicker(dateISO,f,preset); });
    r.appendChild(left); r.appendChild(t); r.appendChild(b); host.appendChild(r);
  });
}
function openDayDetail(d){ $('#dayTitle').textContent=`Giornata ${d}`; renderDayRows(d); $('#modalDay').classList.add('show'); $('#modalDay').setAttribute('aria-hidden','false'); }
function closeDayDetail(){ $('#modalDay').classList.remove('show'); $('#modalDay').setAttribute('aria-hidden','true'); }

/* Totale mensile */
function ymCurrent(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function sumMonthLocal(ym){ const data=parseLS(); let tot=0; for(const k of Object.keys(data)){ if(k.startsWith(ym)){ const e=computeExtra(data[k]); if(e!==null) tot+=e; } } return tot; }
async function monthTotalFromCloud(ym){
  const cfg=parseCFG(); if(!cfg.syncEnabled || !cfg.syncUrl) return null;
  const r=await fetch(`${cfg.syncUrl}?op=month&ym=${encodeURIComponent(ym)}`, { headers:{'X-Auth': cfg.syncToken || ''} });
  if(!r.ok) throw new Error('HTTP '+r.status); const js=await r.json();
  return (js && typeof js.totalExtraMinutes==='number') ? js.totalExtraMinutes : null;
}
async function updateTotaleUI(){
  const ym=ymCurrent(); const cfg=parseCFG(); const banner=$('#totaleBanner'); const needOnline=!(cfg.syncEnabled && cfg.syncUrl); banner.hidden=!needOnline;
  let total=null; if(cfg.syncEnabled && cfg.syncUrl && navigator.onLine){ try{ total = await monthTotalFromCloud(ym); } catch(e){} }
  if(total===null) total = sumMonthLocal(ym);
  const s = total>=0?'+':'−'; $('#bigTotal').textContent = `${s}${hhmmFromMinutes(Math.abs(total))}`;
}

/* Outbox & Sync */
function queueOutbox(dateISO, day){
  const out=parseOutbox(); const idx=out.findIndex(x=>x.date===dateISO);
  const item={ date:dateISO, day:{ start:day.start||null, breakStart:day.breakStart||null, breakEnd:day.breakEnd||null, end:day.end||null, finalized:!!day.finalized }, tzOffsetMinutes:new Date().getTimezoneOffset()*-1, deviceTimestamp:Date.now() };
  if(idx>=0) out[idx]=item; else out.push(item); saveOutbox(out);
}
async function trySync(){
  const cfg=parseCFG(); 
  if(!cfg.syncEnabled || !cfg.syncUrl) return;
  if(!navigator.onLine) return;
  const out=parseOutbox(); 
  if(out.length===0) return;

  try{
    let ok=0;
    for(const it of out){
      const headers = { 'Content-Type':'text/plain;charset=utf-8' }; // niente preflight
      if (cfg.syncToken) headers['X-Auth'] = cfg.syncToken;          // invia solo se presente

      const r = await fetch(cfg.syncUrl, {
        method:'POST',
        headers,
        body: JSON.stringify({ op:'upsert', payload: it })
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      const js = await r.json();
      if(js && js.status==='ok') ok++;
    }
    if(ok===out.length){
      saveOutbox([]);
      toast('Sync completata');
    }
  }catch(e){
    console.warn('Sync error', e);
    toast('Sync fallita');
  }
}

/* Config & init */
function initTabs(){
  $$('.tab').forEach(b=>{
    b.addEventListener('click',()=>{
      $$('.tab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const t=b.getAttribute('data-target');
      $$('.page').forEach(p=>p.classList.remove('visible'));
      $('#'+t).classList.add('visible');
      if(t==='page-recenti') updateRecentiUI();
      if(t==='page-totale') updateTotaleUI();
    });
  });
}
function eagerSetup(){
 if(!localStorage.getItem(CFG_KEY)){
     saveCFG({startFixed:'08:00',defBreakStart:'12:30',defBreakEnd:'14:00',defEnd:'17:30',
      syncEnabled:true,syncUrl:DEFAULT_ENDPOINT,syncToken:''});
   }else{
     const cfg=parseCFG();
    // MIGRA endpoint alla nuova URL se era vuoto o diverso
    if(!cfg.syncUrl || cfg.syncUrl!==DEFAULT_ENDPOINT){
      cfg.syncUrl = DEFAULT_ENDPOINT;
      cfg.syncEnabled = true;
      cfg.migratedEndpoint = APP_VER;
      saveCFG(cfg);
    }
   }
   finalizePastDays(); ensureDay(todayLocalISO()); updateOggiUI(); updateTotaleUI(); trySync();
}

document.addEventListener('DOMContentLoaded', ()=>{
  initTabs(); eagerSetup();
  $('#btnRegistra').addEventListener('click', recordAction);

  // Settings
  $('#btnSettings').addEventListener('click', ()=>{ loadSettingsUI(); $('#modalSettings').classList.add('show'); $('#modalSettings').setAttribute('aria-hidden','false'); });
  $('#btnSettingsSave').addEventListener('click', ()=>{ saveSettings(); });
  $('#btnSettingsSync').addEventListener('click', () => {
  // 1) salva subito le impostazioni (URL/Token/flag)
  saveSettings();

  // 2) se la coda è vuota, prova ad aggiungere almeno la giornata di oggi
  let out = parseOutbox();
  if (out.length === 0) {
    const t = todayLocalISO();
    const data = parseLS();
    if (data && data[t]) {
      queueOutbox(t, data[t]);
    }
  }

  // 3) ricontrolla la coda; se ancora vuota --> niente da inviare
  out = parseOutbox();
  if (out.length === 0) {
    toast('Niente da sincronizzare');
    return;
  }

  // 4) avvia la sync (il toast “Sync completata” lo mostra trySync quando finisce)
  toast('Sync avviata');
  trySync();
});
  $('#btnSettingsClose').addEventListener('click', ()=>{ $('#modalSettings').classList.remove('show'); $('#modalSettings').setAttribute('aria-hidden','true'); });
  $('#modalSettings').addEventListener('click', (e)=>{ if(e.target.id==='modalSettings'){ $('#modalSettings').classList.remove('show'); $('#modalSettings').setAttribute('aria-hidden','true'); } });

  // Main page edits
  $$('#rowsOggi .btn.ghost').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const f=btn.getAttribute('data-edit'); const t=todayLocalISO(); const d=parseLS()[t]||{};
      const cur=(d[f]&&d[f].includes(':'))?d[f]:(f==='start'?(parseCFG().startFixed||'08:00'):'12:00');
      openPicker(t,f,cur);
    });
  });
  $('#btnPickerOk').addEventListener('click', applyPicker);
  $('#btnPickerCancel').addEventListener('click', closePicker);

  // Day modal
  $('#btnDayClose').addEventListener('click', ()=>{ closeDayDetail(); updateRecentiUI(); });
  $('#modalDay').addEventListener('click', (e)=>{ if(e.target.id==='modalDay'){ closeDayDetail(); updateRecentiUI(); } });

  // Month picker & result
  $('#btnVerificaMesi').addEventListener('click', openMonthPicker);
  $('#btnMonthOk').addEventListener('click', confirmMonthPicker);
  $('#btnMonthCancel').addEventListener('click', closeMonthPicker);
  $('#modalMonth').addEventListener('click', (e)=>{ if(e.target.id==='modalMonth'){ closeMonthPicker(); } });

  // Extra sync
  $('#btnSyncNowTop').addEventListener('click', ()=>{ trySync(); updateRecentiUI(); });

  window.addEventListener('online', trySync);
});

/* Settings helpers */
function loadSettingsUI(){ const cfg=parseCFG(); $('#cfgSyncEnabled').checked=!!cfg.syncEnabled; $('#cfgSyncUrl').value=cfg.syncUrl||''; $('#cfgSyncToken').value=cfg.syncToken||''; }
function saveSettings(){ const cfg=parseCFG(); cfg.syncEnabled=$('#cfgSyncEnabled').checked; cfg.syncUrl=$('#cfgSyncUrl').value.trim(); cfg.syncToken=$('#cfgSyncToken').value.trim(); saveCFG(cfg); toast('Impostazioni salvate'); }

/* Month picker helpers */
function buildMonthOptions(){
  const sel=$('#pickMonth'); sel.innerHTML='';
  const now=new Date();
  const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  for(let i=1;i<=12;i++){
    const dt=new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const op=document.createElement('option'); op.value=ym; op.textContent=`${months[dt.getMonth()]} ${dt.getFullYear()}`;
    sel.appendChild(op);
  }
  sel.selectedIndex=0;
}
function openMonthPicker(){ buildMonthOptions(); $('#modalMonth').classList.add('show'); $('#modalMonth').setAttribute('aria-hidden','false'); }
function closeMonthPicker(){ $('#modalMonth').classList.remove('show'); $('#modalMonth').setAttribute('aria-hidden','true'); }
async function confirmMonthPicker(){
  const ym=$('#pickMonth').value; closeMonthPicker();
  let total=null; const cfg=parseCFG();
  if(cfg.syncEnabled && cfg.syncUrl && navigator.onLine){
    try{
      const r=await fetch(`${cfg.syncUrl}?op=month&ym=${encodeURIComponent(ym)}`, { headers:{'X-Auth': cfg.syncToken || ''} });
      if(r.ok){ const js=await r.json(); if(js && typeof js.totalExtraMinutes==='number') total=js.totalExtraMinutes; }
    }catch(e){}
  }
  if(total===null) total=sumMonthLocal(ym);
  $('#monthResultTitle').textContent=`Totale ${ym}`;
  const s=total>=0?'+':'−'; $('#monthResultValue').textContent=`${s}${hhmmFromMinutes(Math.abs(total))}`;
  $('#modalMonthResult').classList.add('show'); $('#modalMonthResult').setAttribute('aria-hidden','false');
}
document.addEventListener('click', (e)=>{ if(e.target && e.target.id==='btnMonthResultClose'){ $('#modalMonthResult').classList.remove('show'); $('#modalMonthResult').setAttribute('aria-hidden','true'); } });
