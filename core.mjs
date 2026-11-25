export function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')}

export function reference(s){const v=String(s||'').replace(/\D/g,'');if(v.length!==12)return '';return (Number(v.slice(0,10))%97||97)===Number(v.slice(10))?v:''}

export function amount(s){let v=String(s||'').trim().replace(/[\s€]/g,'');if(!/^\d+(?:[.,]\d+)*$/.test(v))return null;const p=Math.max(v.lastIndexOf(','),v.lastIndexOf('.'));if(p>=0){if(v.length-p-1!==2)return null;v=v.slice(0,p).replace(/[.,]/g,'')+'.'+v.slice(p+1)}const n=Math.round(Number(v)*100);return Number.isSafeInteger(n)&&n>0&&n<=100000000?n:null}

export function iban(s){const v=norm(s);if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)||v.startsWith('BE')&&v.length!==16)return '';let r=0;for(const ch of v.slice(4)+v.slice(0,4)){const x=ch.charCodeAt(0);for(const d of String(x>=65?x-55:ch))r=(r*10+Number(d))%97}return r===1?v:''}

export function date(s){const m=String(s||'').match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);const v=m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):String(s||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';const t=new Date(v+'T00:00:00Z');return !isNaN(t)&&t.toISOString().slice(0,10)===v?v:''}


// OCR extraction is deliberately separate from the duplicate matching logic.
// Candidate scores express relative evidence, not calibrated probabilities.
const FIELD_KEYS=['supplier','invoice_no','invoice_date','amount_cents','reference','iban'];
const plain=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clean=s=>String(s??'').replace(/[\u00a0\u202f\u2007]/g,' ').replace(/[‐‑‒–—−]/g,'-').replace(/[|]/g,' ').trim();
const months={
 januari:1,january:1,janvier:1,jan:1, februari:2,february:2,fevrier:2,feb:2,fevr:2,
 maart:3,march:3,mars:3,mrt:3,mar:3, april:4,avril:4,apr:4,avr:4,
 mei:5,may:5,mai:5,juni:6,june:6,juin:6,jun:6,juli:7,july:7,juillet:7,jul:7,juil:7,
 augustus:8,august:8,aout:8,aug:8,september:9,septembre:9,sep:9,sept:9,
 oktober:10,october:10,octobre:10,okt:10,oct:10,november:11,novembre:11,nov:11,
 december:12,decembre:12,dec:12
};
function scanDate(value){
 const s=plain(clean(value)).replace(/\./g,' ').replace(/\s+/g,' ').trim();
 const numeric=clean(value).match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2}|\d{4})$/);
 if(numeric){const y=numeric[3].length===2?'20'+numeric[3]:numeric[3];return date(numeric[1]+'/'+numeric[2]+'/'+y)}
 const iso=date(clean(value));if(iso)return iso;
 const m=s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);if(m&&months[m[2]])return date(m[1]+'/'+months[m[2]]+'/'+m[3]);
 const e=s.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);if(e&&months[e[1]])return date(e[2]+'/'+months[e[1]]+'/'+e[3]);
 return '';
}
function datesIn(s){
 const re=/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(?:\d{4}|\d{2})|\d{1,2}\s+[A-Za-zÀ-ÿ]+\.?\s+\d{4}|[A-Za-zÀ-ÿ]+\s+\d{1,2},?\s+\d{4})\b/g;
 return [...s.matchAll(re)].map(x=>scanDate(x[0])).filter(Boolean);
}
function amountsIn(s,allowWhole=false){
 // Do not combine independent columns into a single monetary value.
 const re=/(?<![\w/.-])(?:\d{1,3}(?:[. ,']\d{3})+|\d+)[,.]\d{2}(?![\d%/.-])/g;
 const out=[...s.matchAll(re)].map(m=>amount(m[0].replace(/'/g,''))).filter(Boolean);
 if(!out.length&&allowWhole){
   for(const m of s.matchAll(/(?:€|EUR)\s*(\d+)(?![\d.,])|(?<![\d.,])(\d+)\s*(?:€|EUR)/gi)){const v=amount(m[1]||m[2]);if(v)out.push(v)}
 }
 return out;
}
const invoiceLabel=/(?:\bfactuur\s*(?:nummer|n[uú]mmer|nr\.?|n[°ºo]|#)|\bfactuurnr\.?|\binvoice\s*(?:number|no\.?|nr\.?|n[°º]|#)|\b(?:n[°ºo]\.?|numero|numéro)\s*(?:de\s+(?:la\s+)?)?facture|\bfacture\s*(?:n[°ºo]\.?|numero|numéro|#)|\bfactuur\s*#|\brekeningnummer\s+factuur)/i;
const dateLabel=/\b(?:factuur\s*datum|datum\s+(?:van\s+de\s+)?factuur|invoice\s*date|date\s+(?:de\s+(?:la\s+)?)?facture|date\s+d['’]emission|date\s+d['’]émission|uitgiftedatum|date\s+of\s+issue)\b/i;
const wrongDate=/verval|uiterste|betaal(?:datum|baar)|due\s*date|echeance|échéance|periode|leveringsdatum|delivery|payment\s+date/i;
const otherLabel=/(?:klant(?:nummer|nr)?|customer|client|numero de client|contract|btw|vat|tva|iban|bic|datum|date|verval|totaal|total|bedrag|amount|mededeling|communication|reference|referentie|order|bestel|rekening|account)\b/i;
const amountLabels=[
 [/\b(?:totaal\s+(?:nog\s+)?te\s+betalen|(?:nog|netto)\s+te\s+betalen|te\s+betalen(?:\s+bedrag)?|te\s+storten|amount\s+due|balance\s+due|total\s+due|total\s+a\s+payer|montant\s+(?:total\s+)?a\s+payer|net\s+a\s+payer|solde\s+a\s+payer|reste\s+a\s+payer)\b/,100],
 [/\b(?:totaalbedrag|factuurbedrag|bedrag\s+(?:van\s+de\s+)?factuur|eindtotaal|totaal\s+(?:incl\.?|inclusief)\s*(?:btw)?|total\s+ttc|montant\s+ttc|total\s+(?:incl\.?|including)\s*(?:vat|tax)?|grand\s+total|invoice\s+total|total\s+facture|total\s+tvac|totaal\s+tegoed)\b/,88],
 [/\b(?:totaal|total)\b/,62],
 [/\b(?:bedrag|montant|amount)\b/,40]
];
const notTotal=/\b(?:subtotaal|subtotal|sous.total|excl(?:usief)?|hors\s+taxe|total\s+ht|montant\s+ht|btw.bedrag|tva\s+seule|korting|discount|acompte|voorschot|eenheidsprijs|unit\s+price|prix\s+unitaire|reeds\s+betaald|deja\s+paye)\b/;
function invoiceToken(s){
 const v=clean(s).replace(/^[\s:#=.-]+/,'').replace(/^(?:n[°ºo]\.?|nr\.?|nummer|number)\s*[:#]?\s+/i,'').trim();
 const m=v.match(/^[A-Z0-9][A-Z0-9._/-]*(?:[ ]+[A-Z0-9][A-Z0-9._/-]*){0,2}/i);
 if(!m)return '';
 const tokens=m[0].split(/ +/);let x=tokens[0];
 if(!/\d/.test(x)&&tokens[1]&&/\d/.test(tokens[1]))x+=' '+tokens[1];
 else if(/^\d{1,6}$/.test(x)&&tokens[1]&&/^\d{3,12}$/.test(tokens[1]))x+=' '+tokens[1];
 x=x.replace(/[.,;:]+$/,'');
 if(!/\d/.test(x)||x.length>60||datesIn(x).length||reference(x)||iban(x)||otherLabel.test(x))return '';
 return x;
}
const knownSuppliers=[
 ['ENGIE',/\bengie\b/i],['Luminus',/\bluminus\b/i],['Telenet',/\btelenet\b/i],['Proximus',/\bproximus\b/i],['Orange',/\borange\s+(?:belgium|belgique)\b/i],['BASE',/\bbase\s+(?:company|factuur|invoice)\b/i],
 ['De Watergroep',/\bde\s+watergroep\b/i],['water-link',/\bwater[\s-]*link\b/i],['Pidpa',/\bpidpa\b/i],['Farys',/\bfarys\b/i],['Fluvius',/\bfluvius\b/i],['Eneco',/\beneco\b/i],['TotalEnergies',/\btotal\s*energies\b/i],['VIVAQUA',/\bvivaqua\b/i],['Helan',/\bhelan\b/i],['Solidaris',/\bsolidaris\b/i],['bpost',/\bbpost\b/i]
];
function supplierLike(s){
 return s.length>=3&&s.length<=100&&/[a-zÀ-ÿ]{2}/i.test(s)&&!/\d{3,}|@|https?:|www\.|[€]/i.test(s)&&!/\b(?:factuur|facture|invoice|creditnota|credit note|klant|customer|client|adres|adresse|address|straat|laan|steenweg|rue|avenue|datum|date|betaal|payment|btw|tva|vat|iban|bic|tel|email|pagina|page|geachte|beste|monsieur|madame|mevrouw|meneer|aan|bill to|ship to|leveringsadres|facturatieadres)\b/i.test(s);
}
export function extractDetailed(raw){
 const lines=String(raw??'').split(/\r?\n/).map(clean).filter(Boolean);
 const candidates=Object.fromEntries(FIELD_KEYS.map(k=>[k,[]]));
 function add(k,value,score,source){
   if(value===null||value===undefined||value==='')return;
   candidates[k].push({value,score,source:source.slice(0,200)});
 }
 const whole=lines.join('\n');
 for(let i=0;i<lines.length;i++){
   const l=lines[i], p=plain(l), next=lines[i+1]||'', prev=lines[i-1]||'';
   // Explicit OGM delimiters and 3/4/5 digit grouping; validate modulo 97.
   for(const m of l.matchAll(/(?:\+{2,}|\*{2,})\s*([0-9OIl\s/.-]{12,25})\s*(?:\+{2,}|\*{2,})/gi)){
     const v=reference(m[1].replace(/O/gi,'0').replace(/[Il]/g,'1'));if(v)add('reference',v,105,l);
   }
   for(const m of l.matchAll(/(?<!\d)(\d{3})\s*[/.-]\s*(\d{4})\s*[/.-]\s*(\d{5})(?!\d)/g))add('reference',reference(m.slice(1).join('')),100,l);
   if(/(?:mededeling|communication|structured\s+reference|ogm|vcs|betalingsreferentie)/i.test(p)){
     for(const s of [l,next,l+' '+next])for(const m of s.matchAll(/(?<!\d)(\d{3})[\s/.-]*(\d{4})[\s/.-]*(\d{5})(?!\d)/g))add('reference',reference(m.slice(1).join('')),100,s);
   }
   // Belgian IBAN can be OCR'd with spaces, dashes, or on two lines. Other
   // countries are accepted only when checksum validates and label is present.
   const ibanLength={BE:16,NL:18,FR:27,DE:22,LU:20,GB:22,ES:24,IT:27,AT:20,IE:22,PT:25,CH:21};
   for(const s of [l,l+' '+next]){
     for(const m of s.matchAll(/\b([A-Z]{2})[\s.-]*([0-9OIl]{2})(?=[\s.-]*[A-Z0-9])/gi)){
       const cc=m[1].toUpperCase(),len=ibanLength[cc];if(!len)continue;
       const tail=s.slice(m.index+m[0].length).replace(/[\s.-]/g,'').slice(0,len-4).toUpperCase();
       if(tail.length!==len-4)continue;
       let v=cc+m[2].toUpperCase().replace(/O/g,'0').replace(/[IL]/g,'1')+tail;
       if(cc==='BE')v=v.slice(0,4)+v.slice(4).replace(/O/g,'0').replace(/[IL]/g,'1');
       if(iban(v))add('iban',v,/iban|rekening|compte|account/i.test(l+' '+prev)?104:90,s);
     }
   }
   // Score labels, and use adjacent lines when the invoice uses two rows.
   const no=l.match(invoiceLabel);
   if(no){
     const suffix=l.slice(no.index+no[0].length);
     add('invoice_no',invoiceToken(suffix),105,l);
     if(!suffix.trim().replace(/[:#.-]/g,''))add('invoice_no',invoiceToken(next),98,l+' / '+next);
     // Multiple labels in one header, values in the following row.
     if(otherLabel.test(suffix)){
       const ns=next.split(/\s{2,}|\t+/); if(ns.length>1){
         const labels=l.split(/\s{2,}|\t+/);const ix=labels.findIndex(x=>invoiceLabel.test(x));
         if(ix>=0)add('invoice_no',invoiceToken(ns[ix]||''),101,l+' / '+next);
       }
     }
   }else{
     const m=l.match(/^\s*(?:factuur|facture|invoice)\s*(?:[:#-]\s*|\s+)([A-Z0-9][A-Z0-9._/-]{2,})\s*$/i);
     if(m)add('invoice_no',invoiceToken(m[1]),85,l);
     if(/^(?:factuur|facture|invoice)$/i.test(prev))add('invoice_no',invoiceToken(l),73,l);
   }
   const dl=l.match(dateLabel);
   if(dl){
     const suffix=l.slice(dl.index+dl[0].length);
     const found=datesIn(suffix.split(/(?:vervaldatum|due date|date d['’]échéance|échéance)/i)[0]);
     add('invoice_date',found[0],103,l);
     if(!found.length&&!wrongDate.test(next))add('invoice_date',datesIn(next)[0],94,l+' / '+next);
   }else if(!wrongDate.test(l)){
     if(/^(?:datum|date)\s*[:#]?\s*$/i.test(l))add('invoice_date',datesIn(next)[0],75,l+' / '+next);
     else if(/^(?:datum|date)\s*[:#]?\s+/i.test(l))add('invoice_date',datesIn(l)[0],78,l);
     else if(i<12&&datesIn(l).length===1&&!/periode|period|van\s+.*tot/i.test(l))add('invoice_date',datesIn(l)[0],42,l);
   }
   if(!notTotal.test(p)){
     const label=amountLabels.find(([re])=>re.test(p));
     if(label){
       const m=p.match(label[0]);const tail=l.slice(m.index+m[0].length);
       const values=amountsIn(tail,true);
       if(values.length)values.forEach((v,j)=>add('amount_cents',v,label[1]-(values.length-1-j)*12,l));
       else{
         const before=amountsIn(l.slice(0,m.index),true);
         before.forEach(v=>add('amount_cents',v,label[1]-4,l));
         if(next&&!notTotal.test(plain(next))&&!otherLabel.test(next.replace(/(?:EUR|€)/gi,''))&&!wrongDate.test(next)){
           const v=amountsIn(next,true);v.forEach((x,j)=>add('amount_cents',x,label[1]-7-(v.length-1-j)*12,l+' / '+next));
         }
       }
     }else if(/(?:€|\bEUR\b)/i.test(l)&&!wrongDate.test(l)&&!/\b(?:btw|tva|vat|korting|discount)\b/i.test(l)){
       amountsIn(l,true).forEach(v=>add('amount_cents',v,28,l));
     }
   }
   const supplierLabel=l.match(/^(?:leverancier|supplier|fournisseur|afzender|verkoper|vendeur|seller|uitgereikt door|issued by|emis par|émis par)\s*(?::|=|-)?\s*(.*)$/i);
   if(supplierLabel){const v=supplierLabel[1]||next;if(supplierLike(v))add('supplier',v,105,l+' / '+v);}
   const customerContext=/^(?:klant|customer|client|destinataire|bill to|ship to|facturatieadres|leveringsadres|aan|adresse de facturation)\s*[:#-]?\s*$/i.test(prev)||/^(?:klant|customer|client|destinataire|bill to|ship to|facturatieadres|leveringsadres|aan)\s*[:#]/i.test(l);
   if(!customerContext&&i<25){
     if(/\b(?:BVBA|BV|NV|SRL|SA|SPRL|ASBL|VZW|GMBH|LTD|SAS|VOF|CV|SC|CVBA)\.?(?:\s*$)/i.test(l)&&supplierLike(l))add('supplier',l,91,l);
     for(const [brand,re] of knownSuppliers)if(re.test(l)&&!/\b(?:klant|customer|client|bill to|facturatieadres|leveringsadres)\b/i.test(l))add('supplier',brand,i<10?88:73,l);
     if(i<4&&supplierLike(l)&&!/[.:;]/.test(l)&&l.split(/\s+/).length<=6)add('supplier',l,36-i*3,l);
   }
 }
 // Structured reference split across lines in a marked payment block.
 for(const m of whole.matchAll(/(?:\+{2,}|\*{2,})\s*([0-9OIl\s/.-]{12,30})\s*(?:\+{2,}|\*{2,})/gi))add('reference',reference(m[1].replace(/O/gi,'0').replace(/[Il]/g,'1')),105,m[0]);
 return selectCandidates(candidates);
}
function selectCandidates(candidates){
 const fields={},details={};
 for(const k of FIELD_KEYS){
   const grouped=new Map();
   for(const c of candidates[k]||[]){
     const key=k==='amount_cents'?String(c.value):norm(c.value);
     const previous=grouped.get(key);if(!previous||c.score>previous.score)grouped.set(key,c);
   }
   const all=[...grouped.values()].sort((a,b)=>b.score-a.score);
   const best=all[0],second=all[1];
   // Weak monetary and date clues may be displayed as suggestions but never
   // silently fill an ambiguous field. Supplier fallback is always a suggestion.
   const floor=k==='amount_cents'?40:k==='invoice_date'?42:k==='supplier'?35:65;
   const conflict=!!(best&&second&&best.score-second.score<=5);
   fields[k]=best&&best.score>=floor&&!conflict?best.value:k==='amount_cents'?null:'';
   details[k]={value:fields[k],score:best?.score||0,ambiguous:conflict,weak:!!best&&best.score<80,alternatives:all.slice(0,5)};
 }
 return {fields,details};
}
export function mergeExtractions(results){
 const candidates=Object.fromEntries(FIELD_KEYS.map(k=>[k,[]]));
 for(const k of FIELD_KEYS){
   const grouped=new Map();
   for(const [pass,result] of results.entries()){
     for(const c of result.details[k].alternatives){
       const key=k==='amount_cents'?String(c.value):norm(c.value);
       const existing=grouped.get(key);
       if(!existing)grouped.set(key,{...c,passes:new Set([pass])});
       else{existing.passes.add(pass);if(c.score>existing.score){existing.score=c.score;existing.source=c.source;existing.value=c.value}}
     }
   }
   for(const v of grouped.values())candidates[k].push({...v,score:v.score+Math.min(8,(v.passes.size-1)*4)});
 }
 return selectCandidates(candidates);
}
export function extract(raw){return extractDetailed(raw).fields}


export function match(a,b){const r=reference(a.reference),s=reference(b.reference), ai=iban(a.iban),bi=iban(b.iban);const supplier=norm(a.supplier)&&norm(a.supplier)===norm(b.supplier);const account=ai&&ai===bi;const number=norm(a.invoice_no)&&norm(a.invoice_no)===norm(b.invoice_no);if(r&&r===s||number&&(supplier||account))return 'exact';if(a.amount_cents===b.amount_cents&&(supplier||account)&&(!a.invoice_date||!b.invoice_date||Math.abs(Date.parse(a.invoice_date)-Date.parse(b.invoice_date))<=31*86400000))return 'possible';return ''}
