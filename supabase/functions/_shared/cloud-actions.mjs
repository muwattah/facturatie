import {norm,reference,iban,date} from './core.mjs';
import {decideRegistration} from './archive.mjs';
import {openBalance,recordPayment,reversePayment,reconcile} from './ledger.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Ongeldige tekst');return v.trim()};
const cents=(v,allowZero=false)=>{if(!Number.isSafeInteger(v)||v<(allowZero?0:1)||v>100000000)throw Error('Ongeldig bedrag');return v};
const optionalDate=v=>{if(v==null||v==='')return null;if(typeof v!=='string'||date(v)!==v)throw Error('Ongeldige datum');return v};
const optionalAmount=v=>v==null?null:cents(v);
export const isUuid=v=>typeof v==='string'&&UUID.test(v);
export const mimeTypes=['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
export function validateDocument(raw,hash,mime){
 if(!raw||typeof raw!=='object'||!/^[a-f0-9]{64}$/.test(hash)||!mimeTypes.includes(mime))throw Error('Ongeldig document');
 const supplier=text(raw.supplier,180),invoice_no=text(raw.invoice_no??'',100),related_ids=text(raw.related_ids??'',300);
 const ref=text(raw.reference??'',24),account=text(raw.iban??'',42);
 if(!norm(supplier)||(!norm(invoice_no)&&!norm(related_ids)&&!reference(ref)))throw Error('Leverancier en documentkenmerk vereist');
 if(ref&&!reference(ref)||account&&!iban(account))throw Error('Ongeldige mededeling of IBAN');
 if(!['invoice','reminder','collection','credit'].includes(raw.document_type))throw Error('Ongeldig documenttype');
 return {supplier,invoice_no,related_ids,reference:reference(ref),iban:iban(account),invoice_date:optionalDate(raw.invoice_date),
 due_date:optionalDate(raw.due_date),amount_cents:cents(raw.amount_cents),document_type:raw.document_type,
 category:text(raw.category??'Overige',60),original_cents:optionalAmount(raw.original_cents),fee_cents:optionalAmount(raw.fee_cents),
 photo_hash:hash,file_type:mime};
}
export function applyAction(rows,request,actor,now,document=null,newId=()=>crypto.randomUUID()){
 if(!Array.isArray(rows)||!isUuid(actor)||!request||typeof request!=='object')throw Error('Ongeldige actie');
 const {action}=request;
 if(action==='register'){
   if(!document)throw Error('Origineel bestand ontbreekt');
   const linkId=request.linkId??null;
   if(linkId!==null&&!isUuid(linkId))throw Error('Ongeldig dossier');
   if(request.separate===true&&linkId)throw Error('Kies koppelen of apart registreren');
   return decideRegistration(rows,document,{linkId,separate:request.separate===true,documentId:newId(),invoiceId:newId(),now});
 }
 if(!['reserve','release','payment','reverse','reconcile'].includes(action))throw Error('Onbekende actie');
 if(!isUuid(request.invoiceId))throw Error('Ongeldig dossier');
 const row=rows.find(x=>x.id===request.invoiceId);
 if(!row)throw Error('Dossier ontbreekt');
 let next;
 const reservation=row.reservation;
 const owned=!!reservation&&reservation.actor_id===actor&&reservation.id===request.reservationId;
 if(action==='reserve'){
   if(row.status!=='unpaid'||row.review_required||openBalance(row)<=0)throw Error('Betaling kan niet gereserveerd worden');
   next={...row,status:'paying',reservation:{id:newId(),actor_id:actor,at:now}};
 }else if(action==='release'){
   if(row.status!=='paying'||!owned||request.bankChecked!==true)throw Error('Alleen de reserverende gebruiker kan na bankcontrole vrijgeven');
   next={...row,status:'unpaid',reservation:null};
 }else if(action==='payment'){
   if(request.bankChecked!==true)throw Error('Bevestig de werkelijke bankbetaling');
   if(row.status==='paying'&&!owned)throw Error('Betaling is door een ander gereserveerd');
   if(row.status!=='paying'&&request.historical!==true)throw Error('Reserveer eerst of registreer expliciet een historische betaling');
   if(row.review_required&&row.status!=='paying')throw Error('Controleer eerst het dossier');
   const when=optionalDate(request.paymentDate);
   if(!when||when>now.slice(0,10))throw Error('Ongeldige betaaldatum');
   const id=newId();
   next=recordPayment(row,cents(request.cents),now,id,text(request.note??'',250),when);
   next={...next,reservation:null,payments:next.payments.map(p=>p.id===id?{...p,actor_id:actor}:p)};
 }else if(action==='reverse'){
   if(request.bankChecked!==true||!isUuid(request.paymentId))throw Error('Controleer de bankbetaling');
   next=reversePayment(row,request.paymentId,now);
   next={...next,payments:next.payments.map((p,i)=>i===next.payments.length-1?{...p,actor_id:actor}:p)};
 }else{
   if(request.bankChecked!==true)throw Error('Bevestig saldo na controle bij bank en leverancier');
   const reason=request.reason==='credit'?'credit':'balance';
   next=reconcile(row,cents(request.cents,true),now,text(request.note??'',300),reason);
   next={...next,reviews:next.reviews.map((r,i)=>i===next.reviews.length-1?{...r,actor_id:actor}:r)};
 }
 return {kind:'updated',invoice:next,rows:rows.map(x=>x.id===row.id?next:x)};
}
