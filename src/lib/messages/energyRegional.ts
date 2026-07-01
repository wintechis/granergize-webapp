/** Catalog slice — Energy / observation / weather / map surfaces, regional-statistics context, attribution & the data-sources credits page.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const energyRegional = {
  // Energy / observation / weather / map surfaces (final i18n batch).
  aggNotFound: {
    en: "Aggregation not found",
    de: "Aggregation nicht gefunden",
    fr: "Agrégation introuvable",
  },
  energyCertChip: {
    en: "Energy certificate",
    de: "Energieausweis",
    fr: "Certificat énergétique",
  },
  bhDownloadData: {
    en: "Download building data (Excel)",
    de: "Gebäudedaten herunterladen (Excel)",
    fr: "Télécharger les données du bâtiment (Excel)",
  },
  erSwitchAria: {
    en: "Energy data resolution",
    de: "Energiedaten-Auflösung",
    fr: "Résolution des données énergétiques",
  },
  erAnnual: { en: "Annual", de: "Jährlich", fr: "Annuel" },
  erTimeSeries: { en: "Time series", de: "Zeitreihe", fr: "Série temporelle" },
  naShowLog: {
    en: "Show network request log",
    de: "Netzwerk-Anfrageprotokoll anzeigen",
    fr: "Afficher le journal des requêtes réseau",
  },
  naTitle: { en: "Network requests", de: "Netzwerkanfragen", fr: "Requêtes réseau" },
  naShowLogShort: {
    en: "Show request log",
    de: "Anfrageprotokoll anzeigen",
    fr: "Afficher le journal",
  },
  naRequestsLoading: {
    en: "{count} request(s) loading — click for the request log",
    de: "{count} Anfrage(n) werden geladen — für das Protokoll klicken",
    fr: "{count} requête(s) en cours — cliquez pour le journal",
  },
  nlTitle: {
    en: "Notifications",
    de: "Benachrichtigungen",
    fr: "Notifications",
  },
  nlShowLog: {
    en: "Show notification log",
    de: "Benachrichtigungsprotokoll anzeigen",
    fr: "Afficher le journal des notifications",
  },
  nlShowLogShort: {
    en: "Show notification log",
    de: "Benachrichtigungsprotokoll anzeigen",
    fr: "Afficher le journal",
  },
  nlRecent: {
    en: "{count} recent",
    de: "{count} aktuelle",
    fr: "{count} récentes",
  },
  nlEmpty: {
    en: "No notifications yet.",
    de: "Noch keine Benachrichtigungen.",
    fr: "Aucune notification pour le moment.",
  },
  ucMonth: { en: "Month", de: "Monat", fr: "Mois" },
  ucDayView: { en: "Day View", de: "Tagesansicht", fr: "Vue journalière" },
  ucDailyTotals: { en: "Daily Totals", de: "Tagessummen", fr: "Totaux journaliers" },
  ucAvgProfile: { en: "Average Profile", de: "Durchschnittsprofil", fr: "Profil moyen" },
  ucDate: { en: "Date", de: "Datum", fr: "Date" },
  wdParameter: {
    en: "Weather Parameter",
    de: "Wetterparameter",
    fr: "Paramètre météo",
  },
  wdStation: { en: "Weather Station", de: "Wetterstation", fr: "Station météo" },
  wdLoadingStations: {
    en: "Loading stations…",
    de: "Stationen werden geladen…",
    fr: "Chargement des stations…",
  },
  wdValue: { en: "Value", de: "Wert", fr: "Valeur" },
  wdQuality: { en: "Quality", de: "Qualität", fr: "Qualité" },
  aeOperatorAvg: {
    en: "Operator average",
    de: "Betreiber-Durchschnitt",
    fr: "Moyenne de l'exploitant",
  },
  aePortfolioAvg: {
    en: "Portfolio average",
    de: "Portfolio-Durchschnitt",
    fr: "Moyenne du portefeuille",
  },
  aeBenchmark: { en: "Benchmark", de: "Benchmark", fr: "Référence" },
  aeBenchmarkProvidedBy: {
    en: "Benchmark provided by",
    de: "Benchmark bereitgestellt von",
    fr: "Référence fournie par",
  },
  // Regional-context section (linked-regionalstatistik external observations).
  regContextTitle: {
    en: "Regional context ({region})",
    de: "Regionaler Kontext ({region})",
    fr: "Contexte régional ({region})",
  },
  regRenewableShare: {
    en: "Renewable electricity share",
    de: "Anteil erneuerbarer Stromerzeugung",
    fr: "Part d'électricité renouvelable",
  },
  regDataSource: {
    en: "Data source: Regionalstatistik (statistical offices of the Federation and the Länder)",
    de: "Datenquelle: Regionalstatistik (Statistische Ämter des Bundes und der Länder)",
    fr: "Source des données : Regionalstatistik (offices statistiques de la Fédération et des Länder)",
  },
  // The `open` tier of the Aggregations finder — public regionalstatistik datasets.
  openRegionalMeta: {
    en: "Public regional statistics",
    de: "Öffentliche Regionalstatistik",
    fr: "Statistiques régionales publiques",
  },
  regDatasetBack: { en: "← Aggregations", de: "← Aggregationen", fr: "← Agrégations" },
  regDatasetEmpty: {
    en: "No figures available for this region.",
    de: "Keine Werte für diese Region verfügbar.",
    fr: "Aucune donnée disponible pour cette région.",
  },
  regDatasetUnknown: {
    en: "Unknown dataset.",
    de: "Unbekannter Datensatz.",
    fr: "Jeu de données inconnu.",
  },
  regGeoCaption: {
    en: "Figures for the federal state of {region}, not this building specifically.",
    de: "Werte für das Bundesland {region}, nicht für dieses Gebäude im Einzelnen.",
    fr: "Valeurs pour le Land de {region}, pas pour ce bâtiment en particulier.",
  },
  // Kreis-grain regional caption — figures for the district, joined via the
  // building's location (linked-mastr → nearest unit's AGS).
  regGeoCaptionKreis: {
    en: "Figures for the district {region}, not this building specifically.",
    de: "Werte für den Kreis {region}, nicht für dieses Gebäude im Einzelnen.",
    fr: "Valeurs pour l'arrondissement {region}, pas pour ce bâtiment en particulier.",
  },
  // Kreis-grain industrial renewable-energy use (table 43531, carrier = renewable).
  regKreisRenewableUse: {
    en: "Renewable energy use in industry",
    de: "Energieverbrauch erneuerbarer Energien im Verarbeitenden Gewerbe",
    fr: "Consommation d'énergies renouvelables dans l'industrie",
  },
  // Additional choropleth metrics (GRANERGIZE-relevant regionalstatistik tables).
  regPrimaryEnergy: {
    en: "Primary energy consumption",
    de: "Primärenergieverbrauch",
    fr: "Consommation d'énergie primaire",
  },
  regDistrictHeatChp: {
    en: "District heat from cogeneration",
    de: "Fernwärmeerzeugung aus Kraft-Wärme-Kopplung",
    fr: "Chaleur urbaine issue de la cogénération",
  },
  regGhgPerCapita: {
    en: "Greenhouse-gas emissions per capita",
    de: "Treibhausgasemissionen pro Kopf",
    fr: "Émissions de gaz à effet de serre par habitant",
  },
  regHeatPumpPermits: {
    en: "New multi-family buildings permitted with heat pumps",
    de: "Baugenehmigungen Mehrfamilienhäuser mit Wärmepumpe",
    fr: "Permis de construire d'immeubles collectifs avec pompe à chaleur",
  },
  regHeatPumpCompletions: {
    en: "New multi-family buildings completed with heat pumps",
    de: "Baufertigstellungen Mehrfamilienhäuser mit Wärmepumpe",
    fr: "Immeubles collectifs achevés avec pompe à chaleur",
  },
  // Nearby renewable installations section (linked-mastr — finest grain).
  niTitle: {
    en: "Nearby renewable installations",
    de: "Erneuerbare Anlagen in der Nähe",
    fr: "Installations renouvelables à proximité",
  },
  niSummary: {
    en: "{count} within {radius} km",
    de: "{count} im Umkreis von {radius} km",
    fr: "{count} dans un rayon de {radius} km",
  },
  niDistance: { en: "{km} km", de: "{km} km", fr: "{km} km" },
  niViewAria: {
    en: "Nearby installations view",
    de: "Ansicht der Anlagen in der Nähe",
    fr: "Vue des installations à proximité",
  },
  niKindSolar: { en: "Solar", de: "Solar", fr: "Solaire" },
  niKindWind: { en: "Wind", de: "Wind", fr: "Éolien" },
  niKindHydro: { en: "Hydro", de: "Wasser", fr: "Hydraulique" },
  niKindBiomass: { en: "Biomass", de: "Biomasse", fr: "Biomasse" },
  niUnnamed: { en: "(unnamed installation)", de: "(unbenannte Anlage)", fr: "(installation sans nom)" },
  niCaption: {
    en: "Individual installations near this building, by location — not its own energy data.",
    de: "Einzelne Anlagen in der Nähe dieses Gebäudes, nach Standort — nicht seine eigenen Energiedaten.",
    fr: "Installations individuelles proches de ce bâtiment, par localisation — pas ses propres données énergétiques.",
  },
  niDataSource: {
    en: "Data source: Marktstammdatenregister (Bundesnetzagentur)",
    de: "Datenquelle: Marktstammdatenregister (Bundesnetzagentur)",
    fr: "Source des données : Marktstammdatenregister (Bundesnetzagentur)",
  },
  nrTitle: {
    en: "Nearby rooftop solar potential",
    de: "Solar-Dachpotenzial in der Nähe",
    fr: "Potentiel solaire des toitures à proximité",
  },
  nrSummary: {
    en: "{count} rooftops within {radius} m · ~{kwp} kWp total",
    de: "{count} Dächer im Umkreis von {radius} m · ~{kwp} kWp gesamt",
    fr: "{count} toitures dans un rayon de {radius} m · ~{kwp} kWp au total",
  },
  nrKwp: { en: "{kwp} kWp", de: "{kwp} kWp", fr: "{kwp} kWp" },
  nrViewAria: {
    en: "Nearby rooftops view",
    de: "Ansicht der Dächer in der Nähe",
    fr: "Vue des toitures à proximité",
  },
  nrCaption: {
    en:
      "Estimated rooftop-PV potential of nearby buildings, by location — not their actual energy data.",
    de:
      "Geschätztes Dach-PV-Potenzial benachbarter Gebäude, nach Standort — nicht ihre tatsächlichen Energiedaten.",
    fr:
      "Potentiel photovoltaïque estimé des toitures voisines, par localisation — pas leurs données énergétiques réelles.",
  },
  nrDataSource: {
    en: "Data source: LoD2 building model (LDBV Bayern), rooftop potential computed in-app",
    de: "Datenquelle: LoD2-Gebäudemodell (LDBV Bayern), Dachpotenzial in der App berechnet",
    fr:
      "Source des données : modèle de bâtiment LoD2 (LDBV Bayern), potentiel de toiture calculé dans l'application",
  },
  // Generic "Data source:" prefix (building producer attribution, weather, …).
  dataSourceLabel: {
    en: "Data source:",
    de: "Datenquelle:",
    fr: "Source des données :",
  },
  // Coordinate attribution (geocoded via OpenStreetMap/Nominatim).
  coordsLabel: {
    en: "Coordinates:",
    de: "Koordinaten:",
    fr: "Coordonnées :",
  },
  // The authoritative LoD2-BY (LDBV cadastre-derived) address, shown alongside the recorded one.
  addrLod2Label: {
    en: "Official address:",
    de: "Amtliche Adresse:",
    fr: "Adresse officielle :",
  },
  // Baked LoD2-BY (LDBV) building metadata rows, shown in the master-data section.
  lod2AlkisIdLabel: {
    en: "ALKIS building id",
    de: "ALKIS-Gebäude-ID",
    fr: "Identifiant de bâtiment ALKIS",
  },
  lod2RoofTypeLabel: {
    en: "Roof type (AdV code)",
    de: "Dachform (AdV-Code)",
    fr: "Type de toit (code AdV)",
  },
  lod2StoreysLabel: {
    en: "Storeys above ground",
    de: "Oberirdische Geschosse",
    fr: "Étages hors-sol",
  },
  lod2CreationDateLabel: {
    en: "LoD2 record date",
    de: "LoD2-Erfassungsdatum",
    fr: "Date d'enregistrement LoD2",
  },
  // Logo attribution tooltip (org logo resolved from Wikidata → Wikimedia Commons).
  logoViaCommons: {
    en: "Logo via Wikimedia Commons (Wikidata)",
    de: "Logo über Wikimedia Commons (Wikidata)",
    fr: "Logo via Wikimedia Commons (Wikidata)",
  },
  // Data sources & licences credits page (profile menu + page).
  menuDataSources: {
    en: "Data sources and licences",
    de: "Datenquellen und Lizenzen",
    fr: "Sources de données et licences",
  },
  dsIntro: {
    en:
      "The app combines data from these external sources, each shown with its licence. Attribution travels with any building you share.",
    de:
      "Die App kombiniert Daten aus diesen externen Quellen, jeweils mit Lizenz. Die Namensnennung wird mit jedem geteilten Gebäude weitergegeben.",
    fr:
      "L'application combine des données de ces sources externes, chacune avec sa licence. L'attribution est transmise avec chaque bâtiment partagé.",
  },
} satisfies Record<string, Message>;
