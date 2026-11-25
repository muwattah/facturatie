import {compareInvoice} from './core.mjs?v=0.3.0';
export const documentLabels={invoice:'Factuur / aanslag / betalingsverzoek',reminder:'Herinnering / aanmaning',collection:'Incasso / dwangbevel',credit:'Creditnota'};
export function findMatches(v,rows){
 const rank={changed:3,exact:2,possible:1};
 return rows.map(invoice=>{
   let best={kind:'',reasons:[]};
   for(const version of [invoice,...(invoice.documents||[])]){
     const result=compareInvoice(v,version);
     if((rank[result.kind]||0)>(rank[best.kind]||0))best=result;
   }
   // Re-scanning a previous document does not clear an existing review.
   if(best.kind==='changed'&&(invoice.documents||[]).some(d=>d.photo_hash&&d.photo_hash===v.photo_hash)){
     best={kind:'exact',reasons:['Deze foto zit al in het dossier']};
   }
   return {...best,invoice};
 }).filter(x=>x.kind).sort((a,b)=>rank[b.kind]-rank[a.kind]);
}
export function decideRegistration(rows,v,choice={}){
 const matches=findMatches(v,rows), strong=matches.filter(x=>x.kind!=='possible');
 if(strong.length>1&&!choice.linkId)return {kind:'possible',matches};
 if(choice.separate&&strong.length) return {kind:'possible',matches};
 if(!choice.linkId&&!choice.separate&&matches.length&&!strong.length)return {kind:'possible',matches};
 const selected=choice.linkId?matches.find(x=>x.invoice.id===choice.linkId):strong[0];
 if(choice.linkId&&!selected)return {kind:'possible',matches};
 const doc={...v,id:choice.documentId,received_at:choice.now};
 if(selected){
   const old=selected.invoice,docs=old.documents||[];
   const duplicatePhoto=docs.some(d=>d.photo_hash===doc.photo_hash);
   const review=!!old.review_required||selected.kind!=='exact'||v.amount_cents!==old.amount_cents||
     ['credit','collection'].includes(v.document_type);
   const invoice={...old,documents:duplicatePhoto?docs:[...docs,doc],review_required:review};
   if(review&&!old.review_required)invoice.review_reason='Gewijzigd of gekoppeld document: controleer bank en leverancier.';
   return {kind:review?'review':'exact',invoice,rows:rows.map(x=>x.id===old.id?invoice:x),reasons:selected.reasons};
 }
 const review=v.document_type!=='invoice';
 const invoice={...v,id:choice.invoiceId,status:'unpaid',created_at:choice.now,paid_at:null,documents:[doc],review_required:review,
   review_reason:review?'Geen bevestigde oorspronkelijke factuur: controleer de bank en de leverancier.':''};
 return {kind:review?'review':'new',invoice,rows:[invoice,...rows]};
}
export function resolveReview(row,remaining,now){
 if(!row.review_required||row.status==='paying')throw Error('Controleer eerst de lopende betaling.');
 if(!Number.isSafeInteger(remaining)||remaining<0||remaining>100000000)throw Error('Ongeldig openstaand saldo.');
 const audit={at:now,previous_status:row.status,previous_amount_cents:row.amount_cents,previous_paid_at:row.paid_at,confirmed_open_cents:remaining};
 return {...row,review_required:false,review_reason:'',reviews:[...(row.reviews||[]),audit],
   amount_cents:remaining||row.amount_cents,status:remaining?'unpaid':'paid',paid_at:remaining?null:row.paid_at||now};
}
const DB='factuurcheck.archive.v1';
let opening;
function db(){
 if(!opening)opening=new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{const d=req.result;d.createObjectStore('photos');};
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>{opening=null;reject(req.error||Error('Fotoarchief niet beschikbaar.'))};
 });
 return opening;
}
async function transact(mode,operation){
 const d=await db();return new Promise((resolve,reject)=>{
   const tx=d.transaction('photos',mode),store=tx.objectStore('photos');let result;
   const req=operation(store);req.onsuccess=()=>{result=req.result};
   tx.oncomplete=()=>resolve(result);
   tx.onabort=tx.onerror=()=>reject(tx.error||Error('Foto kon niet worden opgeslagen.'));
 });
}
export async function photoHash(file){
 const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export const savePhoto=(hash,file)=>transact('readwrite',s=>s.put(file,hash));
export const loadPhoto=hash=>transact('readonly',s=>s.get(hash));
export const clearPhotos=()=>transact('readwrite',s=>s.clear());
