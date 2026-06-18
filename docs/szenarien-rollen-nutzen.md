# Szenarien, Rollen und Nutzen

Dieses Dokument beschreibt die vier Anwendungsszenarien der GRANERGIZE-WebApp, die
jeweils beteiligten Rollen und – das Entscheidende – **was jede Rolle davon hat**.
Leitgedanke ist der Nutzen im Sinne von **Geld verdienen / Ressourcen sparen**
(nicht primär CO₂-Bilanzierung).

**Grundprinzip: Teilen ist zweiseitig.** Eine Freigabe kommt nur zustande, wenn
*beide* Seiten gewinnen – A gibt nur frei, wenn A einen Vorteil hat, und B nimmt nur
an, wenn B einen Vorteil hat (und C, falls ein Dritter beteiligt ist, braucht
ebenfalls einen eigenen Nutzen). Jedes Szenario benennt daher den Nutzen **pro
Rolle**, nicht einen allgemeinen „Mehrwert".

## Rollen (die Demo-Organisationen)

- **Betreiber — Ahlmann Logistik:** betreibt das Gebäude, zahlt die Energiekosten,
  trifft Betriebs- und Investitionsentscheidungen.
- **Eigentümer / Investor — Bauer Grundbesitz:** besitzt bzw. erwirbt die Immobilie;
  achtet auf Objektwert, Risiko und Investitionsspielraum.
- **Benchmark / Berater — Conrad Kennwert:** bietet Vergleichs-/Benchmark-Leistungen,
  nutzt Daten zur Beratung und aggregiert über mehrere Gebäude.
- **Makler:** vermittelt Verkauf bzw. Vermietung zwischen Eigentümer und Investor/Mieter;
  lebt von erfolgreichen, gut bepreisten und schnellen Abschlüssen. *(Demo-Organisation noch
  offen.)*

In der App erscheinen diese als Datenzimmer-Mitgliedsrollen bzw. als Freigabe-Ziele.

## Szenario 1 — Soll-Ist (Betrieb)

Vergleich des tatsächlichen Energieverbrauchs mit den Soll-Werten, witterungsbereinigt.

- **Betreiber:** ein *fairer* (witterungsbereinigter) Soll-Ist-Vergleich → Überverbräuche
  erkennen, Budget begründen, Sanierungen gezielt ansetzen.
- *Berater (falls geteilt):* Abweichungen als Dienstleistung analysieren.

## Szenario 2 — Vertrieb (Vermarktung / Verkauf) · Freigabe

Der Eigentümer vermarktet das Gebäude – häufig über einen Makler – an Kauf- bzw.
Mietinteressenten. Der Fluss ist mehrstufig: **Eigentümer → Makler → Investor/Mieter.**

- **Eigentümer (A, gibt frei):** eine belastbare, mit Provenienz hinterlegte Energie-Story →
  besser vermarktbar / höher bewertbar; kontrollierte Übergabe (Freigeben + Widerrufen).
- **Makler (vermittelt):** ein Objekt mit klarer Energie-Story und Standort-Chancen lässt sich
  leichter, schneller und höherpreisig vermarkten → mehr und bessere Abschlüsse, Differenzierung
  gegenüber Wettbewerbern.
- **Investor/Mieter (B, empfängt):** vertrauenswürdige Daten, die er nicht selbst zusammentragen
  muss → schnellere, risikoärmere Due Diligence.

## Szenario 3 — Benchmark (Vergleich) · Freigabe

Gebäude gleichartig vergleichen, nach Region/Typologie gruppiert.

- **Mitglied (A):** einen *fairen* Peer-Vergleich zurück → wissen, ob man über- oder
  unterdurchschnittlich abschneidet.
- **Berater/Anbieter (C):** jeder Beitrag verdichtet den Benchmark-Datenbestand, auf dem
  die Beratung aufbaut.

## Szenario 4 — Standort-Potenzial-Radar (Standort-Chancen)

Macht aus dem Standort eines Gebäudes eine gereihte Liste von Geld-/Ressourcen-Chancen
aus offenen Daten (Ausbaulücke Dach- und Freiflächen-PV, EE-Anteil + Strommix, Biomasse,
Erzeugung in der Nähe). **Mehrere Rollen profitieren:**

- **Betreiber:** eine *Handlungs*-Liste — „X MWp ungenutztes Dach ≈ Y €/Jahr", lokaler
  Grünstrom zum Beziehen → Kosten senken / Erlöse erzielen.
- **Investor:** ein *Standortqualitäts*-Signal — Energie-Chancen und -Risiken, um Objekte
  zu vergleichen und den Deal zu bepreisen.
- **Makler:** ein zusätzliches Verkaufsargument — „dieser Standort bietet …" → das Objekt hebt
  sich ab und lässt sich überzeugender präsentieren.

Anders als Szenario 1–3 (die eigene Pod-Daten betreffen) arbeitet dieses Szenario mit dem
*externen Kontext* des Standorts – und ist damit der Grund, die App schon *vor* eigenen
Pod-Daten zu öffnen.

## Teilen ist zweiseitig (die Prüffrage)

Ein Freigabe-Fluss funktioniert nur, wenn sich **für jede Partei** ein Gewinn benennen lässt:

- **A (gibt frei):** Was habe ich davon, dies herzugeben? (ein Geschäft, ein Benchmark, eine
  Dienstleistung, ein Nachweis)
- **B (empfängt):** Warum ist es vertrauenswürdig und nützlich? (Provenienz, spart eigene
  Erhebung, ermöglicht meine Aufgabe)
- **C (Dritter):** Was ist der aggregierte Nutzen? (ein reichhaltigerer Datenbestand, ein
  Marktüberblick)

Flüsse können auch **mehrstufig** verlaufen (z. B. Eigentümer → Makler → Investor); dann braucht
jede Zwischenstation – etwa der Makler – ebenfalls einen eigenen Gewinn.

Lässt sich für eine Partei kein Gewinn benennen, kommt der Fluss nicht zustande.

## Datengrundlage (Szenario 4)

Alle Karten verbinden sich über den **AGS** (Amtlicher Gemeindeschlüssel):
`linked-energieatlas` (Potenziale/Anteile, Bayern) + `linked-mastr` (installierte Anlagen
in der Nähe) + `linked-lau` (Region) + gebäudescharf `linked-lod2-by` (Dach ≈ €/Jahr).
