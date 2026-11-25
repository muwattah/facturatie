# FactuurCheck — v0.4.0

Lokale testversie voor gezinsfacturen. Scanner, dossiercontrole en dashboard worden eerst getest; gedeelde opslag en gezinsaccounts blijven uitgeschakeld.

## Start

Open https://muwattah.github.io/facturatie/?v=0.4.0 en controleer de versie onderaan. Kies Lokale test starten. Gebruik uitsluitend fictieve of geanonimiseerde gegevens voor deze ontwikkelfase. De bestaande browseropslag en het IndexedDB-fotoarchief blijven behouden.

## Scanner

- Foto of PDF (maximaal 20 MB; maximaal 20 PDF-pagina's). Gebruik één factuur/dossier per bestand; de app splitst geen PDF met verschillende facturen.
- PDF.js leest digitale tekst rechtstreeks, rendert pagina's en gebruikt OCR wanneer belangrijke velden ontbreken. De eerste pagina wordt naast het formulier getoond; via Open origineel bestand is de volledige PDF toegankelijk. Beveiligde PDF's met wachtwoord worden niet ondersteund.
- Foto's: contrastoptimalisatie, drie OCR-rondes waar nodig, waarschuwingen voor mogelijke onscherpte/donkerte en handmatige rotatie. Geen automatische perspectiefcorrectie of betrouwbare auto-crop in deze versie.
- EPC/SEPA betaal-QR via BarcodeDetector of jsQR. Gevalideerde IBAN, bedrag, begunstigde en Belgische gestructureerde mededeling worden als aanklikbare voorstellen weergegeven. Onbekende/proprietaire QR-formaten en betaallinks worden niet geopend of gevolgd. Geen automatische betaling.
- Optionele ingebouwde browser-AI (LanguageModel Prompt API): leest OCR-tekst lokaal en stelt velden voor. Vereist een compatibele browser en lokaal model; mogelijk moet dit model gedownload worden. Op browsers zonder deze functie werkt de gewone OCR. Dit is geen universele AI-beeldherkenning en geen cloud-AI. AI-voorstellen moeten worden gecontroleerd op het origineel.
- OCR: Nederlands, Frans, Engels, overheidsdiensten, gemeenten, bedrijven, openstaand saldo, creditbedrag, factuurnummers, dossierkenmerken, IBAN en mededeling. Vervaldatum wordt afzonderlijk voorgesteld als er een duidelijke datumvermelding is.
- Foto of PDF blijft bij het dossier in originele bytes. Bij mogelijke dubbele facturen worden de eerdere documenten getoond.

## Dossiercontrole en betalingen

Vergelijk bestandshash, gestructureerde mededeling, factuur-/dossiernummers, leverancier, IBAN, bedrag, datum, oorspronkelijke bedragen en soort document. Een identiek bestand is geen nieuwe schuld. Vergelijkbare identificatienummers en herinneringen zonder eenduidige match vereisen controle. Een gewijzigd bedrag of IBAN bij een sterke match, creditnota, aanmaning of incassodocument kan de betaling blokkeren totdat bank en leverancier het werkelijke saldo bevestigen.

- Deelbetalingen: registreer werkelijk betaald bedrag, bankdatum en optionele notitie. Het oorspronkelijke bedrag blijft bewaard. Resterend saldo wordt berekend uit bevestigde betalingen.
- Correctie: draai een foutieve betalingsregistratie terug met behoud van de audittrail; het dossier wordt geblokkeerd tot saldocontrole.
- Creditnota of gewijzigde herinnering: bevestig het werkelijke openstaande saldo na controle. De app trekt een creditnota of herinneringskosten niet automatisch af/toe. Nul openstaand sluit een dossier af zonder een fictieve bankbetaling te maken. Voor creditnota's wordt een positief kredietbedrag ingevoerd.
- Het dossier bewaart alle oorspronkelijke documenten en saldocontroles. Een oude status betaald uit vorige versies is geen nieuwe banktransactie en wordt niet als nieuwe maanduitgave meegeteld.
- Geen automatische bankcontrole, geen automatische overschrijving en geen garantie dat alle duplicaten gevonden worden. Controleer altijd bank en schuldeiser.
- Lokale browserlocks helpen bij gelijktijdige wijzigingen als de browser Web Locks ondersteunt. Geen bescherming tussen verschillende toestellen tot de gedeelde database gebouwd en getest is.

## Dashboard

Bevestigd openstaand saldo, geregistreerde betalingen deze maand, dossiers op controle, vervallen facturen, facturen binnen zeven dagen, deelbetalingen, uitgaven per categorie en recente maanden. Dossiers op controle zijn bewust uitgesloten van bevestigd openstaand saldo. Statistieken tellen uitsluitend de nieuwe niet-gecorrigeerde betalingsregistraties mee. Zoek en filter op status en categorie.

## Acceptatietest vóór stap 3

- [ ] Foto van Stad Antwerpen met correct bedrag en leverancier.
- [ ] Foto van een onbekende leverancier en meerdere datumnotaties.
- [ ] Digitale PDF met meerdere pagina's en gescande PDF.
- [ ] EPC betaal-QR met geldig IBAN en bedrag; afwijkend bedrag blijft te controleren.
- [ ] AI-voorstellen op ondersteunde browser; OCR-fallback op smartphone.
- [ ] Dezelfde factuur opnieuw scannen zonder tweede schuld.
- [ ] Herinnering met ander factuurnummer of bedrag; oorspronkelijke foto blijft bewaard.
- [ ] Deelbetaling, tweede deelbetaling en herladen.
- [ ] Creditnota met gedeeltelijk saldo en creditnota waarmee saldo nul wordt.
- [ ] Foutieve betalingsregistratie corrigeren; betaling blokkeren tot controle.
- [ ] Gewijzigd IBAN op dezelfde factuur: waarschuwing.
- [ ] Dashboard, categorieën en vervaldatumfilter vergelijken met handmatig berekende totalen.
- [ ] Originele foto en PDF opnieuw openen na herladen.

Pas na expliciete goedkeuring van deze gebruikersacceptatietests is stap 3 aan de beurt: Supabase, gezinsaccounts, private bestanden en back-ups. De bestaande schema.sql is niet compatibel met de nieuwe lokale dossierstructuur. Activeer deze niet voor v0.4.0.

## Privacy en beperkingen

Foto/PDF, OCR-tekst en factuurgegevens worden niet naar GitHub of een externe AI-dienst gestuurd. De applicatie haalt bibliotheken en OCR-modellen via CDN's op. De lokale gegevens zijn niet door deze app versleuteld; browsergegevens wissen, privévensters, opslagquota en toestelverlies kunnen gegevensverlies veroorzaken. Gebruik geen echte administratie totdat de beveiligde opslag en back-up zijn geïmplementeerd. Er is nog geen productie-AI-service of universeel ondersteunde AI op telefoons.

## Technisch

- core.mjs — OCR-velden en vergelijking
- scanner.mjs — PDF, QR, vervaldatum, kwaliteit, lokale AI
- archive.mjs — dossiers en originele bestanden
- ledger.mjs — betalingshistoriek, saldocontrole, dashboard
- app.mjs / index.html — interface
- tests/*.test.mjs — 58 automatische logica-tests; uitvoeren met node --test tests/*.test.mjs

Voor deze release zijn de zuivere logica-tests uitgevoerd via een JavaScript-testharnas, en modulesyntaxis en DOM-id's gecontroleerd. De echte PDF-rendering, camera-OCR, QR-detectie, lokale browser-AI, opslag en volledige browserworkflow moeten nog op echte toestellen worden getest. Een geslaagde unit test is geen productieacceptatie.
