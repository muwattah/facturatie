# FactuurCheck — v0.3.0

Deze versie test het vernieuwde lokale factuurdossier met origineel fotoarchief, herkenning van overheidsdocumenten, herinneringen en incasso. Geen automatische bankcontrole.

## Testen

Open https://muwattah.github.io/facturatie/?v=0.3.0 en controleer het versienummer onderaan. Kies Lokale test starten. Gebruik fictieve facturen en een foto: de foto is verplicht bij registratie. Tekst mag ook handmatig geplakt worden om de parser te testen, maar registratie vereist een afbeelding.

1. Scan een factuur en bevestig de herkende gegevens. Foto en gegevens staan naast elkaar op brede schermen, onder elkaar op kleine schermen.
2. Registreer, reserveer en bevestig alleen een fictieve betaling.
3. Scan dezelfde foto opnieuw. De app houdt hetzelfde dossier en bewaart niet opnieuw hetzelfde bestand.
4. Scan een nieuwe foto van een herinnering met gewijzigd bedrag. Een sterke overeenkomst leidt naar het bestaande dossier met controle vereist.
5. Bij een mogelijke overeenkomst kun je de oorspronkelijke foto bekijken en handmatig koppelen. Alleen als het aantoonbaar een andere schuld is, mag je apart registreren.
6. Controleer bij een herinnering het werkelijke openstaande saldo bij de bank én leverancier. Vul 0 in indien niets meer openstaat of het werkelijk verschuldigde bedrag indien nog iets openstaat. Het oude document en de eerdere saldocontrole blijven in het dossier.
7. Herlaad en open de oorspronkelijke foto's in de geschiedenis. Oudere registraties uit v0.2 hebben nog geen foto; scan ze opnieuw om ze toe te voegen.

## Herkenning

Nederlands, Frans, Engels; maximaal drie lokale OCR-rondes. Ondersteunt onder meer Stad Antwerpen, Vlaamse Belastingdienst, FOD Financiën, gemeenten, OCMW's, ziekenhuizen en reguliere leveranciers. Bedragen worden ook gezocht bij verschuldigd bedrag, openstaand saldo, aanslagbedrag en losse eurobedragen. Zwakke of tegenstrijdige herkenning blijft te controleren. Dossiernummers, kohierartikelen, oorspronkelijke factuurnummers en betalingskenmerken worden als aanvullende aanwijzingen opgeslagen. Controleer alle velden, inclusief documenttype en eventuele herinneringskosten.

## Duplicaat- en herinneringscontrole

- Vergelijk SHA-256 van het originele fotobestand, gestructureerde mededeling, factuurnummer, leverancier (inclusief enkele naamvarianten), IBAN, dossierkenmerken, bedrag, datum, oorspronkelijk bedrag en documenttype. Vergelijk ook eerdere documenten in het dossier.
- Een sterk overeenkomend document met een gewijzigd bedrag, conflicterende referentie of andere risicokenmerken zet het dossier op controle. Een andere foto van dezelfde factuur wordt naast de oorspronkelijke foto bewaard.
- Gelijk dossierkenmerk, bijna gelijk identificatienummer of gelijk bedrag en leverancier zijn mogelijke overeenkomsten, geen bewijs van betaling.
- Een herinnering, creditnota of incassodocument zonder sterke overeenkomst wordt nooit meteen als gewone betaalbare factuur vrijgegeven. Controleer en koppel zo nodig handmatig.
- Hergebruikte identifiers, onherkende gegevens, nieuw dossiernummer en een andere schuldeiser kunnen leiden tot gemiste of onterechte matches. Controleer altijd de bank en leverancier.
- De app berekent geen automatisch te betalen verschil. Een hoger bedrag kan bijvoorbeeld een herinnering van vóór je betaling zijn. Bevestig het werkelijke openstaande saldo.
- Geen bankintegratie of automatische verificatie. De lokale status is geen bankbewijs.

## Opslag en privacy

De originele foto wordt als Blob met de originele bytes opgeslagen in IndexedDB; niet als verkleinde OCR-afbeelding. De factuurgegevens, documentverwijzingen en saldocontroles blijven in de bestaande lokale browseropslag. Foto's worden opgeslagen voordat een nieuwe registratie wordt vastgelegd; bij een opslagfout wordt geen nieuwe registratie gemeld. Een onbesliste mogelijke match is nog geen opgeslagen registratie. De app verwijdert het archief niet bij het herladen. Browsergegevens wissen, private browsing, opslagquota, toestelverlies of automatische browseropruiming kunnen wel gegevensverlies veroorzaken. Geen automatische export of back-up. Wis alleen bewust via de lokale testknop. Gebruik vooralsnog fictieve gegevens.

De broncode is openbaar, maar de foto's worden niet naar GitHub of een OCR-server gestuurd. De OCR-bibliotheken en taalmodellen worden via internet geladen. De foto's blijven op het toestel. Gebruik HTTPS. Lokale data wordt niet door de app versleuteld.

## Gezinsmodus

Tijdelijk uitgeschakeld in v0.3.0. Het eerdere Supabase-schema (supabase/schema.sql) ondersteunt nog geen fotodossiers, openstaand-saldocontrole of gekoppelde herinneringen. Activeer het niet voor deze versie. Een veilige migratie met privé-opslag, huishoudgebonden toegangsrechten, server-side vergelijking en atomaire betaalstatus moet nog worden geïmplementeerd en getest. De app valt niet stilzwijgend terug op lokale opslag wanneer je een gedeeld account probeert te gebruiken.

## Technisch en testen

- core.mjs: OCR-parser, identificatie en vergelijkingsregels
- archive.mjs: dossierlogica, saldo-audit en IndexedDB-fotoarchief
- app.mjs: interface, foto-opslag en betaalworkflow
- index.html: mobiele interface en fotovergelijking
- tests/core.test.mjs en tests/archive.test.mjs: regressietests
- node --test tests/*.test.mjs

Bij de release zijn 41 automatische tests op de zuivere parser- en dossierlogica uitgevoerd; JavaScript-syntaxis en HTML-id's zijn gecontroleerd. Live camera-OCR, browseropslag en Supabase zijn niet end-to-end getest. Test op het doeltoestel vóór gebruik met echte facturen.
