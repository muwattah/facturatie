import {norm,reference,amount,iban,date,extract,match} from './core.mjs';
const $=id=>document.getElementById(id);
const LOCAL='factuurcheck.local.v1', CONFIG='factuurcheck.config.v1';
let mode='', client=null, items=[], file=null, previewUrl='', pending=null, busy=false;
const labels={unpaid:'Nog te betalen',paying:'Betaling bezig',paid:'Betaald'};
const money=cents=>new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'}).format(cents/100);
function notice(id,message='',kind=''){const e=$(id);e.textContent=message;e.className='notice '+kind;e.hidden=!message}
function errorText(e){return e?.message||String(e)}
async function run(fn,where='global'){
  if(busy)return;busy=true;
  const buttons=[...document.querySelectorAll('button')].filter(b=>!b.disabled);
  buttons.forEach(b=>b.disabled=true);
  try{await fn()}catch(e){notice(where,errorText(e),'error')}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);$('scan').disabled=!file}
}
function readLocal(){const parsed=JSON.parse(localStorage.getItem(LOCAL)||'[]');if(!Array.isArray(parsed))throw Error('Lokale opslag is beschadigd. Wis niet zomaar je gegevens.');return parsed}
function saveLocal(rows){localStorage.setItem(LOCAL,JSON.stringify(rows))}
async function rpc(name,args){const {data,error}=await client.rpc(name,args);if(error)throw error;return data}
async function refresh(){
  if(mode==='local'){items=readLocal()}
  else if(mode==='cloud'){
    const all=[];let start=0;
    for(;;){const {data,error}=await client.from('invoices').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).range(start,start+499);if(error)throw error;all.push(...data);if(data.length<500)break;start+=500}
    items=all;
  }
  render();
}
function enter(next){
  mode=next;items=[];pending=null;
  $('setup').hidden=true;$('workspace').hidden=false;
  $('modeTitle').textContent=mode==='local'?'Lokale testmodus':'Gezinsmodus';
  $('modeText').textContent=mode==='local'?'Niet gesynchroniseerd · alleen testgegevens':'Gedeelde database · ingelogd';
  $('localTools').hidden=mode!=='local';
  notice('global');resetForm();render();
}
$('local').onclick=()=>run(async()=>{readLocal();enter('local');await refresh()},'setupMessage');
try{const c=JSON.parse(localStorage.getItem(CONFIG)||'null');if(c){$('url').value=c.url;$('key').value=c.key;$('email').value=c.email;$('cloud').open=true}}catch{}
function validateConfig(){
  const url=new URL($('url').value.trim()), key=$('key').value.trim();
  if(url.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.port||url.username||url.password)throw Error('Gebruik de HTTPS project-URL van Supabase, zonder pad.');
  if(!key.startsWith('sb_publishable_')){
    try{const encoded=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');if(JSON.parse(atob(encoded)).role!=='anon')throw Error()}
    catch{throw Error('Gebruik uitsluitend de publieke publishable of anon key.')}
  }
  return {url:url.origin,key,email:$('email').value.trim()};
}
$('login').onsubmit=e=>{e.preventDefault();run(async()=>{
  notice('setupMessage');if(!window.supabase)throw Error('Supabase-bibliotheek niet geladen. Controleer internet.');
  const config=validateConfig();client=window.supabase.createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:true}});
  const {error}=await client.auth.signInWithPassword({email:config.email,password:$('password').value});
  $('password').value='';if(error)throw error;
  const m=await client.from('household_members').select('household_id').maybeSingle();
  if(m.error||!m.data){await client.auth.signOut();throw Error('Geen toegang tot een huishouden. Vraag de beheerder om je account te koppelen.')}
  localStorage.setItem(CONFIG,JSON.stringify(config));enter('cloud');
  try{await refresh()}catch(e){notice('global','Geschiedenis niet geladen: '+errorText(e),'error')}
},'setupMessage')};
$('logout').onclick=()=>run(async()=>{
  if(mode==='cloud'&&client){const {error}=await client.auth.signOut();if(error)throw error}
  client=null;mode='';items=[];resetForm();render();$('workspace').hidden=true;$('setup').hidden=false;
});
function choose(f){
  if(busy)return;
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';file=null;
  $('preview').hidden=true;$('preview').removeAttribute('src');
  if(f){if(!f.type.startsWith('image/')||f.size>20*1024*1024){notice('scanMessage','Kies een afbeelding van maximaal 20 MB.','error')}
    else{file=f;previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl;$('preview').hidden=false;notice('scanMessage','Afbeelding klaar om uit te lezen.');}}
  $('scan').disabled=!file;pending=null;$('override').hidden=true;
}
$('camera').onchange=()=>{$('file').value='';choose($('camera').files[0])};
$('file').onchange=()=>{$('camera').value='';choose($('file').files[0])};
function applyText(){
  const x=extract($('raw').value);
  for(const k of ['invoice_no','invoice_date','reference','iban'])$(k).value=x[k]||'';
  $('amount').value=x.amount_cents?(x.amount_cents/100).toFixed(2).replace('.',','):'';
  $('supplier').value=x.supplier||'';$('verified').checked=false;pending=null;$('override').hidden=true;
  notice('result');notice('scanMessage','Controleer alle velden, ook de voorgestelde leverancier, of vul ze zelf in. Ontbrekende of foutieve informatie kun je corrigeren.','warn');
}
$('parse').onclick=()=>{if(!busy)applyText()};
$('scan').onclick=()=>run(async()=>{
  if(!file)throw Error('Kies eerst een afbeelding.');
  if(!window.Tesseract)throw Error('OCR-bibliotheek niet geladen. Controleer internet.');
  $('progress').hidden=false;$('progress').value=0;notice('scanMessage','OCR wordt geladen. De eerste scan kan langer duren.');
  let worker;
  try{
    worker=await window.Tesseract.createWorker(['nld','fra','eng'],1,{logger:m=>{if(m.status==='recognizing text'){$('progress').value=m.progress||0;notice('scanMessage','Tekst wordt uitgelezen…')}}});
    const result=await worker.recognize(file);$('raw').value=result.data.text;
    if(!result.data.text.trim())throw Error('Geen tekst gevonden. Maak een scherpere foto of vul de gegevens handmatig in.');
    applyText();
  }finally{if(worker)await worker.terminate();$('progress').hidden=true}
},'scanMessage');
function resetForm(){
  // Also called while an operation is busy, so clear the image directly.
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';file=null;
  $('preview').hidden=true;$('preview').removeAttribute('src');$('camera').value='';$('file').value='';$('scan').disabled=true;
  $('raw').value='';$('invoiceForm').reset();pending=null;$('override').hidden=true;notice('scanMessage');notice('result');
}
$('reset').onclick=()=>{if(!busy)resetForm()};
$('invoiceForm').oninput=()=>{pending=null;$('override').hidden=true;notice('result');};
for(const id of ['supplier','invoice_no','invoice_date','amount','reference','iban'])$(id).addEventListener('input',()=>{$('verified').checked=false});
function readInvoice(){
  const supplier=$('supplier').value.trim(),invoice_no=$('invoice_no').value.trim(),r=$('reference').value.trim(),i=$('iban').value.trim(),d=$('invoice_date').value;
  const ref=reference(r),account=iban(i),cents=amount($('amount').value);
  if(!norm(supplier))throw Error('Vul de leverancier in.');
  if(r&&!ref)throw Error('De gestructureerde mededeling heeft geen geldig controlegetal. Controleer of laat leeg.');
  if(i&&!account)throw Error('Ongeldig IBAN. Controleer of laat leeg.');
  if(!norm(invoice_no)&&!ref)throw Error('Factuurnummer of geldige gestructureerde mededeling is verplicht.');
  if(!cents)throw Error('Vul een geldig positief eurobedrag in, bv. 124,50.');
  if(d&&!date(d))throw Error('Ongeldige factuurdatum.');
  if(!$('verified').checked)throw Error('Bevestig eerst de gecontroleerde gegevens.');
  return {supplier,invoice_no,reference:ref,iban:account,invoice_date:d||null,amount_cents:cents};
}
function registerLocal(v,allow){
  const rows=readLocal();
  const sorted=[...rows].sort((a,b)=>['paid','paying','unpaid'].indexOf(a.status)-['paid','paying','unpaid'].indexOf(b.status));
  const exact=sorted.find(x=>match(v,x)==='exact');if(exact)return {kind:'exact',invoice:exact};
  const possible=sorted.find(x=>match(v,x)==='possible');if(possible&&!allow)return {kind:'possible',invoice:possible};
  const invoice={...v,id:crypto.randomUUID(),status:'unpaid',created_at:new Date().toISOString(),paid_at:null};saveLocal([invoice,...rows]);return {kind:'new',invoice};
}
function describe(x){return [x.supplier,money(x.amount_cents),x.invoice_no?'Nr. '+x.invoice_no:'',x.invoice_date||'',x.reference||'',labels[x.status],x.paid_at?'Bevestigd: '+new Date(x.paid_at).toLocaleString('nl-BE'):''].filter(Boolean).join(' · ')}
async function register(v,allow=false){
  notice('result');pending=null;$('override').hidden=true;
  const r=mode==='local'?registerLocal(v,allow):await rpc('register_invoice',{p:v,p_allow_possible:allow});
  const x=r.invoice;
  if(r.kind==='exact'){
    const msg=x.status==='paid'?'AL BETAALD — niet opnieuw betalen.':x.status==='paying'?'BETALING BEZIG — niet opnieuw betalen.':'AL GEREGISTREERD — controleer de bestaande factuur; maak geen tweede registratie.';
    notice('result',msg+'\n'+describe(x),x.status==='paid'?'error':'warn');
  }else if(r.kind==='possible'){
    pending=v;$('override').hidden=false;notice('result','MOGELIJKE DUBBELE FACTUUR — vergelijk het origineel met deze registratie:\n'+describe(x)+'\nRegistreer alleen apart als het aantoonbaar een andere factuur is.','warn');
  }else if(r.kind==='new'){
    notice('result','NIEUWE FACTUUR — opgeslagen als nog te betalen. Geen eerdere match in dit archief. Controleer je bank vóór betaling.\n'+describe(x),'good');
    $('verified').checked=false;
  }else throw Error('Onbekend resultaat. Controleer de geschiedenis.');
  try{await refresh()}catch(e){notice('global','Resultaat ontvangen, maar geschiedenis niet vernieuwd: '+errorText(e),'error')}
}
$('invoiceForm').onsubmit=e=>{e.preventDefault();run(()=>register(readInvoice()),'result')};
$('override').onclick=()=>run(async()=>{if(!pending)return;const v=readInvoice();if(JSON.stringify(v)!==JSON.stringify(pending))throw Error('Gegevens veranderd. Controleer opnieuw.');if(confirm('Heb je gecontroleerd dat dit echt een andere factuur is?'))await register(v,true)},'result');
function node(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function action(parent,title,cls,callback){const b=node('button',title,cls);b.onclick=callback;parent.append(b)}
function render(){
  const q=norm($('search').value),filter=$('filter').value;
  const list=items.filter(x=>(!filter||x.status===filter)&&(!q||norm([x.supplier,x.invoice_no,x.reference,x.iban].join(' ')).includes(q)));
  $('summary').textContent=items.length+' facturen · '+items.filter(x=>x.status==='paid').length+' betaald · '+items.filter(x=>x.status==='paying').length+' bezig · '+items.filter(x=>x.status==='unpaid').length+' open';
  const history=$('history');history.replaceChildren();
  if(!list.length)history.append(node('p','Geen facturen gevonden.','muted'));
  for(const x of list){
    const entry=node('article',undefined,'entry'),line=node('div',undefined,'line');
    line.append(node('h3',x.supplier+' · '+money(x.amount_cents)),node('span',labels[x.status]||x.status,'pill '+x.status));entry.append(line);
    entry.append(node('p',[x.invoice_no?'Nr. '+x.invoice_no:'',x.invoice_date||'',x.reference?'Mededeling '+x.reference:''].filter(Boolean).join(' · '),'muted'));
    if(x.paid_at)entry.append(node('small','Betaling bevestigd: '+new Date(x.paid_at).toLocaleString('nl-BE')));
    const buttons=node('div',undefined,'actions');
    if(x.status==='unpaid'){action(buttons,'Ik ga betalen','',()=>changeStatus(x,'paying'));action(buttons,'Al eerder betaald','secondary',()=>changeStatus(x,'paid'));}
    if(x.status==='paying'){
      action(buttons,'Betaling bevestigen','',()=>changeStatus(x,'paid'));
      action(buttons,'Reservering vrijgeven','secondary',()=>changeStatus(x,'unpaid'));
    }
    if(x.status==='paid')action(buttons,'Betaalstatus corrigeren','secondary',()=>changeStatus(x,'unpaid'));
    entry.append(buttons);history.append(entry);
  }
}
function changeStatus(x,next){return run(async()=>{
  const prompt=next==='paying'?'Reserveer deze factuur alleen als jij de betaling gaat uitvoeren. Controleer eerst je bank.':next==='paid'?(x.status==='unpaid'?'Is deze factuur volgens je bank al eerder betaald? Registreer dit alleen, betaal niet opnieuw.':'Bevestig je dat deze factuur effectief via je bank betaald is?'):'Zet alleen terug op nog te betalen als er geen betaling werd uitgevoerd of onderweg is. Doorgaan?';
  if(!confirm(prompt))return;
  notice('global');
  try{
    if(mode==='local'){
      const rows=readLocal(),row=rows.find(y=>y.id===x.id);
      if(!row||row.status!==x.status)throw Error('Status gewijzigd. Vernieuw de lijst.');
      row.status=next;row.paid_at=next==='paid'?new Date().toISOString():null;saveLocal(rows);
    }else await rpc('set_invoice_status',{p_id:x.id,p_expected:x.status,p_next:next});
    notice('global',next==='paying'?'Reservering bevestigd. Alleen nu mag je de betaling uitvoeren.':next==='paid'?'Betaling geregistreerd.':'Status teruggezet.','good');
  }catch(e){notice('global','Geen nieuwe bevestiging: '+errorText(e)+' Betaal niet op basis van een onbevestigde reservering.','error')}
  await refresh();
})}
$('search').oninput=render;$('filter').onchange=render;$('refresh').onclick=()=>run(refresh);
$('clearLocal').onclick=()=>run(async()=>{if(mode==='local'&&confirm('Alle lokale testfacturen definitief wissen?')){localStorage.removeItem(LOCAL);await refresh()}});
window.addEventListener('focus',()=>{if(mode&&!busy)run(refresh)});
window.addEventListener('storage',e=>{if(mode==='local'&&e.key===LOCAL&&!busy)run(refresh)});
