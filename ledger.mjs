export function openBalance(row){
 if(Number.isSafeInteger(row.open_cents)&&row.open_cents>=0)return row.open_cents;
 return row.status==='paid'?0:row.amount_cents;
}
export function recordPayment(row,cents,now,id,note='',paymentDate=now.slice(0,10)){
 const balance=openBalance(row);
 if(row.review_required&&row.status!=='paying')throw Error('Controleer eerst het dossier.');
 if(!['unpaid','paying'].includes(row.status)||!Number.isSafeInteger(cents)||cents<=0||cents>balance)throw Error('Betaling moet positief zijn en mag het openstaande saldo niet overschrijden.');
 const remaining=balance-cents;
 const payment={id,kind:'payment',cents,at:now,payment_date:paymentDate,note:String(note).slice(0,250)};
 return {...row,open_cents:remaining,status:remaining?'unpaid':'paid',paid_at:remaining?null:now,closed_reason:remaining?'':'payment',payments:[...(row.payments||[]),payment]};
}
export function reversePayment(row,id,now){
 if(row.review_required||row.status==='paying')throw Error('Controleer eerst het dossier en de lopende betaling.');
 const payments=row.payments||[],p=payments.find(x=>x.id===id&&x.kind==='payment');
 if(!p||payments.some(x=>x.kind==='reversal'&&x.reverses===id))throw Error('Deze betaling is niet actief.');
 const balance=openBalance(row)+p.cents;
 // Reconcile against bank before allowing another payment after a correction.
 return {...row,open_cents:balance,status:'unpaid',paid_at:null,closed_reason:'',review_required:true,review_reason:'Betalingsregistratie gecorrigeerd. Controleer het werkelijke openstaande saldo.',payments:[...payments,{kind:'reversal',reverses:id,cents:p.cents,at:now}]};
}
export function reconcile(row,remaining,now,note='',reason='balance'){
 if(!row.review_required||row.status==='paying')throw Error('Controleer eerst het dossier en de lopende betaling.');
 if(!Number.isSafeInteger(remaining)||remaining<0||remaining>100000000)throw Error('Ongeldig openstaand saldo.');
 const audit={at:now,previous_status:row.status,previous_amount_cents:row.amount_cents,previous_open_cents:openBalance(row),previous_paid_at:row.paid_at,confirmed_open_cents:remaining,reason,note:String(note).slice(0,300)};
 return {...row,open_cents:remaining,review_required:false,review_reason:'',reviews:[...(row.reviews||[]),audit],status:remaining?'unpaid':'paid',paid_at:remaining?null:row.paid_at||null,closed_reason:remaining?'':'reconciled'};
}
export function dashboard(rows,month,today){
 const result={open:0,paid:0,review:0,overdue:0,soon:0,partial:0,unpaid:0,categories:{},months:{}};
 for(const row of rows){
   const balance=openBalance(row);
   if(row.review_required)result.review++;
   else if(balance>0){
     result.open+=balance;result.unpaid++;
     if(row.due_date&&row.due_date<today)result.overdue++;
     else if(row.due_date&&row.due_date<=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10))result.soon++;
     if((row.payments||[]).some(p=>p.kind==='payment'&&!(row.payments||[]).some(r=>r.kind==='reversal'&&r.reverses===p.id)))result.partial++;
   }
   for(const p of row.payments||[]){
     if(p.kind!=='payment'||(row.payments||[]).some(r=>r.kind==='reversal'&&r.reverses===p.id))continue;
     const m=(p.payment_date||p.at||'').slice(0,7);
     if(!/^\d{4}-\d{2}$/.test(m))continue;
     result.months[m]=(result.months[m]||0)+p.cents;
     if(m===month){result.paid+=p.cents;const cat=row.category||'Overige';result.categories[cat]=(result.categories[cat]||0)+p.cents}
   }
 }
 return result;
}
