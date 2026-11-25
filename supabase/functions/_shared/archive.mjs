import {compareInvoice} from './core.mjs';
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
   const review=!!old.review_required||(!duplicatePhoto&&(selected.kind!=='exact'||v.amount_cents!==old.amount_cents||['credit','collection'].includes(v.document_type)||v.document_type==='reminder'&&old.status==='paid'));
   const invoice={...old,documents:duplicatePhoto?docs:[...docs,doc],review_required:review};
   if(review&&!old.review_required)invoice.review_reason='Gewijzigd of gekoppeld document: controleer bank en leverancier.';
   return {kind:review?'review':'exact',invoice,rows:rows.map(x=>x.id===old.id?invoice:x),reasons:selected.reasons};
 }
 const review=v.document_type!=='invoice';
 const invoice={...v,id:choice.invoiceId,status:'unpaid',open_cents:v.amount_cents,created_at:choice.now,paid_at:null,documents:[doc],review_required:review,
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
