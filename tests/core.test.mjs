import test from 'node:test';
import assert from 'node:assert/strict';
import {norm,reference,amount,iban,date,extract,extractDetailed,mergeExtractions,match,documentInfo,compareInvoice,supplierKey} from '../core.mjs';
const base={supplier:'Engie',invoice_no:'INV-1',amount_cents:12500,invoice_date:'2026-11-01',reference:'',iban:''};
test('Belgian and international euro amounts',()=>{assert.equal(amount('1.234,56'),123456);assert.equal(amount('1,234.56'),123456);assert.equal(amount('12,3'),null);assert.equal(amount('0'),null)});
test('Belgian structured reference checksum',()=>{assert.equal(reference('+++123/4567/89002+++'),'123456789002');assert.equal(reference('123456789003'),'')});
test('IBAN checksum',()=>{assert.equal(iban('BE68 5390 0754 7034'),'BE68539007547034');assert.equal(iban('BE69 5390 0754 7034'),'')});
test('Date validation',()=>{assert.equal(date('31/02/2026'),'');assert.equal(date('01/11/2026'),'2026-11-01')});
test('Same invoice with punctuation/case differences',()=>assert.equal(match(base,{...base,supplier:'ENGIE!'}),'exact'));
test('Same structured reference',()=>assert.equal(match({...base,reference:'123456789002'},{...base,invoice_no:'OTHER',reference:'123456789002'}),'exact'));
test('Same supplier and amount with different number is only possible',()=>assert.equal(match(base,{...base,invoice_no:'INV-2'}),'possible'));
test('Distant recurring invoices are distinct',()=>assert.equal(match(base,{...base,invoice_no:'INV-2',invoice_date:'2027-03-01'}),''));
test('Same amount, different supplier is not sufficient',()=>assert.equal(match(base,{...base,supplier:'Other',invoice_no:'INV-2'}),''));
test('Extract labeled OCR data',()=>{const x=extract('Factuurnummer: INV-1\nFactuurdatum: 01/11/2026\nTotaal te betalen € 1.234,56');assert.equal(x.amount_cents,123456);assert.equal(x.invoice_no,'INV-1');assert.equal(x.invoice_date,'2026-11-01')});
test('Supplier suggestion from a labeled line',()=>assert.equal(extract('Leverancier: Testbedrijf\nFactuurnummer: TEST-001').supplier,'Testbedrijf'));
test('Supplier suggestion from a company name',()=>assert.equal(extract('Voorbeeld NV\nFactuurnummer: TEST-001').supplier,'Voorbeeld NV'));

test('Multiline Belgian invoice fields and plain structured reference',()=>{
 const x=extract('Telenet\nFactuur nr.\n2026-9912\nFactuurdatum\n26 november 2026\nTe betalen\n€ 68,00\nIBAN BE68 5390 0754 7034\nMededeling: 123456789002');
 assert.equal(x.supplier,'Telenet');assert.equal(x.invoice_no,'2026-9912');assert.equal(x.invoice_date,'2026-11-26');assert.equal(x.amount_cents,6800);assert.equal(x.iban,'BE68539007547034');assert.equal(x.reference,'123456789002');
});
test('French invoice, taxes and written date',()=>{
 const x=extract('Fournisseur: Exemple SRL\nN° de facture : 2026/481\nDate de facture : 2 décembre 2026\nTotal HT 100,00\nTVA 21,00\nNet à payer\n121,00 EUR');
 assert.equal(x.supplier,'Exemple SRL');assert.equal(x.invoice_no,'2026/481');assert.equal(x.invoice_date,'2026-12-02');assert.equal(x.amount_cents,12100);
});
test('English invoice and short numeric date',()=>{
 const x=extract('Invoice # A-123\nInvoice date 26/11/26\nDue date 12/12/26\nSubtotal 100.00\nTotal due 121.00');
 assert.equal(x.invoice_no,'A-123');assert.equal(x.invoice_date,'2026-11-26');assert.equal(x.amount_cents,12100);
});
test('Recognize bare invoice label and gross total',()=>{
 const x=extract('Voorbeeld NV\nFactuur 2026-77\nTotaal incl. btw 120,00\n+++123/4567/89002+++');
 assert.equal(x.supplier,'Voorbeeld NV');assert.equal(x.invoice_no,'2026-77');assert.equal(x.amount_cents,12000);assert.equal(x.reference,'123456789002');
});
test('Do not confuse due date with invoice date or net with gross',()=>{
 const x=extract('Factuurdatum: 26/11/2026 Vervaldatum: 26/12/2026\nTotaal excl btw 100,00\nTotaal 121,00');
 assert.equal(x.invoice_date,'2026-11-26');assert.equal(x.amount_cents,12100);
});
test('Conflicting totals are not silently selected',()=>{
 const x=extractDetailed('Te betalen 100,00\nTe betalen 120,00');
 assert.equal(x.fields.amount_cents,null);assert.equal(x.details.amount_cents.ambiguous,true);assert.equal(x.details.amount_cents.alternatives.length,2);
});
test('Multiline IBAN and grouped OGM',()=>{
 const x=extract('IBAN: BE68 5390\n0754 7034\nGestructureerde mededeling:\n123 4567 89002');
 assert.equal(x.iban,'BE68539007547034');assert.equal(x.reference,'123456789002');
});
test('Merge complementary OCR passes without joining unrelated lines',()=>{
 const x=mergeExtractions([extractDetailed('Factuurnummer: TEST-001\nTe betalen 121,00'),extractDetailed('Leverancier: Testbedrijf\nFactuurdatum: 26/11/2026\nIBAN BE68 5390 0754 7034')]);
 assert.equal(x.fields.invoice_no,'TEST-001');assert.equal(x.fields.amount_cents,12100);assert.equal(x.fields.supplier,'Testbedrijf');assert.equal(x.fields.invoice_date,'2026-11-26');assert.equal(x.fields.iban,'BE68539007547034');
});
test('Do not fill payment due date alone or net subtotal',()=>{
 const x=extract('Vervaldatum: 12/12/2026\nSubtotaal 100,00\nTotal HT 100,00');
 assert.equal(x.invoice_date,'');assert.equal(x.amount_cents,null);
});
test('Prefer actual payable amount to generic total',()=>{
 const x=extract('Totaal 120,00\nNog te betalen 70,00');
 assert.equal(x.amount_cents,7000);
});
test('Correct typical OGM OCR substitutions only after checksum validation',()=>{
 const x=extract('+++123/4567/89O02+++');assert.equal(x.reference,'123456789002');
});

