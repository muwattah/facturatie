import {norm,reference,amount,iban,date,extractDetailed,mergeExtractions,documentInfo} from './core.mjs?v=0.3.0';
import {documentLabels,decideRegistration,resolveReview,photoHash,savePhoto,loadPhoto,clearPhotos} from './archive.mjs?v=0.3.0';
const $=id=>document.getElementById(id);
const LOCAL='factuurcheck.local.v1', CONFIG='factuurcheck.config.v1';
let mode='', client=null, items=[], file=null, previewUrl='', pending=null, busy=false, archiveUrls=[];
function clearArchiveUrls(){archiveUrls.forEach(URL.revokeObjectURL);archiveUrls=[]}
const labels={unpaid:'Nog te betalen',paying:'Betaling bezig',paid:'Betaald'};
const money=cents=>new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'}).format(cents/100);
function notice(id,message='',kind=''){const e=$(id);e.textContent=message;e.className='notice '+kind;e.hidden=!message}
function errorText(e){return e?.message||String(e)}
async function run(fn,where='global'){
  if(busy)return;busy=true;
  const buttons=[...document.querySelectorAll('button,input,textarea,select')].filter(b=>!b.disabled);
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
  throw Error('Gezinsmodus is tijdelijk uitgeschakeld voor v0.3.0: het nieuwe fotoarchief en herinneringsdossiers moeten eerst beveiligd worden geïmplementeerd en getest in Supabase. Gebruik lokale testmodus.');
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
  client=null;mode='';items=[];resetForm();render();clearArchiveUrls();$('workspace').hidden=true;$('setup').hidden=false;
});
function choose(f){
  if(busy)return;
  $('raw').value='';$('invoiceForm').reset();$('ocrDetails').replaceChildren();$('matchDetails').replaceChildren();for(const k of Object.keys(fieldLabels))$(fieldId(k)).classList.remove('needs-review');notice('result');notice('scanMessage');
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';file=null;
  $('preview').hidden=true;$('preview').removeAttribute('src');
  if(f){if(!f.type.startsWith('image/')||f.size>20*1024*1024){notice('scanMessage','Kies een afbeelding van maximaal 20 MB.','error')}
    else{file=f;previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl;$('preview').hidden=false;notice('scanMessage','Afbeelding klaar om uit te lezen.');}}
  $('scan').disabled=!file;pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();
}
$('camera').onchange=()=>{$('file').value='';choose($('camera').files[0])};
$('file').onchange=()=>{$('camera').value='';choose($('file').files[0])};
const fieldLabels={supplier:'Leverancier',invoice_no:'Factuurnummer',invoice_date:'Factuurdatum',amount_cents:'Bedrag',reference:'Gestructureerde mededeling',iban:'IBAN'};
const fieldId=k=>k==='amount_cents'?'amount':k;
const fieldValue=(k,v)=>k==='amount_cents'?(v===null||v===''?'':(v/100).toFixed(2).replace('.',',')):v||'';
const present=(k,v)=>k==='amount_cents'?money(v):v;
function applyText(result=extractDetailed($('raw').value)){
  const {fields,details}=result;
  const info=documentInfo($('raw').value);$('document_type').value=info.document_type;$('related_ids').value=info.related_ids;$('original_amount').value=fieldValue('amount_cents',info.original_cents);$('fee_amount').value=fieldValue('amount_cents',info.fee_cents);
  const panel=$('ocrDetails');panel.replaceChildren();
  let count=0;const uncertain=[],missing=[];
  for(const [k,label] of Object.entries(fieldLabels)){
    const el=$(fieldId(k)),d=details[k],value=fields[k];
    el.value=fieldValue(k,value);el.classList.toggle('needs-review',!value||d.weak||d.ambiguous);
    if(value)count++;
    if(d.ambiguous)uncertain.push(label);
    else if(!value)missing.push(label);
    else if(d.weak)uncertain.push(label);
    if(!value||d.weak||d.ambiguous||d.alternatives.length>1){
      const div=node('div',undefined,'ocr-field');
      div.append(node('strong',label+' — '+(d.ambiguous?'meerdere mogelijke waarden':!value?'niet zeker herkend':d.weak?'voorstel controleren':'alternatieven')));
      for(const c of d.alternatives.slice(0,4)){
        const b=node('button',String(present(k,c.value)),'secondary');
        b.type='button';b.onclick=()=>{if(busy)return;el.value=fieldValue(k,c.value);el.classList.remove('needs-review');$('verified').checked=false;pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('result');};
        const choice=node('div',undefined,'ocr-choice');choice.append(b,node('small',c.source,'muted'));div.append(choice);
      }
      if(!d.alternatives.length)div.append(node('small','Geen betrouwbaar tekstfragment gevonden. Controleer de foto of vul dit veld in.','muted'));
      panel.append(div);
    }
  }
  $('verified').checked=false;pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();
  notice('result');
  const msg=count+' van 6 velden voorgesteld. Controleer alle gegevens met de originele factuur.'
    +(missing.length?'\nNiet ingevuld: '+missing.join(', ')+'.':'')
    +(uncertain.length?'\nExtra controleren: '+uncertain.join(', ')+'.':'');
  notice('scanMessage',msg,missing.length||uncertain.length?'warn':'good');
}
$('parse').onclick=()=>{if(!busy){const raw=$('raw').value;const chunks=raw.split(/^--- (?:Normale scan|Contrastscan|Verspreide tekst) ---\s*$/m).filter(t=>t.trim());applyText(chunks.length>1?mergeExtractions(chunks.map(extractDetailed)):extractDetailed(chunks[0]||raw));}};
async function decodeImage(blob){
  if(typeof createImageBitmap==='function'){
    try{return await createImageBitmap(blob)}catch{}
  }
  const url=URL.createObjectURL(blob);
  try{const image=new Image();image.src=url;await image.decode();return image}
  finally{URL.revokeObjectURL(url)}
}
async function prepareImages(blob){
  const image=await decodeImage(blob);
  try{
    const w=image.width,h=image.height;
    if(!w||!h)throw Error('Deze afbeelding kan niet worden geopend. Probeer JPG of PNG.');
    // Preserve fine print while bounding memory use on smartphones.
    const long=Math.max(w,h),scale=Math.min(3000/long,Math.sqrt(7000000/(w*h)),long<1700?Math.min(2,2200/long):1);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Afbeeldingsverwerking is niet beschikbaar.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const enhanced=document.createElement('canvas');enhanced.width=canvas.width;enhanced.height=canvas.height;
    const e=enhanced.getContext('2d',{willReadFrequently:true});if(!e)throw Error('Afbeeldingsverwerking is niet beschikbaar.');
    e.drawImage(canvas,0,0);
    const data=e.getImageData(0,0,enhanced.width,enhanced.height),pixels=data.data,hist=new Uint32Array(256);
    for(let i=0;i<pixels.length;i+=4){const gray=Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2]);hist[gray]++}
    const total=pixels.length/4;let lo=0,hi=255,n=0;
    for(;lo<255;lo++){n+=hist[lo];if(n>=total*.015)break}
    n=0;for(;hi>0;hi--){n+=hist[hi];if(n>=total*.015)break}
    if(hi-lo<35){lo=0;hi=255}
    for(let i=0;i<pixels.length;i+=4){const gray=.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2];const v=Math.max(0,Math.min(255,Math.round((gray-lo)*255/(hi-lo))));pixels[i]=pixels[i+1]=pixels[i+2]=v}
    e.putImageData(data,0,0);
    return [canvas,enhanced];
  }finally{if(typeof image.close==='function')image.close()}
}
$('scan').onclick=()=>run(async()=>{
  if(!file)throw Error('Kies eerst een afbeelding.');
  if(!window.Tesseract)throw Error('OCR-bibliotheek niet geladen. Controleer internet.');
  $('progress').hidden=false;$('progress').value=0;notice('scanMessage','Afbeelding voorbereiden en OCR laden…');
  let worker,images,step=0,passes=[],texts=[];
  try{
    images=await prepareImages(file);
    worker=await window.Tesseract.createWorker(['nld','fra','eng'],1,{logger:m=>{
      if(m.status==='recognizing text'){
        $('progress').value=Math.min(0.99,(step+(m.progress||0))/3);
        notice('scanMessage','Scanronde '+(step+1)+' van maximaal 3: tekst uitlezen…');
      }
    }});
    async function recognize(image,psm,name){
      await worker.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:'1'});
      const r=await worker.recognize(image);
      if(r.data.text.trim()){
        texts.push({name,text:r.data.text});
        passes.push(extractDetailed(r.data.text));
      }
      step++;
    }
    // Original layout first, then contrast-corrected image with automatic
    // layout. Sparse text recovers text in boxes, logos and payment slips.
    await recognize(images[0],3,'Normale scan');
    await recognize(images[1],3,'Contrastscan');
    let merged=mergeExtractions(passes);
    if(Object.values(merged.details).some(x=>!x.value||x.weak||x.ambiguous)){
      await recognize(images[1],11,'Verspreide tekst');
      merged=mergeExtractions(passes);
    }
    if(!passes.length)throw Error('Geen tekst gevonden. Maak een scherpere, rechte foto of vul de gegevens handmatig in.');
    // Keep OCR passes separate when extracting so unrelated lines do not merge.
    $('raw').value=texts.map(t=>'--- '+t.name+' ---\n'+t.text).join('\n\n');
    $('progress').value=1;applyText(merged);
  }finally{
    if(worker)await worker.terminate();
    if(images)for(const image of images){image.width=1;image.height=1}
    $('progress').hidden=true;
  }
},'scanMessage');
function resetForm(){
  // Also called while an operation is busy, so clear the image directly.
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';file=null;
  $('preview').hidden=true;$('preview').removeAttribute('src');$('camera').value='';$('file').value='';$('scan').disabled=true;
  $('raw').value='';$('invoiceForm').reset();$('ocrDetails').replaceChildren();for(const k of Object.keys(fieldLabels))$(fieldId(k)).classList.remove('needs-review');pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('scanMessage');notice('result');
}
$('reset').onclick=()=>{if(!busy)resetForm()};
$('invoiceForm').oninput=()=>{pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('result');};
for(const id of ['supplier','invoice_no','invoice_date','amount','reference','iban','document_type','related_ids','original_amount','fee_amount'])$(id).addEventListener('input',()=>{$('verified').checked=false});
async function readInvoice(){
  const supplier=$('supplier').value.trim(),invoice_no=$('invoice_no').value.trim(),r=$('reference').value.trim(),i=$('iban').value.trim(),d=$('invoice_date').value;
  const ref=reference(r),account=iban(i),cents=amount($('amount').value);
  if(!norm(supplier))throw Error('Vul de leverancier in.');
  if(r&&!ref)throw Error('De gestructureerde mededeling heeft geen geldig controlegetal. Controleer of laat leeg.');
  if(i&&!account)throw Error('Ongeldig IBAN. Controleer of laat leeg.');
  const related_ids=$('related_ids').value.trim(),document_type=$('document_type').value;
  if(!norm(invoice_no)&&!ref&&!norm(related_ids))throw Error('Factuurnummer, dossierkenmerk of geldige mededeling is verplicht.');
  if(!cents)throw Error('Vul een geldig positief eurobedrag in, bv. 124,50.');
  if(d&&!date(d))throw Error('Ongeldige factuurdatum.');
  if(!$('verified').checked)throw Error('Bevestig eerst de gecontroleerde gegevens.');
  if(!file)throw Error('Voeg altijd de originele foto toe voordat je registreert.');
  const readOptional=id=>{const t=$(id).value.trim();if(!t)return null;const n=amount(t);if(!n)throw Error('Ongeldig bedrag bij '+id);return n};
  return {supplier,invoice_no,reference:ref,iban:account,invoice_date:d||null,amount_cents:cents,document_type,related_ids,original_cents:readOptional('original_amount'),fee_cents:readOptional('fee_amount'),photo_hash:await photoHash(file)};
}
function describe(x){return [x.supplier,money(x.amount_cents),x.invoice_no?'Nr. '+x.invoice_no:'',x.related_ids?'Dossier '+x.related_ids:'',x.invoice_date||'',x.reference||'',labels[x.status],x.review_required?'Controle vereist':'',x.paid_at?'Bevestigd: '+new Date(x.paid_at).toLocaleString('nl-BE'):''].filter(Boolean).join(' · ')}
async function withLocalLock(fn){return navigator.locks?.request?navigator.locks.request('factuurcheck-write',fn):fn()}
async function register(v,choice={}){
  if(mode!=='local')throw Error('Fotoarchief is voorlopig alleen beschikbaar in de lokale testmodus.');
  notice('result');pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();
  const r=await withLocalLock(async()=>{
    const rows=readLocal();
    const outcome=decideRegistration(rows,v,{...choice,documentId:crypto.randomUUID(),invoiceId:crypto.randomUUID(),now:new Date().toISOString()});
    if(outcome.rows){await savePhoto(v.photo_hash,file);saveLocal(outcome.rows)}
    return outcome;
  });
  if(r.kind==='possible'){
    pending=v;
    notice('result','MOGELIJKE DUBBELE FACTUUR — vergelijk de dossiers. Betaal niets voordat je zeker bent.','warn');
    const list=$('matchDetails');
    for(const m of r.matches){
      const div=node('div',undefined,'ocr-field');div.append(node('strong',describe(m.invoice)),node('p',m.reasons.join(' · '),'muted'));
      const b=node('button','Koppel aan dit dossier','secondary');b.type='button';
      b.onclick=()=>run(async()=>{const current=await readInvoice();if(!pending||JSON.stringify(current)!==JSON.stringify(pending))throw Error('Gegevens gewijzigd. Controleer opnieuw.');if(confirm('Bevestig dat dit document over dezelfde schuld gaat. De app zet het dossier zo nodig op controle.'))await register(current,{linkId:m.invoice.id})},'result');
      div.append(b);appendPhotos(div,m.invoice);list.append(div);
    }
    $('override').hidden=r.matches.some(m=>m.kind!=='possible');
  }else{
    const x=r.invoice;
    if(r.kind==='review')notice('result','CONTROLE VEREIST — document bewaard in het dossier. Betaal niets opnieuw voordat je bank en leverancier het werkelijke openstaande saldo bevestigen.\n'+describe(x),'warn');
    else if(r.kind==='exact')notice('result',(x.status==='paid'?'AL BETAALD — niet opnieuw betalen.':x.status==='paying'?'BETALING BEZIG — niet opnieuw betalen.':'AL GEREGISTREERD — geen tweede schuld.')+'\n'+describe(x)+'\nFoto bewaard in het dossier.',x.status==='paid'?'error':'warn');
    else notice('result','NIEUWE FACTUUR — document en foto opgeslagen. Geen eerdere match in dit archief. Controleer je bank vóór betaling.\n'+describe(x),'good');
    appendPhotos($('matchDetails'),x);$('verified').checked=false;
  }
  await refresh();
}
$('invoiceForm').onsubmit=e=>{e.preventDefault();run(async()=>register(await readInvoice()),'result')};
$('override').onclick=()=>run(async()=>{if(!pending)return;const v=await readInvoice();if(JSON.stringify(v)!==JSON.stringify(pending))throw Error('Gegevens veranderd. Controleer opnieuw.');if(confirm('Heb je de dossiers vergeleken en is dit aantoonbaar een andere schuld?'))await register(v,{separate:true})},'result');
function node(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function action(parent,title,cls,callback){const b=node('button',title,cls);b.onclick=callback;parent.append(b)}

function appendPhotos(parent,x){
 const docs=x.documents||[];
 const gallery=node('div',undefined,'photo-gallery');
 if(!docs.length){gallery.append(node('small','Geen foto beschikbaar voor deze oude registratie. Scan het document opnieuw om het te archiveren.','muted'));parent.append(gallery);return}
 for(const d of docs){
   const fig=node('figure',undefined,'photo-card'),img=node('img'),cap=node('figcaption',documentLabels[d.document_type]+' · '+money(d.amount_cents)+(d.invoice_date?' · '+d.invoice_date:''));
   img.alt='Origineel document';img.loading='lazy';
   const b=node('button','Open originele foto','secondary');b.type='button';b.disabled=true;
   fig.append(img,cap,b);gallery.append(fig);
   loadPhoto(d.photo_hash).then(blob=>{
     if(!blob){fig.append(node('small','Foto ontbreekt in lokale opslag.','muted'));return}
     if(!fig.isConnected)return;
     const url=URL.createObjectURL(blob);archiveUrls.push(url);img.src=url;b.disabled=false;
     b.onclick=()=>{const dialog=$('photoDialog');$('fullPhoto').src=url;dialog.showModal()};
   }).catch(()=>fig.append(node('small','Foto kon niet worden geladen.','muted')));
 }
 parent.append(gallery);
}
$('closePhoto').onclick=()=>{$('photoDialog').close();$('fullPhoto').removeAttribute('src')};
function reviewDossier(x){return run(async()=>{
 if(mode!=='local')throw Error('Alleen lokale testmodus.');
 if(x.status==='paying')throw Error('Controleer eerst de lopende betaling en bevestig of annuleer de reservering.');
 const input=prompt('Controleer je bank EN de leverancier. Welk bedrag staat werkelijk nog open? Vul 0 in als niets meer verschuldigd is. Dit is niet automatisch het verschil tussen de facturen.','');
 if(input===null)return;
 const remaining=/^0(?:[,.]0{1,2})?$/.test(input.trim())?0:amount(input);
 if(remaining===null)throw Error('Vul een geldig saldo in.');
 if(!confirm('Bevestig dat je het werkelijke openstaande saldo van '+money(remaining)+' gecontroleerd hebt. Eerdere betaalgegevens blijven in het dossier.'))return;
 await withLocalLock(async()=>{
   const rows=readLocal(),current=rows.find(y=>y.id===x.id);
   if(!current||JSON.stringify(current)!==JSON.stringify(x))throw Error('Dossier is gewijzigd. Vernieuw en controleer opnieuw.');
   saveLocal(rows.map(y=>y.id===x.id?resolveReview(y,remaining,new Date().toISOString()):y));
 });
 notice('global','Controle geregistreerd. '+(remaining?'Alleen het bevestigde openstaande saldo is opnieuw beschikbaar voor betaling.':'Geen nieuwe betaling geregistreerd; dossier is afgesloten.'),'good');await refresh();
})}

function render(){
  // Release URLs belonging to removed history cards; preserve result photos.
  for(const url of archiveUrls.filter(u=>!Array.from(document.querySelectorAll('img')).some(img=>img.src===u))){URL.revokeObjectURL(url)}
  archiveUrls=archiveUrls.filter(u=>Array.from(document.querySelectorAll('img')).some(img=>img.src===u));
  const q=norm($('search').value),filter=$('filter').value;
  const list=items.filter(x=>(!filter||x.status===filter)&&(!q||norm([x.supplier,x.invoice_no,x.reference,x.iban,x.related_ids,...(x.documents||[]).flatMap(d=>[d.invoice_no,d.related_ids,d.reference,d.supplier])].join(' ')).includes(q)));
  $('summary').textContent=items.length+' facturen · '+items.filter(x=>x.status==='paid').length+' betaald · '+items.filter(x=>x.status==='paying').length+' bezig · '+items.filter(x=>x.status==='unpaid').length+' open';
  const history=$('history');history.replaceChildren();
  if(!list.length)history.append(node('p','Geen facturen gevonden.','muted'));
  for(const x of list){
    const entry=node('article',undefined,'entry'),line=node('div',undefined,'line');
    line.append(node('h3',x.supplier+' · '+money(x.amount_cents)),node('span',x.review_required?'Controle vereist':labels[x.status]||x.status,'pill '+(x.review_required?'paying':x.status)));entry.append(line);
    entry.append(node('p',[x.invoice_no?'Nr. '+x.invoice_no:'',x.invoice_date||'',x.reference?'Mededeling '+x.reference:''].filter(Boolean).join(' · '),'muted'));
    if(x.paid_at)entry.append(node('small','Betaling bevestigd: '+new Date(x.paid_at).toLocaleString('nl-BE')));
    const buttons=node('div',undefined,'actions');
    if(x.review_required){entry.append(node('p',x.review_reason||'Controleer bank en leverancier.','notice warn'));if(x.status!=='paying')action(buttons,'Openstaand saldo controleren','',()=>reviewDossier(x));}
    if(x.status==='unpaid'&&!x.review_required){action(buttons,'Ik ga betalen','',()=>changeStatus(x,'paying'));action(buttons,'Al eerder betaald','secondary',()=>changeStatus(x,'paid'));}
    if(x.status==='paying'){
      action(buttons,'Betaling bevestigen','',()=>changeStatus(x,'paid'));
      action(buttons,'Reservering vrijgeven','secondary',()=>changeStatus(x,'unpaid'));
    }
    if(x.status==='paid'&&!x.review_required)action(buttons,'Betaalstatus corrigeren','secondary',()=>changeStatus(x,'unpaid'));
    entry.append(buttons);if(x.reviews?.length){const details=node('details');details.append(node('summary','Eerdere saldocontroles'));for(const audit of x.reviews)details.append(node('p',new Date(audit.at).toLocaleString('nl-BE')+' · vorig '+money(audit.previous_amount_cents)+' ('+labels[audit.previous_status]+') · bevestigd open '+money(audit.confirmed_open_cents),'muted'));entry.append(details)}appendPhotos(entry,x);history.append(entry);
  }
}
function changeStatus(x,next){return run(async()=>{
  const prompt=next==='paying'?'Reserveer deze factuur alleen als jij de betaling gaat uitvoeren. Controleer eerst je bank.':next==='paid'?(x.status==='unpaid'?'Is deze factuur volgens je bank al eerder betaald? Registreer dit alleen, betaal niet opnieuw.':'Bevestig je dat deze factuur effectief via je bank betaald is?'):'Zet alleen terug op nog te betalen als er geen betaling werd uitgevoerd of onderweg is. Doorgaan?';
  if(!confirm(prompt))return;
  notice('global');
  try{
    if(mode==='local'){
      await withLocalLock(async()=>{const rows=readLocal(),row=rows.find(y=>y.id===x.id);
      if(!row||row.status!==x.status)throw Error('Status gewijzigd. Vernieuw de lijst.');
      if(row.review_required&&row.status!=='paying')throw Error('Controleer eerst het dossier.');
      row.status=next;row.paid_at=next==='paid'?new Date().toISOString():null;saveLocal(rows);});
    }else await rpc('set_invoice_status',{p_id:x.id,p_expected:x.status,p_next:next});
    notice('global',next==='paying'?'Reservering bevestigd. Alleen nu mag je de betaling uitvoeren.':next==='paid'?'Betaling geregistreerd.':'Status teruggezet.','good');
  }catch(e){notice('global','Geen nieuwe bevestiging: '+errorText(e)+' Betaal niet op basis van een onbevestigde reservering.','error')}
  await refresh();
})}
$('search').oninput=render;$('filter').onchange=render;$('refresh').onclick=()=>run(refresh);
$('clearLocal').onclick=()=>run(async()=>{if(mode==='local'&&confirm('Alle lokale testfacturen definitief wissen?')){localStorage.removeItem(LOCAL);await clearPhotos();await refresh()}});
window.addEventListener('focus',()=>{if(mode&&!busy)run(refresh)});
window.addEventListener('storage',e=>{if(mode==='local'&&e.key===LOCAL&&!busy)run(refresh)});
