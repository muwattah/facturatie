# FactuurCheck — v0.1

Mobiele webapp voor Belgische gezinsfacturen. OCR (Nederlands, Frans, Engels), handmatige controle, dubbele-factuurwaarschuwingen, geschiedenis en betaalreservering. Geen automatische bankbetaling of bankkoppeling.

## Snel testen (zonder backend)

1. Open GitHub → Settings → Pages van deze repository.
2. Kies **Deploy from a branch**, branch **main**, map **/(root)** en Save.
3. Open de URL die GitHub Pages toont (normaal https://muwattah.github.io/facturatie/).
4. Kies Lokale test starten. Gebruik fictieve gegevens.
5. Je kunt tekst plakken onder Herkende tekst bekijken of plakken. Bijvoorbeeld:

       Factuurnummer: TEST-001
       Factuurdatum: 26/11/2026
       Totaal te betalen EUR 124,50
       +++123/4567/89002+++

   Vul leverancier Testbedrijf in, controleer de velden en registreer.
6. Kies Ik ga betalen en daarna Betaling bevestigen. Scan of plak opnieuw dezelfde factuur: AL BETAALD.
7. Test ook met een echte foto van een zelfgemaakte fictieve factuur.

Lokaal starten kan ook met Python: voer vanuit de repo **python -m http.server 8000** uit en open http://localhost:8000. Open index.html niet rechtstreeks met file://.

Lokale opslag is per browser/toestel, niet gedeeld, niet versleuteld door deze app, en kan verloren gaan bij het wissen van browsergegevens. Het is geen betrouwbare gezinsadministratie.

## Gezinsmodus (Supabase)

Geen eigen draaiende server nodig. Maak zelf een Supabase-project aan op https://supabase.com/dashboard (bij voorkeur een EU-regio). Controleer de actuele abonnementslimieten. Gebruik een nieuw project voor deze test.

1. Open SQL Editor, plak de volledige inhoud van **supabase/schema.sql** en voer één keer uit.
2. Maak in Authentication → Users voor ieder gezinslid een eigen gebruiker (e-mail en wachtwoord). Schakel publieke aanmelding uit indien niet nodig. Bevestig de accounts via de dashboardoptie indien beschikbaar.
3. Maak in SQL Editor een huishouden:

       insert into public.households(name) values ('Ons gezin') returning id;

4. Kopieer de teruggegeven huishoud-UUID. Kopieer per gezinslid de gebruikers-UUID uit Authentication → Users. Voer voor elk gezinslid de volgende SQL uit met de echte UUID's:

       insert into public.household_members(user_id,household_id)
       values ('USER_UUID','HOUSEHOLD_UUID');

5. Kopieer de Project URL en publieke publishable key (of legacy anon key) vanuit het Supabase-dashboard. Gebruik **NOOIT** een service_role of secret key in de app of op GitHub.
6. Open FactuurCheck → Gezinsmodus instellen / inloggen. Vul URL, publieke key, eigen e-mail en wachtwoord in. Herhaal op elk toestel.
7. De app onthoudt de publieke configuratie lokaal; na herladen opnieuw inloggen. Testfacturen uit de lokale modus worden niet geïmporteerd.

De app bewaart alleen bevestigde factuurvelden en betaalstatus. Foto en volledige OCR-tekst worden niet naar de database gestuurd. OCR draait in de browser, met bibliotheken en taalmodellen die via internet worden geladen. Gebruik de app alleen via HTTPS; de code is openbaar maar de database is afgeschermd door login en Row Level Security.

## Betalingsregels

- Exacte overeenkomst: geldige gestructureerde mededeling of genormaliseerd factuurnummer bij dezelfde leverancier of IBAN. Bestaande registratie wordt getoond en een tweede registratie geblokkeerd.
- Mogelijke overeenkomst: dezelfde leverancier/rekening en bedrag met datumverschil maximaal 31 dagen (of ontbrekende datum). Alleen na controle kun je toch registreren.
- Nieuwe factuur betekent uitsluitend geen overeenkomst in dit archief. Controleer altijd of ze al betaald is bij de bank.
- Reserveer eerst via Ik ga betalen. Betaal alleen na een bevestigde reservering. Markeer vervolgens betaald na de bankbetaling.
- Als een oud archiefstuk al betaald is, registreer het en doorloop de betaalstatus zonder nog eens geld over te schrijven. Controleer de bank. De geregistreerde bevestigingsdatum is de app-datum, niet de historische bankdatum.
- Als OCR gegevens niet herkent, vul ze handmatig in. De leverancier moet handmatig bevestigd worden. PDF's worden in deze versie niet rechtstreeks ondersteund.
- Hergebruikte gestructureerde mededelingen en factuurnummers kunnen tot onterechte blokkades leiden. OCR-fouten of ontbrekende historische gegevens kunnen tot gemiste dubbele facturen leiden.
- Alleen gezinsleden die de app vóór elke betaling gebruiken, profiteren van de reserveringscontrole. Er is geen automatische verificatie bij de bank.

## Testplan

| Test | Verwacht |
|---|---|
| Nieuwe factuur | Nog te betalen |
| Zelfde factuur vóór betaling | Al geregistreerd |
| Reserveer, scan opnieuw | Betaling bezig |
| Bevestig betaling, scan opnieuw | Al betaald |
| Andere leverancier, zelfde bedrag | Nieuwe factuur |
| Zelfde leverancier/bedrag, ander nummer en nabije datum | Mogelijke dubbele factuur |
| Ongeldig controlegetal of IBAN | Handmatige correctie vereist |
| Herladen lokale modus | Registraties blijven bewaard |
| Twee gezinsaccounts zelfde factuur tegelijk registreren | Eén registratie, tweede krijgt bestaande factuur |
| Twee toestellen gelijktijdig reserveren | Eén reservering slaagt |
| Account zonder huishoudlidmaatschap | Geen toegang |
| Tweede huishouden | Geen toegang tot eerste huishouden |
| Internet uit in gezinsmodus | Foutmelding; nooit stil overschakelen op lokaal |

## Technisch

- index.html: mobiele UI
- app.mjs: OCR, opslag, authenticatie, betaalworkflow
- core.mjs: herkenning en vergelijking
- supabase/schema.sql: gegevensmodel, RLS, beveiligde RPC's, atomaire registratie en statuswijziging
- tests/core.test.mjs: unit tests; uitvoeren met **node --test tests/core.test.mjs**
- manifest.webmanifest: beginschermmetadata; geen volledige offline PWA

De databasefuncties serialiseren nieuwe registraties per huishouden en gebruiken een conditionele statuswijziging voor betaling. Er is geen automatisch vergrendelingsverval: bij afgebroken betaling moet iemand de status handmatig en na bankcontrole terugzetten. Alle gezinsleden kunnen status corrigeren; behandel ze als vertrouwde gebruikers.

De eerste versie heeft nog geen end-to-end browsertest, live databasevalidatie, automatische export/back-up, PDF-import of bankintegratie. Test met fictieve facturen voor gebruik met echte data. Stel in Supabase een passende back-upstrategie in voor echte administratie.
