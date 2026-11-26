import {norm,reference,amount,iban,date,extractDetailed,mergeExtractions,documentInfo} from './core.mjs?v=0.4.0';
import {documentLabels,decideRegistration,photoHash,savePhoto,loadPhoto,clearPhotos} from './archive.mjs?v=0.4.0';
import {parseEpc,scanQR,dueDate,categoryFor,isPdf,readPDF,quality,localAI} from './scanner.mjs?v=0.4.0';
import {openBalance,recordPayment,reversePayment,reconcile,dashboard} from './ledger.mjs?v=0.4.0';
import {createCloudAdapter} from './cloud.mjs?v=0.5.1';
const $=id=>document.getElementById(id);
const LOCAL='factuurcheck.local.v1', CONFIG='factuurcheck.config.v1';
let mode='', client=null, cloudAdapter=null, actorId=null, items=[], file=null, previewUrl='', pending=null, busy=false, archiveUrls=[],rotation=0;

const simpleUI=!!$('tabHome');
let currentTab=simpleUI?'home':'scan',queuedSelection=null;
function showTab(tab,scroll=true){
 if(!simpleUI)return;
 currentTab=tab;
 $('dashboard').hidden=tab!=='home';
 $('scanSection').hidden=tab!=='scan';
 $('verifySection').hidden=tab!=='scan'||!file;
 $('archiveSection').hidden=tab!=='archive';
 for(const [id,key] of [['tabHome','home'],['tabScan','scan'],['tabArchive','archive']])$(id).setAttribute('aria-pressed',String(tab===key));
 if(tab==='archive')render();
 if(scroll)window.scrollTo({top:0,behavior:'auto'});
}
if(simpleUI){$('tabHome').onclick=()=>{if(!busy)showTab('home')};
$('tabScan').onclick=$('startScan').onclick=()=>{if(!busy)showTab('scan')};
$('tabArchive').onclick=()=>{if(!busy)showTab('archive')};}
function reviewExtras(){
 if(!simpleUI)return;
 $('invoiceExtra').open=!!$('invoice_date').value||$('invoice_date').classList.contains('needs-review');
 $('reminderExtra').open=$('document_type').value!=='invoice'||!!$('original_amount').value||!!$('fee_amount').value;
}
$('document_type').addEventListener('change',()=>{if(simpleUI&&$('document_type').value!=='invoice')$('reminderExtra').open=true});


const libraryLoads=new Map();
function loadLibrary(name,url){
 if(window[name])return Promise.resolve();
 if(libraryLoads.has(name))return libraryLoads.get(name);
 const p=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=url;script.async=true;
  const timer=setTimeout(()=>{script.remove();reject(Error('Bibliotheek laden duurde te lang. Probeer opnieuw.'));},20000);
  script.onload=()=>{clearTimeout(timer);window[name]?resolve():reject(Error('Bibliotheek niet beschikbaar.'))};
  script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('Bibliotheek niet geladen. Controleer internet.'))};
  document.head.append(script);
 }).catch(e=>{libraryLoads.delete(name);throw e});
 libraryLoads.set(name,p);return p;
}
const loadOCR=()=>loadLibrary('Tesseract','https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js');
const loadQR=()=>loadLibrary('jsQR','https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');

function clearArchiveUrls(){archiveUrls.forEach(URL.revokeObjectURL);archiveUrls=[]}
const labels={unpaid:'Nog te betalen',paying:'Betaling bezig',paid:'Betaald'};
const moneyFormat=new Intl.NumberFormat('nl-BE',{style:'currency',currency:'EUR'});
const money=cents=>moneyFormat.format(cents/100);
function notice(id,message='',kind=''){const e=$(id);e.textContent=message;e.className='notice '+kind;e.hidden=!message}
function errorText(e){return e?.message||String(e)}
async function run(fn,where='global'){
  if(busy)return;busy=true;
  const buttons=[...document.querySelectorAll('button,input,textarea,select')].filter(b=>!b.disabled);
  buttons.forEach(b=>b.disabled=true);
  try{await fn()}catch(e){notice(where,errorText(e),'error')}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);if(queuedSelection){const selected=queuedSelection;queuedSelection=null;choose(selected)}$('scan').disabled=!file}
}
function readLocal(){const parsed=JSON.parse(localStorage.getItem(LOCAL)||'[]');if(!Array.isArray(parsed))throw Error('Lokale opslag is beschadigd. Wis niet zomaar je gegevens.');return parsed}
function saveLocal(rows){localStorage.setItem(LOCAL,JSON.stringify(rows))}