test('Public authority and amount on next line',()=>{const x=extract('Stad Antwerpen\nAanslagbiljet\nKohierartikel: 2026-0007\nVerschuldigd bedrag\n€ 45,00');assert.equal(x.supplier,'Stad Antwerpen');assert.equal(x.invoice_no,'2026-0007');assert.equal(x.amount_cents,4500)});
test('Municipality without corporate suffix',()=>{const x=extract('Gemeente Edegem\nDossiernummer: AB-123456\nOpenstaand saldo: EUR 75,00');assert.equal(x.supplier,'Gemeente Edegem');assert.equal(x.amount_cents,7500)});
test('Government supplier and unlabeled euro amount',()=>{const x=extract('FOD Financiën\nBetalingskenmerk: ABC123\n€ 125,00');assert.equal(x.supplier,'FOD Financiën');assert.equal(x.amount_cents,12500)});
test('OCR misspelling and spaces around decimal',()=>{const x=extract('Stad Antwrerpen\nTe betalen bedrag 15 , 50');assert.equal(x.supplier,'Stad Antwerpen');assert.equal(x.amount_cents,1550)});
test('Reminder metadata and payable amount',()=>{const raw='Stad Antwerpen\nHERINNERING\nOorspronkelijke factuur: AB-123456\nHoofdsom 50,00\nHerinneringskosten 10,00\nNog te betalen 60,00';assert.equal(extract(raw).amount_cents,6000);const i=documentInfo(raw);assert.equal(i.document_type,'reminder');assert.equal(i.related_ids,'AB-123456');assert.equal(i.original_cents,5000);assert.equal(i.fee_cents,1000)});
test('Same invoice number with higher amount requires review',()=>assert.equal(compareInvoice({...base,amount_cents:13000,document_type:'reminder'},base).kind,'changed'));
test('Different reminder number and original identifier is possible',()=>assert.equal(compareInvoice({...base,invoice_no:'R-2',related_ids:'INV-1',amount_cents:13000,document_type:'reminder'},base).kind,'possible'));
test('Different supplier with same reference does not automatically mean paid',()=>assert.equal(compareInvoice({...base,reference:'123456789002',supplier:'Other'},{...base,reference:'123456789002'}).kind,'possible'));
test('Municipal alias',()=>assert.equal(supplierKey('Antwerpen'),supplierKey('Stad Antwerpen')));
test('Same photo even when supplier OCR differs',()=>assert.equal(compareInvoice({...base,supplier:'Other',photo_hash:'xyz'},{...base,photo_hash:'xyz'}).kind,'exact'));
