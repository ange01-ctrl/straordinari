// === Google Apps Script: 1 file, 12 fogli (uno per mese) + totale in fondo ===
// Struttura di ogni foglio (mese):
// A: date (YYYY-MM-DD)
// B: start
// C: breakStart
// D: breakEnd
// E: end
// F: finalized (TRUE/FALSE)
// G: netMinutes
// H: extraMinutes
// I: deviceTimestamp
// J: tzOffsetMinutes
//
// Riga 1 = intestazioni. Dalla riga 2 in giù i dati giorno per giorno.
// In fondo (riga = ultima riga di dati + 1) viene scritto "Totale" in G e la somma in H.
//
// Sicurezza semplice: usa un TOKEN opzionale passato nell'header "X-Auth".
const TOKEN = 'CAMBIA_QUESTO_SE_VUOI';

const IT_MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function sheetForDateStr(dateStr){
  // dateStr formato "YYYY-MM-DD"
  const m = parseInt(dateStr.slice(5,7), 10); // 1..12
  const name = IT_MONTHS[m-1];
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureHeader(sh){
  const header = ['date','start','breakStart','breakEnd','end','finalized','netMinutes','extraMinutes','deviceTimestamp','tzOffsetMinutes'];
  const rng = sh.getRange(1,1,1,header.length);
  const values = rng.getValues();
  if(values[0][0] !== 'date'){
    sh.clear();
    rng.setValues([header]);
  }
}

function findRowByDate(sh, dateStr){
  const last = sh.getLastRow();
  if(last < 2) return -1;
  const colA = sh.getRange(2,1,last-1,1).getValues().map(r=>r[0]);
  for(let i=0;i<colA.length;i++){
    if(String(colA[i]) === dateStr) return 2+i;
  }
  return -1;
}

function netMinutesOf(day){
  if(!(day.start && day.breakStart && day.breakEnd && day.end)) return null;
  const toMin = s => {const p=s.split(':'); return (+p[0])*60+(+p[1]);};
  return (toMin(day.breakStart)-toMin(day.start)) + (toMin(day.end)-toMin(day.breakEnd));
}

function upsertDay(payload){
  const d = payload.date; // YYYY-MM-DD
  const day = payload.day || {};
  const sh = sheetForDateStr(d);
  ensureHeader(sh);

  const net = netMinutesOf(day);
  const extra = (net != null) ? (net - 8*60) : null;

  const rowValues = [
    d, day.start||'', day.breakStart||'', day.breakEnd||'', day.end||'',
    !!day.finalized, net, extra, payload.deviceTimestamp || Date.now(), payload.tzOffsetMinutes || 0
  ];

  let row = findRowByDate(sh, d);
  if(row === -1){
    row = sh.getLastRow() + 1;
    sh.getRange(row,1,1,rowValues.length).setValues([rowValues]);
  }else{
    sh.getRange(row,1,1,rowValues.length).setValues([rowValues]);
  }

  placeOrUpdateTotalRow(sh);
  return {status:'ok'};
}

function placeOrUpdateTotalRow(sh){
  const last = sh.getLastRow();
  // Calcola ultima riga con una data in colonna A (evita di contare eventuale riga totale già esistente)
  let maxDataRow = 1;
  const colA = sh.getRange(2,1,Math.max(0,last-1),1).getValues().map(r=>r[0]);
  for(let i=0;i<colA.length;i++){
    if(String(colA[i]).length > 0) maxDataRow = 2+i;
  }
  const totalRow = maxDataRow + 1;
  // Pulisci eventuali vecchie righe totali al fondo
  if(last > totalRow){
    sh.getRange(totalRow+1, 1, last-totalRow, sh.getMaxColumns()).clearContent();
  }
  // Scrivi etichetta + formula
  sh.getRange(totalRow,7).setValue('Totale'); // colonna G
  const formula = `=SUM(H2:H${maxDataRow})`;   // somma extraMinutes
  sh.getRange(totalRow,8).setFormula(formula).setNumberFormat('[h]:mm');
}

function getLastDays(days){
  const ss = SpreadsheetApp.getActive();
  // Aggrega da tutte le 12 schede mese, se esistono
  const rows = [];
  for(const name of IT_MONTHS){
    const sh = ss.getSheetByName(name);
    if(!sh) continue;
    const data = sh.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      const r = data[i];
      if(!r[0]) continue;
      rows.push({
        date: r[0], start: r[1], breakStart: r[2], breakEnd: r[3], end: r[4], finalized: r[5],
        netMinutes: r[6], extraMinutes: r[7], deviceTimestamp: r[8], tzOffsetMinutes: r[9]
      });
    }
  }
  // Ordina per data crescente e prendi gli ultimi N entro 90 giorni
  rows.sort((a,b)=> new Date(a.date) - new Date(b.date));
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-90);
  const filtered = rows.filter(x => new Date(x.date) >= cutoff);
  return filtered.slice(-days);
}

function getMonthTotal(ym){
  // ym = "YYYY-MM"
  const year = parseInt(ym.slice(0,4),10);
  const month = parseInt(ym.slice(5,7),10); // 1..12
  const name = IT_MONTHS[month-1];
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(name);
  if(!sh) return {ym, totalExtraMinutes: 0};
  const data = sh.getDataRange().getValues();
  let total = 0;
  for(let i=1;i<data.length;i++){
    const r = data[i];
    const d = String(r[0]||'');
    if(d.startsWith(ym)){
      const extra = r[7];
      if(typeof extra === 'number') total += extra;
      else if(extra && !isNaN(parseFloat(extra))) total += parseFloat(extra);
    }
  }
  return {ym, totalExtraMinutes: total};
}

function doPost(e){
  const headerToken = e && e.headers ? e.headers['X-Auth'] : null;
  if(TOKEN && headerToken !== TOKEN) return json({status:'auth_failed'});
  const body = JSON.parse(e.postData.contents);
  if(body.op === 'upsert'){
    return json(upsertDay(body.payload));
  }
  return json({status:'noop'});
}

function doGet(e){
  const headerToken = e && e.headers ? e.headers['X-Auth'] : null;
  if(TOKEN && headerToken !== TOKEN) return json({status:'auth_failed'});

  const op = e.parameter && e.parameter.op;
  if(op === 'last'){
    const days = parseInt(e.parameter.days || '30', 10);
    return json(getLastDays(days));
  }
  if(op === 'month'){
    const ym = (e.parameter && e.parameter.ym) || '';
    return json(getMonthTotal(ym));
  }
  return json([]);
}

function json(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
