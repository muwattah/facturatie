# Stap 3 – Supabase (voorbereiding)
Status: ontwikkelversie, nog NIET geactiveerd in de website. De bestaande lokale v0.4.0 blijft werken. Gebruik uitsluitend fictieve testfacturen totdat de cloudacceptatie is geslaagd.

## Eenmalige installatie
1. Maak een Supabase-account aan en een nieuw project FactuurCheck-Test in een beschikbare EU-regio. Kies het Free-plan voor de test. Bewaar het databasewachtwoord veilig.
2. Gebruik **step3_foundation.sql** in SQL Editor, niet het oude schema.sql. Voer alleen uit in een nieuw, leeg testproject. De migratie is eenmalig en nog niet live gevalideerd.
3. Maak gezinsgebruikers in Authentication / Users; bevestig hun accounts en schakel openbare registratie uit indien niet nodig. Provisioning-instructies staan onderaan het SQL-bestand. Elk gezinslid krijgt een eigen login.
4. De edge function factuurcheck moet worden uitgerold vanuit de GitHub-broncode (supabase/functions/factuurcheck plus _shared). Met de Supabase CLI: link het testproject, deploy de functie met expliciete authenticatie in de handler (supabase functions deploy factuurcheck --no-verify-jwt). De handler valideert altijd de bearer access token via auth.getUser. Test dat een ontbrekende/ongeldige token wordt geweigerd.
5. Koppel cloud.mjs aan de browserinterface en toon alleen de publieke project-URL en publishable/anon key in de configuratie. Service-role/secret key blijft uitsluitend aan de serverzijde, nooit in GitHub, clientcode of chat.
6. Test de volledige installatie met fictieve gegevens op twee toestellen en minstens twee afzonderlijke huishoudens. Pas daarna de gezinsmodus activeren.

## Ontwerp
- De private bucket factuurcheck-private bewaart originele foto/PDF per huishoud-UUID en server-berekende SHA-256. Alleen leden van dat huishouden kunnen lezen; schrijven gebeurt door de gevalideerde serverfunctie. Geen publieke links. De gateway accepteert uitsluitend geselecteerde bestandstypen en maximaal 20 MB.
- De server gebruikt een momentopname van de bestaande v0.4 dossierstructuur. Een revision compare-and-swap in PostgreSQL voorkomt gelijktijdige overschrijvingen. De browser mag nooit zelf een volledig archief terugschrijven. Dit ontwerp is bedoeld voor een klein huishouden; grotere archieven vereisen genormaliseerde tabellen en paginering.
- Betaling wordt servermatig gereserveerd voor een specifieke gebruiker; alleen die gebruiker kan de eigen reservering bevestigen/vrijgeven. Historische betalingen worden expliciet bevestigd. Geen automatische overschrijving. Elke mutatie krijgt een uniek operation ID en auditregel. Een conflict of time-out is geen betaaltoestemming.
- Browserinterface gebruikt op dit moment nog de lokale opslag. cloud.mjs bevat de voorbereide adapter. Er is nog geen automatische lokale import, realtime push-sync, herstelprocedure voor een verloren reserverend account, automatische opruiming van ongekoppelde uploads na conflict of geteste volledige back-up/restore.
- De server heeft een snapshot van de pure v0.4 vergelijkings- en betalingslogica in _shared; toekomstige wijzigingen moeten in beide versies gelijk blijven en worden getest.

## Acceptatie vóór gezinsgebruik
- Onbevoegde gebruikers en gebruikers van een ander huishouden kunnen geen dossiers lezen, schrijven of bestanden downloaden.
- Anonieme gebruikers kunnen niets lezen of muteren; ingelogde gebruikers kunnen niet rechtstreeks de archive-commit RPC uitvoeren.
- Een origineel document wordt uitsluitend privé opgeslagen, en kan met een geldig eigen account worden geopend.
- Twee toestellen scannen tegelijk dezelfde factuur: één registratie; een tweede poging krijgt conflict of bestaande match.
- Twee toestellen reserveren tegelijk: één bevestigd resultaat. Verlies van netwerk is geen bevestiging. Refresh toont de serverstatus.
- Herinnering, verhoogd bedrag, deelbetaling, creditnota en gewijzigd IBAN houden oude documenten en betalingen intact.
- Een herhaalde operation ID veroorzaakt geen tweede mutatie.
- Maak een beveiligde database-export EN een afzonderlijke export van de private storage-bestanden. Databaseback-ups alleen bevatten de originele documenten niet. Test herstel in een apart project; sla exports niet op in de openbare repo.
- Lokale testgegevens mogen niet ongemerkt naar de cloud. Ontwerp een expliciete import met duplicaatcontrole en controle van de oude status.
- Test authenticatie, sessie-verval, accountverwijdering, RLS, privébestanden, SQL-migratie, Deno edge deployment en browserintegratie live. Acht pure serverlogica-tests zijn uitgevoerd, geen live Supabase-tests.

## Kosten
Free-plan heeft opslaglimieten en kan na inactiviteit worden gepauzeerd. Controleer actuele tarieven op https://supabase.com/pricing. Foto's en PDF's nemen vooral file storage in beslag. Gebruik een passende beveiligde back-upstrategie.