async function refresh(){
  if(mode==='local'){items=readLocal()}
  else if(mode==='cloud'){
    try{const updated=await cloudAdapter.load();if(JSON.stringify(updated)===JSON.stringify(items))return;items=updated}catch(e){items=[];render();throw e}
  }
  render();
}
function enter(next){
  mode=next;items=[];pending=null;archiveLimit=25;
  $('setup').hidden=true;$('workspace').hidden=false;
  $('modeTitle').textContent=mode==='local'?'Lokale testmodus':'Gezinsmodus';
  $('modeText').textContent=mode==='local'?'Niet gesynchroniseerd · alleen testgegevens':'Gedeelde database · ingelogd';
  $('localTools').hidden=mode!=='local';$('visionOptions').hidden=mode!=='cloud';$('visionConsent').checked=false;
  notice('global');resetForm();showTab('home');render();
}
$('local').onclick=()=>run(async()=>{readLocal();enter('local');await refresh()},'setupMessage');
try{const c=JSON.parse(localStorage.getItem(CONFIG)||'null');if(c){$('email').value=c.email;$('cloud').open=true}}catch{}
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
  cloudAdapter=createCloudAdapter(client);
  try{const auth=await client.auth.getUser();if(auth.error||!auth.data.user)throw Error('Ongeldige sessie.');actorId=auth.data.user.id;const initial=await cloudAdapter.load();localStorage.setItem(CONFIG,JSON.stringify({email:config.email}));enter('cloud');items=initial;render()}catch(e){await client.auth.signOut({scope:'local'});cloudAdapter=null;actorId=null;client=null;throw e}
},'setupMessage')};
$('logout').onclick=()=>run(async()=>{
  if(mode==='cloud'&&cloudAdapter)await cloudAdapter.logout();
  cloudAdapter=null;actorId=null;
  client=null;mode='';items=[];resetForm();$('history').replaceChildren();render();clearArchiveUrls();$('workspace').hidden=true;$('setup').hidden=false;
});
function choose(f){
  if(!f)return;
  if(busy){queuedSelection=f;return;}
  // iOS can supply an empty MIME type even for a normal photo or PDF.
  const ext=f.name?.split('.').pop()?.toLowerCase();
  const known={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',pdf:'application/pdf'};
  if((!f.type||f.type==='application/octet-stream')&&known[ext])f=new File([f],f.name,{type:known[ext],lastModified:f.lastModified});
  $('raw').value='';$('invoiceForm').reset();$('ocrDetails').replaceChildren();$('matchDetails').replaceChildren();for(const k of Object.keys(fieldLabels))$(fieldId(k)).classList.remove('needs-review');notice('result');notice('scanMessage');
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';file=null;
  $('preview').hidden=true;$('preview').removeAttribute('src');
  rotation=0;$('preview').style.transform='';$('openOriginal').hidden=true;$('qrDetails').replaceChildren();
  if(f){if((!f.type.startsWith('image/')&&!isPdf(f))||f.size>20*1024*1024){notice('scanMessage','Kies een afbeelding of PDF van maximaal 20 MB.','error')}
    else{file=f;previewUrl=URL.createObjectURL(file);$('openOriginal').href=previewUrl;$('openOriginal').hidden=false;if(!isPdf(f)){$('preview').src=previewUrl;$('preview').hidden=false;}notice('scanMessage','Document klaar om uit te lezen.');}}
  $('scan').disabled=!file;if(simpleUI){$('chosenFile').textContent=file?file.name:'Nog geen bestand gekozen.';$('verifySection').hidden=currentTab!=='scan'||!file;$('suggestions').open=false;$('invoiceExtra').open=false;$('reminderExtra').open=false;}pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();
}
function selectionChanged(id,other){const picked=$(id).files?.[0];if(!picked)return;$(other).value='';try{choose(picked)}catch(e){notice('scanMessage',errorText(e),'error');$('scan').disabled=!file}}
$('camera').onchange=()=>selectionChanged('camera','file');
$('file').onchange=()=>selectionChanged('file','camera');
const fieldLabels={supplier:'Leverancier',invoice_no:'Factuurnummer',invoice_date:'Factuurdatum',amount_cents:'Bedrag',reference:'Gestructureerde mededeling',iban:'IBAN'};
const fieldId=k=>k==='amount_cents'?'amount':k;
const fieldValue=(k,v)=>k==='amount_cents'?(v===null||v===''?'':(v/100).toFixed(2).replace('.',',')):v||'';
const present=(k,v)=>k==='amount_cents'?money(v):v;
function applyText(result=extractDetailed($('raw').value)){
  const {fields,details}=result;
  $('due_date').value=dueDate($('raw').value);$('category').value=categoryFor(fields.supplier);
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
  notice('scanMessage',msg,missing.length||uncertain.length?'warn':'good');reviewExtras();if(simpleUI&&uncertain.length)$('suggestions').open=true;
}
$('parse').onclick=()=>{if(!busy){const raw=$('raw').value;const chunks=raw.split(/^--- (?:Normale scan|Contrastscan|Verspreide tekst|PDF-pagina \d+|PDF OCR \d+) ---\s*$/m).filter(t=>t.trim());applyText(chunks.length>1?mergeExtractions(chunks.map(extractDetailed)):extractDetailed(chunks[0]||raw));}};
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
    if(rotation%180){const cw=canvas.width;canvas.width=canvas.height;canvas.height=cw;}
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(image,-w*scale/2,-h*scale/2,w*scale,h*scale);ctx.restore();
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
$('rotate').onclick=()=>{if(!file||isPdf(file))return;rotation=(rotation+90)%360;$('preview').style.transform='rotate('+rotation+'deg)';$('verified').checked=false;notice('scanMessage','Foto gedraaid. Scan opnieuw.','warn')};

// AI sends a bounded JPEG only after explicit consent. No automatic payments.
async function visionPage(canvas){
 const c=document.createElement('canvas'),scale=Math.min(1,1800/Math.max(canvas.width,canvas.height));
 c.width=Math.max(1,Math.round(canvas.width*scale));c.height=Math.max(1,Math.round(canvas.height*scale));
 c.getContext('2d').drawImage(canvas,0,0,c.width,c.height);
 let image=c.toDataURL('image/jpeg',.85);if(image.length>2800000)image=c.toDataURL('image/jpeg',.60);
 c.width=c.height=1;if(image.length>2800000)throw Error('Foto te groot voor AI.');
 const {data,error}=await client.functions.invoke('factuurcheck-vision',{body:{image,consent:true}});
 if(error){let msg='AI niet beschikbaar; OCR blijft bruikbaar.';try{const body=await error.context?.json();if(typeof body?.error==='string')msg=body.error}catch{}throw Error(msg)}
 if(!data?.fields)throw Error('Geen AI-resultaat.');
 return data.fields;
}
const visionLabels={supplier:'Leverancier',invoice_no:'Factuurnummer',invoice_date:'Factuurdatum',due_date:'Vervaldatum',amount:'Te betalen bedrag',reference:'Gestructureerde mededeling',iban:'IBAN',document_type:'Soort document',related_ids:'Oorspronkelijke nummers / dossier',original_amount:'Oorspronkelijk bedrag',fee_amount:'Herinneringskosten'};
function cleanVision(k,v){
 if(typeof v!=='string'||!v.trim())return '';
 if(['amount','original_amount','fee_amount'].includes(k)){const n=amount(v);return n?fieldValue('amount_cents',n):''}
 if(['invoice_date','due_date'].includes(k))return date(v);
 if(k==='reference')return reference(v);
 if(k==='iban')return iban(v);
 if(k==='document_type')return ['invoice','reminder','collection','credit'].includes(v)?v:'';
 return v.trim().slice(0,k==='related_ids'?300:k==='supplier'?180:100);
}
function compareVision(pages){
 const panel=node('div',undefined,'ocr-field');panel.append(node('strong','Vision AI — vergelijking met OCR'));
 let added=0,conflicts=0,agree=0;
 for(const [k,label] of Object.entries(visionLabels)){
   const el=$(k),values=[...new Set(pages.map(p=>cleanVision(k,p[k])).filter(Boolean))];
   if(!values.length)continue;
   const current=cleanVision(k,el.value);
   if(values.length===1&&current&&norm(current)===norm(values[0])){agree++;continue}
   // Document type defaults to invoice; never silently replace it or any existing value.
   if(values.length===1&&!current&&k!=='document_type'){
     el.value=values[0];el.classList.add('needs-review');added++;
     panel.append(node('p',label+': '+values[0]+' — door AI aangevuld; controleer origineel.'));
   }else{
     conflicts++;el.classList.add('needs-review');
     panel.append(node('p',label+' — OCR / formulier: '+(el.value||'leeg')+'; kies alleen wat op de factuur staat.'));
     for(const v of values){const btn=node('button',v,'secondary');btn.type='button';btn.onclick=()=>{if(busy)return;el.value=v;el.classList.add('needs-review');reviewExtras();$('verified').checked=false;pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('result')};panel.append(btn)}
   }
 }
 $('verified').checked=false;pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('result');
 panel.append(node('small',agree+' gelijk, '+added+' aangevuld, '+conflicts+' te vergelijken. AI kan zich vergissen.','muted'));
 $('qrDetails').append(panel);
 if(simpleUI&&conflicts)$('suggestions').open=true;reviewExtras();return {added,conflicts,agree};
}

function addScanSuggestion(label,values){
 const div=node('div',undefined,'ocr-field');div.append(node('strong',label));
 for(const [k,v] of Object.entries(values)){
   if(!v||!['supplier','invoice_no','invoice_date','amount_cents','reference','iban','due_date'].includes(k))continue;
   const el=$(fieldId(k)),btn=node('button',String(present(k,v)),'secondary');btn.type='button';
   btn.onclick=()=>{if(busy)return;el.value=fieldValue(k,v);el.classList.add('needs-review');$('verified').checked=false;pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('result')};
   div.append(node('p',(fieldLabels[k]||'Vervaldatum')+': '),btn);
 }
 $('qrDetails').append(div);
}
$('ai').onclick=()=>run(async()=>{
 if(!$('raw').value.trim())throw Error('Scan eerst een document of plak de OCR-tekst.');
 notice('scanMessage','Lokale AI wordt voorbereid. Dit kan een modeldownload vereisen.');
 const result=await localAI($('raw').value);addScanSuggestion('AI-voorstellen — controleer met origineel',result);
 notice('scanMessage','AI-voorstellen toegevoegd. Klik alleen op waarden die overeenkomen met je document.','warn');
},'scanMessage');
$('scan').onclick=()=>run(async()=>{
 if(!file)throw Error('Kies eerst een document.');
 $('progress').hidden=false;$('progress').value=0;$('qrDetails').replaceChildren();notice('scanMessage','Document voorbereiden…');
 let worker,images,step=0,passes=[],texts=[],warnings=[],qr=[],vision=[],visionError='';
 const useVision=mode==='cloud'&&$('visionConsent').checked;
 async function tryVision(canvas,index,total){if(!useVision||visionError)return;if(index>3)return;try{notice('scanMessage','AI leest pagina '+index+'…');vision.push(await visionPage(canvas))}catch(e){visionError=errorText(e)}}
 try{
   async function getWorker(){
     if(worker)return worker;
     await loadOCR();
     worker=await window.Tesseract.createWorker(['nld','fra','eng'],1,{logger:m=>{
       if(m.status==='recognizing text')notice('scanMessage','OCR-ronde '+(step+1)+': tekst uitlezen…');
     }});return worker;
   }
   function addText(text,name){if(text.trim()){texts.push({name,text});passes.push(extractDetailed(text))}}
   async function recognize(image,psm,name){
     const w=await getWorker();await w.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:'1'});
     const r=await w.recognize(image);addText(r.data.text,name);step++;
   }
   async function qrScan(canvas){try{if(typeof window.BarcodeDetector!=='function')await loadQR();let q=await scanQR(canvas);if(!q&&typeof window.jsQR!=='function'){await loadQR();q=await scanQR(canvas)}if(q&&!qr.some(x=>JSON.stringify(x)===JSON.stringify(q)))qr.push(q)}catch{}}
   if(isPdf(file)){
     await readPDF(file,async({canvas,text,index,total})=>{
       notice('scanMessage','PDF-pagina '+index+' van '+total+' uitlezen…');
       if(index===1){$('preview').src=canvas.toDataURL('image/jpeg',.82);$('preview').hidden=false;}
       const aiTask=tryVision(canvas,index,total);
       try{
         await qrScan(canvas);addText(text,'PDF-pagina '+index);
         if(useVision&&index===4)warnings.push('AI bekijkt maximaal de eerste 3 PDF-pagina’s; OCR leest alle pagina’s.');
         const extracted=extractDetailed(text).fields;
         if(text.trim().length<80||!extracted.amount_cents||(!extracted.invoice_no&&!extracted.reference))await recognize(canvas,3,'PDF OCR '+index);
       }finally{await aiTask;}
       $('progress').value=index/total;
     });
   }else{
     images=await prepareImages(file);const q=quality(images[0]);
     if(q.dark)warnings.push('Foto lijkt donker.');if(q.soft)warnings.push('Foto lijkt mogelijk onscherp.');if(q.small)warnings.push('Foto heeft een lage resolutie.');
     const aiTask=tryVision(images[0],1,1);
     const needsMore=()=>!passes.length||Object.values(mergeExtractions(passes).details).some(x=>!x.value||x.weak||x.ambiguous);
     try{
       const qrTask=(async()=>{await qrScan(images[0]);if(!qr.length)await qrScan(images[1])})();
       try{
         await recognize(images[0],3,'Normale scan');$('progress').value=.33;
         if(needsMore()){await recognize(images[1],3,'Contrastscan');$('progress').value=.66}
         if(needsMore())await recognize(images[1],11,'Verspreide tekst');
       }finally{await qrTask}
     }finally{await aiTask;}
   }
   if(!passes.length&&!qr.length&&!vision.length)throw Error('Geen leesbare gegevens gevonden. Kies een scherpere foto of vul handmatig in.');
   $('raw').value=texts.map(t=>'--- '+t.name+' ---\n'+t.text).join('\n\n');
   const merged=passes.length?mergeExtractions(passes):extractDetailed('');applyText(merged);
   for(const q of qr)addScanSuggestion('EPC-betaal-QR — controleer rekening en bedrag',q);
   if(vision.length){const v=compareVision(vision);warnings.push('Vision AI: '+v.added+' aangevuld, '+v.conflicts+' te vergelijken, '+v.agree+' gelijk. Controleer alles met het origineel.');}
   if(visionError)warnings.push(visionError);
   if(simpleUI&&qr.length)$('suggestions').open=true;
   if(warnings.length||qr.length)notice('scanMessage',$('scanMessage').textContent+'\n'+warnings.join(' ')+(qr.length?'\nBetaal-QR gevonden. Klik op de juiste voorstellen.':''),'warn');
   $('progress').value=1;
   if(simpleUI){$('verifySection').hidden=false;reviewExtras();$('verifySection').scrollIntoView({behavior:'smooth',block:'start'});}
 }finally{
   if(worker)await worker.terminate();
   if(images)for(const image of images){image.width=1;image.height=1}
   $('progress').hidden=true;
 }
},'scanMessage');
function resetForm(){
  queuedSelection=null;if(simpleUI){$('verifySection').hidden=true;$('chosenFile').textContent='Nog geen bestand gekozen.';$('suggestions').open=false;$('invoiceExtra').open=false;$('reminderExtra').open=false;}
  // Also called while an operation is busy, so clear the image directly.
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';file=null;
  $('preview').hidden=true;$('preview').removeAttribute('src');$('preview').style.transform='';rotation=0;$('openOriginal').hidden=true;$('qrDetails').replaceChildren();$('camera').value='';$('file').value='';$('scan').disabled=true;
  $('raw').value='';$('invoiceForm').reset();$('ocrDetails').replaceChildren();for(const k of Object.keys(fieldLabels))$(fieldId(k)).classList.remove('needs-review');pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('scanMessage');notice('result');
}
$('reset').onclick=()=>{if(!busy)resetForm()};
$('invoiceForm').oninput=()=>{pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();notice('result');};
for(const id of ['supplier','invoice_no','invoice_date','amount','reference','iban','document_type','related_ids','original_amount','fee_amount','due_date','category'])$(id).addEventListener('input',()=>{$('verified').checked=false});
async function readInvoice(){
  const supplier=$('supplier').value.trim(),invoice_no=$('invoice_no').value.trim(),r=$('reference').value.trim(),i=$('iban').value.trim(),d=$('invoice_date').value;
  const ref=reference(r),account=iban(i),cents=amount($('amount').value);
  if(!norm(supplier))throw Error('Vul de leverancier in.');
  if(r&&!ref)throw Error('De gestructureerde mededeling heeft geen geldig controlegetal. Controleer of laat leeg.');
  if(i&&!account)throw Error('Ongeldig IBAN. Controleer of laat leeg.');
  const related_ids=$('related_ids').value.trim(),document_type=$('document_type').value,due_date=$('due_date').value||null,category=$('category').value;
  if(due_date&&!date(due_date))throw Error('Ongeldige vervaldatum.');
  if(!norm(invoice_no)&&!ref&&!norm(related_ids))throw Error('Factuurnummer, dossierkenmerk of geldige mededeling is verplicht.');
  if(!cents)throw Error('Vul een geldig positief eurobedrag in, bv. 124,50.');
  if(d&&!date(d))throw Error('Ongeldige factuurdatum.');
  if(!$('verified').checked)throw Error('Bevestig eerst de gecontroleerde gegevens.');
  if(!file)throw Error('Voeg altijd de originele foto of PDF toe voordat je registreert.');
  const readOptional=id=>{const t=$(id).value.trim();if(!t)return null;const n=amount(t);if(!n)throw Error('Ongeldig bedrag bij '+id);return n};
  return {supplier,invoice_no,reference:ref,iban:account,invoice_date:d||null,amount_cents:cents,document_type,related_ids,due_date,category,file_type:isPdf(file)?'application/pdf':file.type,original_cents:readOptional('original_amount'),fee_cents:readOptional('fee_amount'),photo_hash:await photoHash(file)};
}
function describe(x){return [x.supplier,money(x.amount_cents),x.invoice_no?'Nr. '+x.invoice_no:'',x.related_ids?'Dossier '+x.related_ids:'',x.invoice_date||'',x.reference||'',labels[x.status],x.review_required?'Controle vereist':'',x.paid_at?'Bevestigd: '+new Date(x.paid_at).toLocaleString('nl-BE'):''].filter(Boolean).join(' · ')}
async function withLocalLock(fn){return navigator.locks?.request?navigator.locks.request('factuurcheck-write',fn):fn()}
async function register(v,choice={}){
  if(!['local','cloud'].includes(mode))throw Error('Open eerst een archief.');
  notice('result');pending=null;$('override').hidden=true;$('matchDetails').replaceChildren();
  const r=mode==='cloud'?await cloudAdapter.action({action:'register',document:v,...choice},file):await withLocalLock(async()=>{
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
    else if(r.kind==='exact')notice('result',(x.status==='paid'?(x.closed_reason==='reconciled'?'AFGESLOTEN — geen bevestigd openstaand saldo.':'AL BETAALD — niet opnieuw betalen.'):x.status==='paying'?'BETALING BEZIG — niet opnieuw betalen.':'AL GEREGISTREERD — geen tweede schuld.')+'\n'+describe(x)+'\nOrigineel bestand bewaard in het dossier.',x.status==='paid'?'error':'warn');
    else notice('result','NIEUWE FACTUUR — document en foto opgeslagen. Geen eerdere match in dit archief. Controleer je bank vóór betaling.\n'+describe(x),'good');
    appendPhotos($('matchDetails'),x);$('verified').checked=false;
  }
  await refresh();$('result').scrollIntoView({behavior:'smooth',block:'center'});
}
$('invoiceForm').onsubmit=e=>{e.preventDefault();run(async()=>register(await readInvoice()),'result')};
$('override').onclick=()=>run(async()=>{if(!pending)return;const v=await readInvoice();if(JSON.stringify(v)!==JSON.stringify(pending))throw Error('Gegevens veranderd. Controleer opnieuw.');if(confirm('Heb je de dossiers vergeleken en is dit aantoonbaar een andere schuld?'))await register(v,{separate:true})},'result');
function node(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function action(parent,title,cls,callback){const b=node('button',title,cls);b.onclick=callback;parent.append(b)}

function appendPhotos(parent,x){
 const docs=x.documents||[];
 if(!docs.length){parent.append(node('small','Geen origineel document beschikbaar.','muted'));return}
 const gallery=node('div',undefined,'photo-gallery');
 const sourceMode=mode,sourceAdapter=cloudAdapter;
 for(const d of docs){
   const fig=node('figure',undefined,'photo-card');
   const cap=node('figcaption',documentLabels[d.document_type]+' · '+money(d.amount_cents)+(d.invoice_date?' · '+d.invoice_date:''));
   const pdf=d.file_type==='application/pdf';
   const b=node('button',pdf?'PDF laden':'Foto openen','secondary');b.type='button';
   fig.append(cap,b);gallery.append(fig);
   b.onclick=async()=>{
     if(b.disabled||busy)return;
     b.disabled=true;b.textContent='Laden…';
     try{
       const blob=await (sourceMode==='cloud'?sourceAdapter.original(d.photo_hash):loadPhoto(d.photo_hash));
       if(!blob)throw Error('Origineel ontbreekt.');
       if(!fig.isConnected||mode!==sourceMode||cloudAdapter!==sourceAdapter)return;
       const url=URL.createObjectURL(blob);archiveUrls.push(url);b.dataset.archiveUrl=url;
       if(pdf){
         const link=node('a','Open originele PDF');link.href=url;link.target='_blank';link.rel='noopener';link.dataset.archiveUrl=url;fig.append(link);b.hidden=true;
       }else{
         b.textContent='Foto bekijken';
         const open=()=>{const dialog=$('photoDialog');$('fullPhoto').src=url;if(!dialog.open)dialog.showModal()};
         b.onclick=open;open();
       }
     }catch(e){b.textContent='Opnieuw proberen';fig.append(node('small',errorText(e),'muted'))}
     finally{b.disabled=false}
   };
 }
 parent.append(gallery);
}
$('closePhoto').onclick=()=>{$('photoDialog').close();$('fullPhoto').removeAttribute('src')};
function reviewDossier(x){return run(async()=>{
 
 if(x.status==='paying')throw Error('Controleer eerst de lopende betaling en bevestig of annuleer de reservering.');
 const input=prompt('Controleer je bank EN de leverancier. Welk bedrag staat werkelijk nog open? Vul 0 in als niets meer verschuldigd is. Dit is niet automatisch het verschil tussen de facturen.','');
 if(input===null)return;
 const remaining=/^0(?:[,.]0{1,2})?$/.test(input.trim())?0:amount(input);
 if(remaining===null)throw Error('Vul een geldig saldo in.');
 if(!confirm('Bevestig dat je het werkelijke openstaande saldo van '+money(remaining)+' gecontroleerd hebt. Eerdere betaalgegevens blijven in het dossier.'))return;
 if(mode==='cloud')await cloudAdapter.action({action:'reconcile',invoiceId:x.id,cents:remaining,bankChecked:true,reason:x.documents?.at(-1)?.document_type==='credit'?'credit':'balance',note:'Saldo bevestigd na controle'});
 else await withLocalLock(async()=>{
   const rows=readLocal(),current=rows.find(y=>y.id===x.id);
   if(!current||JSON.stringify(current)!==JSON.stringify(x))throw Error('Dossier is gewijzigd. Vernieuw en controleer opnieuw.');
   saveLocal(rows.map(y=>y.id===x.id?reconcile(y,remaining,new Date().toISOString(),'Saldo bevestigd na controle',x.documents?.at(-1)?.document_type==='credit'?'credit':'balance'):y));
 });
 notice('global','Controle geregistreerd. '+(remaining?'Alleen het bevestigde openstaande saldo is opnieuw beschikbaar voor betaling.':'Geen nieuwe betaling geregistreerd; dossier is afgesloten.'),'good');await refresh();
})}


function localToday(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function renderDashboard(){
 const today=localToday(),d=dashboard(items,today.slice(0,7),today);
 $('dashOpen').textContent=money(d.open);$('dashPaid').textContent=money(d.paid);$('dashReview').textContent=d.review;$('dashLate').textContent=d.overdue;
 $('dashSoon').textContent=d.soon+' binnen 7 dagen · '+d.partial+' gedeeltelijk betaald';
 const chart=$('dashCategories');chart.replaceChildren();
 for(const [name,value] of Object.entries(d.categories).sort((a,b)=>b[1]-a[1])){
   const line=node('div',undefined,'dash-bar');line.append(node('span',name),node('strong',money(value)));const track=node('div',undefined,'bar-track'),fill=node('div',undefined,'bar-fill');fill.style.width=(value/Math.max(1,d.paid)*100)+'%';track.append(fill);chart.append(line,track);
 }
 if(!Object.keys(d.categories).length)chart.append(node('p','Nog geen geregistreerde betalingen deze maand.','muted'));
 const months=$('dashMonths');months.replaceChildren();
 const max=Math.max(1,...Object.values(d.months));
 for(const [m,v] of Object.entries(d.months).sort().slice(-6)){const line=node('div',undefined,'dash-bar');line.append(node('span',m),node('strong',money(v)));const track=node('div',undefined,'bar-track'),fill=node('div',undefined,'bar-fill');fill.style.width=(v/max*100)+'%';track.append(fill);months.append(line,track)}
 if(!months.childNodes.length)months.append(node('p','Nog geen betaalhistoriek.','muted'));
}
async function mutateRow(x,fn){
 if(mode!=='local')throw Error('Deze actie is alleen lokaal beschikbaar.');
 await withLocalLock(async()=>{const rows=readLocal(),row=rows.find(y=>y.id===x.id);if(!row||JSON.stringify(row)!==JSON.stringify(x))throw Error('Dossier gewijzigd. Vernieuw en controleer opnieuw.');saveLocal(rows.map(y=>y.id===x.id?fn(row):y))});
 await refresh();
}
function addPayment(x,partial=false){return run(async()=>{
 const balance=openBalance(x);if(balance<=0)throw Error('Geen openstaand saldo.');
 const input=partial?prompt('Werkelijk betaald bedrag in euro (max. '+money(balance)+')',''):(balance/100).toFixed(2);
 if(input===null)return;const cents=amount(input);if(!cents||cents>balance)throw Error('Ongeldig betaalbedrag.');
 const when=prompt('Datum van de werkelijke bankbetaling (JJJJ-MM-DD)',localToday());if(when===null)return;if(!date(when)||when>localToday())throw Error('Ongeldige betalingsdatum.');
 const note=prompt('Optioneel: betalingsbewijsnummer of opmerking','');if(note===null)return;
 if(!confirm('Bevestig dat '+money(cents)+' daadwerkelijk betaald is. Er wordt geen overschrijving uitgevoerd.'))return;
 if(mode==='cloud'){await cloudAdapter.action({action:'payment',invoiceId:x.id,reservationId:x.reservation?.id,cents,paymentDate:when,note,bankChecked:true,historical:x.status!=='paying'});await refresh()}
 else await mutateRow(x,row=>recordPayment(row,cents,new Date().toISOString(),crypto.randomUUID(),note,when));
 notice('global','Betaling geregistreerd. Resterend saldo: '+money(balance-cents),'good');
})}
function flagReview(x){return run(async()=>{if(confirm('Zet het dossier op controle om het werkelijke saldo te bevestigen?'))await mutateRow(x,row=>({...row,review_required:true,review_reason:'Oude betaalstatus moet worden gecontroleerd.'}))})}
function appendPayments(entry,x){
 if(!(x.payments||[]).length)return;
 const details=node('details');details.append(node('summary','Betalingshistoriek'));
 for(const p of x.payments){const reversed=(x.payments||[]).some(r=>r.kind==='reversal'&&r.reverses===p.id);details.append(node('p',(p.kind==='reversal'?'Correctie: ':'Betaling: ')+money(p.cents)+' · '+(p.payment_date||p.at.slice(0,10))+(reversed?' · gecorrigeerd':'')+(p.note?' · '+p.note:''),'muted'));if(p.kind==='payment'&&!reversed&&!x.review_required&&x.status!=='paying')action(details,'Corrigeer deze betaling','secondary',()=>run(async()=>{if(confirm('Bevestig dat deze registratie fout was. Het dossier wordt geblokkeerd tot je bankcontrole.')){if(mode==='cloud'){await cloudAdapter.action({action:'reverse',invoiceId:x.id,paymentId:p.id,bankChecked:true});await refresh()}else await mutateRow(x,row=>reversePayment(row,p.id,new Date().toISOString()))}}))}
 entry.append(details);
}

let archiveLimit=25;
function render(){
  renderDashboard();
  if(simpleUI&&currentTab!=='archive')return;
  // Release URLs belonging to removed history cards; preserve result photos.
  for(const url of archiveUrls.filter(u=>!Array.from(document.querySelectorAll('img,[data-archive-url]')).some(img=>img.src===u||img.dataset.archiveUrl===u))){URL.revokeObjectURL(url)}
  archiveUrls=archiveUrls.filter(u=>Array.from(document.querySelectorAll('img,[data-archive-url]')).some(img=>img.src===u||img.dataset.archiveUrl===u));
  const q=norm($('search').value),filter=$('filter').value,cat=$('categoryFilter').value;
  const list=items.filter(x=>(!cat||(x.category||'Overige')===cat)&&(!filter||(filter==='review'?x.review_required:filter==='partial'?!x.review_required&&openBalance(x)>0&&(x.payments||[]).some(p=>p.kind==='payment'&&!(x.payments||[]).some(r=>r.kind==='reversal'&&r.reverses===p.id)):!x.review_required&&x.status===filter))&&(!q||norm([x.supplier,x.invoice_no,x.reference,x.iban,x.related_ids,...(x.documents||[]).flatMap(d=>[d.invoice_no,d.related_ids,d.reference,d.supplier])].join(' ')).includes(q)));
  $('summary').textContent=items.length+' facturen · '+items.filter(x=>x.status==='paid'&&!x.review_required).length+' betaald · '+items.filter(x=>x.status==='paying'&&!x.review_required).length+' bezig · '+items.filter(x=>x.status==='unpaid'&&!x.review_required).length+' open · '+items.filter(x=>x.review_required).length+' controleren';
  const history=$('history');history.replaceChildren();
  for(const url of archiveUrls.filter(u=>!Array.from(document.querySelectorAll('img,[data-archive-url]')).some(img=>img.src===u||img.dataset.archiveUrl===u)))URL.revokeObjectURL(url);
  archiveUrls=archiveUrls.filter(u=>Array.from(document.querySelectorAll('img,[data-archive-url]')).some(img=>img.src===u||img.dataset.archiveUrl===u));
  if(!list.length)history.append(node('p','Geen facturen gevonden.','muted'));
  for(const x of list.slice(0,archiveLimit)){
    const outer=node('article',undefined,'entry entry-layout'),entry=node('div'),line=node('div',undefined,'line');
    line.append(node('h3',x.supplier+' · '+money(openBalance(x))+' open'),node('span',x.review_required?'Controle vereist':(x.status==='paid'&&x.closed_reason==='reconciled'?'Afgesloten':x.status==='unpaid'&&openBalance(x)>0&&(x.payments||[]).some(p=>p.kind==='payment')?'Gedeeltelijk betaald':labels[x.status]||x.status),'pill '+(x.review_required?'paying':x.status)));entry.append(line);
    entry.append(node('p',[x.invoice_no?'Nr. '+x.invoice_no:'',x.invoice_date||'',x.reference?'Mededeling '+x.reference:''].filter(Boolean).join(' · '),'muted'));
    entry.append(node('p','Oorspronkelijk geregistreerd: '+money(x.amount_cents)+(x.due_date?' · Vervalt '+x.due_date:'')+' · '+(x.category||'Overige'),'muted'));
    if(x.paid_at)entry.append(node('small','Betaling bevestigd: '+new Date(x.paid_at).toLocaleString('nl-BE')));
    const buttons=node('div',undefined,'actions');
    if(x.review_required){entry.append(node('p',x.review_reason||'Controleer bank en leverancier.','notice warn'));if(x.status!=='paying')action(buttons,'Openstaand saldo controleren','',()=>reviewDossier(x));}
    if(x.status==='unpaid'&&!x.review_required){action(buttons,'Ik ga betalen','',()=>changeStatus(x,'paying'));action(buttons,'Al eerder betaald','secondary',()=>addPayment(x));action(buttons,'Deelbetaling registreren','secondary',()=>addPayment(x,true));}
    if(x.status==='paying'&&mode==='cloud'&&x.reservation?.actor_id!==actorId){entry.append(node('p','Betaling gereserveerd door een ander gezinslid.','notice warn'))}
    if(x.status==='paying'&&(mode==='local'||x.reservation?.actor_id===actorId)){
      action(buttons,'Betaling bevestigen','',()=>addPayment(x));action(buttons,'Deelbetaling bevestigen','secondary',()=>addPayment(x,true));
      action(buttons,'Reservering vrijgeven','secondary',()=>changeStatus(x,'unpaid'));
    }
    if(mode==='local'&&x.status==='paid'&&!x.review_required&&!(x.payments||[]).length)action(buttons,'Oude betaalstatus controleren','secondary',()=>flagReview(x));
    entry.append(buttons);appendPayments(entry,x);if(x.reviews?.length){const details=node('details');details.append(node('summary','Eerdere saldocontroles'));for(const audit of x.reviews)details.append(node('p',new Date(audit.at).toLocaleString('nl-BE')+' · vorig '+money(audit.previous_amount_cents)+' ('+labels[audit.previous_status]+') · bevestigd open '+money(audit.confirmed_open_cents),'muted'));entry.append(details)}outer.append(entry);const photos=node('aside');appendPhotos(photos,x);outer.append(photos);history.append(outer);
  }
  if(list.length>archiveLimit){const more=node('button','Meer facturen tonen ('+(list.length-archiveLimit)+')','secondary');more.onclick=()=>{archiveLimit+=25;render()};history.append(more)}
}
function changeStatus(x,next){return run(async()=>{
  const prompt=next==='paying'?'Reserveer deze factuur alleen als jij de betaling gaat uitvoeren. Controleer eerst je bank.':next==='paid'?(x.status==='unpaid'?'Is deze factuur volgens je bank al eerder betaald? Registreer dit alleen, betaal niet opnieuw.':'Bevestig je dat deze factuur effectief via je bank betaald is?'):'Zet alleen terug op nog te betalen als er geen betaling werd uitgevoerd of onderweg is. Doorgaan?';
  if(!confirm(prompt))return;
  notice('global');
  try{
    if(mode==='local'){
      await withLocalLock(async()=>{const rows=readLocal(),row=rows.find(y=>y.id===x.id);
      if(!row||JSON.stringify(row)!==JSON.stringify(x))throw Error('Dossier gewijzigd. Vernieuw de lijst.');
      if(row.review_required&&row.status!=='paying')throw Error('Controleer eerst het dossier.');
      if(next==='paying'&&openBalance(row)<=0)throw Error('Geen openstaand saldo.');row.status=next;row.paid_at=null;saveLocal(rows);});
    }else{
      if(!['paying','unpaid'].includes(next))throw Error('Ongeldige statuswijziging.');
      await cloudAdapter.action({action:next==='paying'?'reserve':'release',invoiceId:x.id,reservationId:x.reservation?.id,bankChecked:true});
    }
    notice('global',next==='paying'?'Reservering bevestigd. Alleen nu mag je de betaling uitvoeren.':next==='paid'?'Betaling geregistreerd.':'Status teruggezet.','good');
  }catch(e){notice('global','Geen nieuwe bevestiging: '+errorText(e)+' Betaal niet op basis van een onbevestigde reservering.','error')}
  await refresh();
})}
function filterArchive(){archiveLimit=25;render()}
$('categoryFilter').onchange=filterArchive;$('search').oninput=filterArchive;$('filter').onchange=filterArchive;$('refresh').onclick=()=>run(refresh);
$('clearLocal').onclick=()=>run(async()=>{if(mode==='local'&&confirm('Alle lokale testfacturen definitief wissen?')){await withLocalLock(async()=>{localStorage.removeItem(LOCAL);await clearPhotos()});await refresh()}});
// A returning iOS file picker fires focus before change. Never lock the scan form on focus or polling.
window.addEventListener('focus',()=>{if(mode&&!busy&&simpleUI&&currentTab!=='scan')run(refresh)});
setInterval(()=>{if(mode==='cloud'&&!busy&&simpleUI&&currentTab!=='scan')run(refresh)},30000);
window.addEventListener('storage',e=>{if(mode==='local'&&e.key===LOCAL&&!busy)run(refresh)});
