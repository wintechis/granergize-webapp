/** Catalog slice — the public landing page (`src/pages/Landing.tsx`): a German-first
 * marketing page (hero, value cards, use cases, data-sovereignty, preview, get-started,
 * login, footer), fully de/en/fr like the rest of the app-chrome catalog.
 *
 * Part of the message catalog assembled in `../messages.ts`. */
import type { Message } from "./messageTypes.ts";

export const landing = {
  // ── Header nav ──────────────────────────────────────────────────────────
  landingNavWhat: {
    en: "What is Granergize?",
    de: "Was ist Granergize?",
    fr: "Qu’est-ce que Granergize ?",
  },
  landingNavUseCases: {
    en: "Use cases",
    de: "Anwendungsfälle",
    fr: "Cas d’usage",
  },
  landingNavSovereignty: {
    en: "Data sovereignty",
    de: "Datenhoheit",
    fr: "Souveraineté des données",
  },
  landingNavPreview: { en: "Preview", de: "Vorschau", fr: "Aperçu" },
  landingNavLogin: { en: "Log in", de: "Anmelden", fr: "Se connecter" },
  landingNavCreate: {
    en: "Create account",
    de: "Konto erstellen",
    fr: "Créer un compte",
  },

  // ── Hero ────────────────────────────────────────────────────────────────
  landingHeroEyebrow: {
    en: "Research project · Fraunhofer IIS and FAU Erlangen-Nürnberg",
    de: "Forschungsprojekt · Fraunhofer IIS und FAU Erlangen-Nürnberg",
    fr: "Projet de recherche · Fraunhofer IIS et FAU Erlangen-Nuremberg",
  },
  landingHeroTitle: {
    en: "The energy data of your logistics real estate — comparable, shareable, in your hands.",
    de: "Energiedaten Ihrer Logistikimmobilien — vergleichbar, teilbar, in Ihrer Hand.",
    fr: "Les données énergétiques de vos immobiliers logistiques — comparables, partageables, entre vos mains.",
  },
  landingHeroLead: {
    en: "Granergize makes the energy use of your logistics real estate visible and comparable — and lets you share it without giving up control of your data.",
    de: "Granergize macht den Energieverbrauch Ihrer Logistikimmobilien sichtbar und vergleichbar — und lässt Sie ihn teilen, ohne die Hoheit über Ihre Daten abzugeben.",
    fr: "Granergize rend visible et comparable la consommation d’énergie de vos immobiliers logistiques — et vous la laisse partager sans céder le contrôle de vos données.",
  },
  landingHeroCtaPrimary: {
    en: "Create a free account",
    de: "Kostenloses Konto erstellen",
    fr: "Créer un compte gratuit",
  },
  landingTrustFree: {
    en: "Free and no installation",
    de: "Kostenlos und ohne Installation",
    fr: "Gratuit et sans installation",
  },
  landingTrustOpenSource: {
    en: "Open source (AGPL-3.0)",
    de: "Open Source (AGPL-3.0)",
    fr: "Open source (AGPL-3.0)",
  },
  landingTrustData: {
    en: "No ads, no tracking",
    de: "Werbefrei, kein Tracking",
    fr: "Sans publicité ni traçage",
  },
  // Hero preview card (Explore mock)
  landingPreviewSub: {
    en: "Annual consumption · kWh",
    de: "Jahresverbrauch · kWh",
    fr: "Consommation annuelle · kWh",
  },
  landingLegendTitle: {
    en: "Energy lens",
    de: "Energie-Linse",
    fr: "Lentille énergétique",
  },
  landingLegendEfficient: {
    en: "More efficient",
    de: "Effizienter",
    fr: "Plus efficace",
  },
  landingLegendTypical: { en: "Typical", de: "Typisch", fr: "Typique" },
  landingLegendLess: {
    en: "Less efficient",
    de: "Weniger effizient",
    fr: "Moins efficace",
  },

  // ── What is Granergize? ──────────────────────────────────────────────────
  landingWhatTitle: {
    en: "Energy use finally made visible — in language everyone understands.",
    de: "Energieverbrauch endlich sichtbar — in einer Sprache, die jeder versteht.",
    fr: "La consommation d’énergie enfin visible — dans un langage que tout le monde comprend.",
  },
  landingWhatLead: {
    en: "Electricity, gas, heat and water for your halls are scattered today across spreadsheets, e-mails and other people’s systems. Granergize brings them together and turns figures into decisions.",
    de: "Strom, Gas, Wärme und Wasser Ihrer Hallen liegen heute verstreut in Tabellen, E-Mails und fremden Systemen. Granergize führt sie zusammen und macht aus Zahlen Entscheidungen.",
    fr: "L’électricité, le gaz, la chaleur et l’eau de vos halls sont aujourd’hui dispersés dans des tableurs, des e-mails et des systèmes tiers. Granergize les rassemble et transforme les chiffres en décisions.",
  },
  landingValue1Title: {
    en: "Everything in one place",
    de: "Alles an einem Ort",
    fr: "Tout au même endroit",
  },
  landingValue1Body: {
    en: "Record consumption per building and year — or read a whole Excel list in at once. No more hunting through scattered files.",
    de: "Erfassen Sie Verbrauchswerte je Gebäude und Jahr — oder lesen Sie eine ganze Excel-Liste auf einmal ein. Schluss mit Suchen in verstreuten Dateien.",
    fr: "Saisissez les consommations par bâtiment et par année — ou importez une liste Excel entière d’un coup. Fini la recherche dans des fichiers éparpillés.",
  },
  landingValue2Title: {
    en: "Compare at a glance",
    de: "Auf einen Blick vergleichen",
    fr: "Comparer d’un coup d’œil",
  },
  landingValue2Body: {
    en: "The map shades your buildings by energy efficiency. Every figure sits next to portfolio, operator and benchmark averages.",
    de: "Die Karte färbt Ihre Gebäude nach Energieeffizienz. Jede Kennzahl steht neben Portfolio-, Betreiber- und Benchmark-Durchschnitt.",
    fr: "La carte colore vos bâtiments selon leur efficacité énergétique. Chaque indicateur côtoie les moyennes du portefeuille, de l’exploitant et du benchmark.",
  },
  landingValue3Title: {
    en: "Share securely, give up nothing",
    de: "Sicher teilen, nichts abgeben",
    fr: "Partager en toute sécurité, sans rien céder",
  },
  landingValue3Body: {
    en: "Release individual buildings or years selectively — revocable at any time. Your data is never copied in the process.",
    de: "Geben Sie einzelne Gebäude oder Jahre gezielt frei — jederzeit widerrufbar. Ihre Daten werden dabei nie kopiert.",
    fr: "Donnez accès à des bâtiments ou des années précis — révocable à tout moment. Vos données ne sont jamais copiées au passage.",
  },

  // ── Use cases ────────────────────────────────────────────────────────────
  landingUcEyebrow: {
    en: "Three use cases",
    de: "Drei Anwendungsfälle",
    fr: "Trois cas d’usage",
  },
  landingUcTitle: {
    en: "Made for people like Alice, Bob and Charlie.",
    de: "Gemacht für Menschen wie Alice, Bob und Charlie.",
    fr: "Conçu pour des personnes comme Alice, Bob et Charlie.",
  },
  landingUcLead: {
    en: "Three people, three everyday tasks from the world of logistics real estate — and how Granergize solves them.",
    de: "Drei Personen, drei typische Aufgaben aus dem Logistikimmobilien-Alltag — und wie Granergize sie löst.",
    fr: "Trois personnes, trois tâches courantes du quotidien de l’immobilier logistique — et comment Granergize les résout.",
  },
  landingUcStep: {
    en: "Use case {n}",
    de: "Anwendungsfall {n}",
    fr: "Cas d’usage {n}",
  },
  landingUc1Title: {
    en: "Plan vs. actual comparison",
    de: "Soll-Ist-Vergleich",
    fr: "Comparaison prévu / réel",
  },
  landingUc1Desc: {
    en: "Put planned figures next to actual consumption — and see immediately whether a measure like an LED retrofit really worked. All within your own portfolio, with no third parties.",
    de: "Stellen Sie geplante Werte den tatsächlichen Verbräuchen gegenüber — und sehen Sie sofort, ob eine Maßnahme wie eine LED-Umrüstung wirklich gewirkt hat. Alles im eigenen Bestand, ohne weitere Beteiligte.",
    fr: "Comparez les valeurs prévues à la consommation réelle — et voyez aussitôt si une mesure comme un passage aux LED a vraiment porté ses fruits. Le tout dans votre propre parc, sans aucun tiers.",
  },
  landingUc1Role: {
    en: "Ahlmann Logistik GmbH · uses its own halls",
    de: "Ahlmann Logistik GmbH · nutzt eigene Hallen",
    fr: "Ahlmann Logistik GmbH · exploite ses propres halls",
  },
  landingUc1Quote: {
    en: "At last I can see in black and white whether the LED retrofit actually paid off.",
    de: "Endlich sehe ich schwarz auf weiß, ob die LED-Umrüstung wirklich etwas gebracht hat.",
    fr: "Je vois enfin noir sur blanc si le passage aux LED a vraiment servi à quelque chose.",
  },
  landingUc2Title: {
    en: "Sales support",
    de: "Vertriebsunterstützung",
    fr: "Aide à la vente",
  },
  landingUc2Desc: {
    en: "A hall’s energy quality becomes a selling point — with real figures instead of estimates. The owner shares their data selectively while keeping full sovereignty.",
    de: "Die energetische Qualität einer Halle wird zum Verkaufsargument — mit echten statt geschätzten Zahlen. Der Eigentümer gibt seine Daten gezielt frei, behält aber die volle Hoheit.",
    fr: "La qualité énergétique d’un hall devient un argument de vente — avec des chiffres réels plutôt qu’estimés. Le propriétaire partage ses données de façon ciblée tout en gardant la pleine maîtrise.",
  },
  landingUc2Role: {
    en: "Bauer Grundbesitz · broker and adviser",
    de: "Bauer Grundbesitz · Makler und Berater",
    fr: "Bauer Grundbesitz · courtier et conseiller",
  },
  landingUc2Quote: {
    en: "I argue with documented figures when selling — not with estimates any more.",
    de: "Mit belegten Zahlen argumentiere ich beim Verkauf — nicht mehr mit Schätzungen.",
    fr: "Je négocie avec des chiffres documentés lors de la vente — plus avec des estimations.",
  },
  landingUc3Title: {
    en: "Energy-consumption benchmark",
    de: "Energieverbrauchsbenchmark",
    fr: "Benchmark de consommation énergétique",
  },
  landingUc3Desc: {
    en: "Place a building within its industry. A benchmark provider condenses several owners’ data into an industry average — everyone sees only the result, never the individual figures.",
    de: "Ordnen Sie ein Gebäude im Branchenvergleich ein. Ein Benchmark-Dienstleister verdichtet die Daten mehrerer Eigentümer zu einem Branchenschnitt — jeder sieht nur das Ergebnis, nie die Einzelwerte.",
    fr: "Situez un bâtiment par rapport à son secteur. Un prestataire de benchmark condense les données de plusieurs propriétaires en une moyenne sectorielle — chacun ne voit que le résultat, jamais les valeurs individuelles.",
  },
  landingUc3Role: {
    en: "Conrad Kennwert GmbH · benchmark provider",
    de: "Conrad Kennwert GmbH · Benchmark-Dienstleister",
    fr: "Conrad Kennwert GmbH · prestataire de benchmark",
  },
  landingUc3Quote: {
    en: "I make halls comparable without anyone seeing anyone else’s data.",
    de: "Ich mache Hallen vergleichbar, ohne dass jemand die Daten des anderen sieht.",
    fr: "Je rends les halls comparables sans que personne ne voie les données des autres.",
  },

  // ── Data sovereignty (dark) ──────────────────────────────────────────────
  landingSovEyebrow: {
    en: "Your data stays your data",
    de: "Ihre Daten bleiben Ihre Daten",
    fr: "Vos données restent vos données",
  },
  landingSovTitle: {
    en: "No central server where all the data sits together.",
    de: "Kein zentraler Server, auf dem alle Daten zusammenliegen.",
    fr: "Aucun serveur central où toutes les données sont réunies.",
  },
  landingSovLead: {
    en: "Your data lives on your personal Solid Pod — a private data store that only you control. Granergize fetches it only with your permission.",
    de: "Ihre Daten liegen auf Ihrem persönlichen Solid Pod — einem privaten Datenspeicher, den nur Sie kontrollieren. Granergize holt sie nur mit Ihrer Erlaubnis ab.",
    fr: "Vos données résident sur votre Solid Pod personnel — un espace de stockage privé que vous seul contrôlez. Granergize n’y accède qu’avec votre autorisation.",
  },
  landingSov1Title: {
    en: "You stay in control",
    de: "Sie behalten die Kontrolle",
    fr: "Vous gardez le contrôle",
  },
  landingSov1Body: {
    en: "You alone decide who may see which file — and you can take it back at any time.",
    de: "Wer welche Datei sehen darf, entscheiden allein Sie — und nehmen es jederzeit wieder zurück.",
    fr: "Vous seul décidez qui peut voir quel fichier — et vous pouvez le révoquer à tout moment.",
  },
  landingSov2Title: {
    en: "Runs in the browser",
    de: "Läuft im Browser",
    fr: "Fonctionne dans le navigateur",
  },
  landingSov2Body: {
    en: "No installation, no local software. Chrome, Edge, Firefox or Safari are enough.",
    de: "Keine Installation, keine lokale Software. Chrome, Edge, Firefox oder Safari genügen.",
    fr: "Aucune installation, aucun logiciel local. Chrome, Edge, Firefox ou Safari suffisent.",
  },
  landingSov3Title: {
    en: "Open and auditable",
    de: "Offen und überprüfbar",
    fr: "Ouvert et vérifiable",
  },
  landingSov3Body: {
    en: "The source code is freely available (AGPL-3.0). You can even run the app yourself.",
    de: "Der Quellcode ist frei zugänglich (AGPL-3.0). Sie können die App sogar selbst betreiben.",
    fr: "Le code source est librement accessible (AGPL-3.0). Vous pouvez même héberger l’application vous-même.",
  },
  landingFlowApp: {
    en: "Granergize app",
    de: "Granergize-App",
    fr: "Application Granergize",
  },
  landingFlowAppSub: {
    en: "runs in your browser",
    de: "läuft in Ihrem Browser",
    fr: "s’exécute dans votre navigateur",
  },
  landingFlowPod: {
    en: "Your Solid Pod",
    de: "Ihr Solid Pod",
    fr: "Votre Solid Pod",
  },
  landingFlowPodSub: {
    en: "your private data store — only you control it",
    de: "Ihr privater Datenspeicher — nur Sie kontrollieren ihn",
    fr: "votre espace de stockage privé — vous seul le contrôlez",
  },
  landingFlowPartner: {
    en: "Business partner",
    de: "Geschäftspartner",
    fr: "Partenaire commercial",
  },
  landingFlowPartnerSub: {
    en: "reads shared data straight from your Pod — never via a middleman",
    de: "liest geteilte Daten direkt von Ihrem Pod — nie über einen Mittelsmann",
    fr: "lit les données partagées directement depuis votre Pod — jamais via un intermédiaire",
  },

  // ── Preview ──────────────────────────────────────────────────────────────
  landingPreviewEyebrow: {
    en: "Here’s how it looks",
    de: "So sieht es aus",
    fr: "Voici à quoi cela ressemble",
  },
  landingPreviewTitle: {
    en: "Map, key figures and comparison — in a single view.",
    de: "Karte, Kennzahlen und Vergleich — in einer Ansicht.",
    fr: "Carte, indicateurs et comparaison — dans une seule vue.",
  },
  landingPreviewLead: {
    en: "Pick a building on the map and see master data, energy use and benchmarks side by side.",
    de: "Wählen Sie ein Gebäude auf der Karte und sehen Sie Stammdaten, Energieverbrauch und Benchmarks nebeneinander.",
    fr: "Choisissez un bâtiment sur la carte et voyez côte à côte les données de base, la consommation d’énergie et les benchmarks.",
  },

  // ── Get started ──────────────────────────────────────────────────────────
  landingStartEyebrow: {
    en: "Ready in 3 steps",
    de: "In 3 Schritten startklar",
    fr: "Prêt en 3 étapes",
  },
  landingStartTitle: {
    en: "How to get started",
    de: "So legen Sie los",
    fr: "Comment démarrer",
  },
  landingStartLead: {
    en: "All you need is a Solid Pod — your personal data store. Setting it up takes a few minutes.",
    de: "Sie brauchen nur einen Solid Pod — Ihren persönlichen Datenspeicher. Das Einrichten dauert wenige Minuten.",
    fr: "Il vous suffit d’un Solid Pod — votre espace de stockage personnel. La configuration ne prend que quelques minutes.",
  },
  landingStep1Title: {
    en: "Create a Solid Pod",
    de: "Solid Pod erstellen",
    fr: "Créer un Solid Pod",
  },
  landingStep2Title: {
    en: "Note your WebID",
    de: "WebID notieren",
    fr: "Notez votre WebID",
  },
  landingStep2Body: {
    en: "Your WebID is built from the Pod name — your address on the Solid network, e.g.",
    de: "Aus dem Pod-Namen entsteht Ihre WebID – Ihre Adresse im Solid-Netz, z. B.",
    fr: "Votre WebID se construit à partir du nom du Pod — votre adresse sur le réseau Solid, par ex.",
  },
  landingStep3Title: {
    en: "Log in to Granergize",
    de: "In Granergize anmelden",
    fr: "Se connecter à Granergize",
  },
  landingStep3Body: {
    en: "Choose an identity provider, log in there and confirm access — done.",
    de: "Identity Provider wählen, beim Anbieter anmelden und den Zugriff bestätigen — fertig.",
    fr: "Choisissez un fournisseur d’identité, connectez-vous chez lui et confirmez l’accès — c’est fait.",
  },

  // ── Login dialog title ───────────────────────────────────────────────────
  landingLoginModalTitle: {
    en: "Sign in to Granergize",
    de: "Bei Granergize anmelden",
    fr: "Se connecter à Granergize",
  },

  // ── Footer ───────────────────────────────────────────────────────────────
  landingFooterBlurb: {
    en: "A graph-based data space for energy-efficient logistics properties. Bring consumption data together, compare it and share it on your own terms.",
    de: "Graphenbasierter Datenraum für energieeffiziente Logistikimmobilien. Verbrauchsdaten zusammenführen, vergleichen und souverän teilen.",
    fr: "Un espace de données basé sur les graphes pour des immobiliers logistiques économes en énergie. Rassemblez, comparez et partagez vos données de consommation en toute souveraineté.",
  },
  landingFooterProduct: { en: "Product", de: "Produkt", fr: "Produit" },
  landingFooterResources: {
    en: "Resources",
    de: "Ressourcen",
    fr: "Ressources",
  },
  landingFooterStart: { en: "Get started", de: "Loslegen", fr: "Démarrer" },
  landingResCreatePod: {
    en: "Create a Solid Pod",
    de: "Solid Pod erstellen",
    fr: "Créer un Solid Pod",
  },
  landingResSource: {
    en: "Source code (GitHub)",
    de: "Quellcode (GitHub)",
    fr: "Code source (GitHub)",
  },
  landingResAboutSolid: {
    en: "About Solid",
    de: "Über Solid",
    fr: "À propos de Solid",
  },
  landingFundingTitle: { en: "Funding.", de: "Förderung.", fr: "Financement." },
  landingFundingBody: {
    en: "Granergize is a project of the Industrial Collective Research (IGF), funded by the German Federal Ministry for Economic Affairs and Energy (BMWE). Funding reference 01IF23286N · duration April 2024 – June 2026.",
    de: "Granergize ist ein Vorhaben der Industriellen Gemeinschaftsforschung (IGF), gefördert vom Bundesministerium für Wirtschaft und Energie (BMWE). Förderkennzeichen 01IF23286N · Laufzeit April 2024 – Juni 2026.",
    fr: "Granergize est un projet de la recherche collective industrielle (IGF), financé par le ministère fédéral allemand de l’Économie et de l’Énergie (BMWE). Référence de financement 01IF23286N · durée avril 2024 – juin 2026.",
  },
  landingCopyright: {
    en: "© 2026 Fraunhofer IIS and FAU Erlangen-Nürnberg · Open source under AGPL-3.0",
    de: "© 2026 Fraunhofer IIS und FAU Erlangen-Nürnberg · Open Source unter AGPL-3.0",
    fr: "© 2026 Fraunhofer IIS et FAU Erlangen-Nuremberg · Open source sous AGPL-3.0",
  },
} satisfies Record<string, Message>;
