/**
 * App-chrome message catalog + translator (M5 app-chrome i18n, slice 2).
 *
 * The OTHER text population from the vocab-derived labels (`vocabLabels.ts`): the
 * UI strings with no ontology term — empty states, buttons, dialog titles, the
 * notification vocabulary. A bundled `{de,en,fr}` map keyed by a stable, language-
 * neutral id (English is the authoring baseline); no runtime fetch, mirroring the
 * vocab-label stance. Read through `useT()` (`context/I18nProvider`) so a locale
 * switch re-renders with no refetch; the active locale is the one shared signal
 * (`lib/language.ts`) that also drives the vocab label map.
 *
 * Pure (no React) so it stays hermetically testable. Interpolation is by NAMED
 * params (`{name}`), never positional, so word order can differ across languages;
 * a plural entry carries one string per `Intl.PluralRules` category, selected by
 * `{count}`.
 */
import { DEFAULT_LANG, getLanguage, type Lang } from "./language.ts";

/** A message is one string per language, OR — for counts — one string per plural
 * category (selected via `Intl.PluralRules` on `{count}`). `other` is required. */
type PluralForms = { other: string } & Partial<
  Record<Intl.LDMLPluralRule, string>
>;
type Message = Record<Lang, string> | Record<Lang, PluralForms>;

/** Named interpolation params; `count` additionally drives plural selection. */
export type MessageParams = Record<string, string | number>;

/**
 * The catalog. Add an id here with its de/en/fr strings; the id is what code
 * references via `t(id)`, so a translator never touches the call sites.
 */
export const MESSAGES = {
  // Finder empty states — the highest-value app-chrome prose to translate (each is
  // a self-contained `"No X yet. <how to get one>"` per the UI conventions).
  contactsEmpty: {
    en: "No contacts yet. Add one by WebID or QR code.",
    de: "Noch keine Kontakte. Füge einen per WebID oder QR-Code hinzu.",
    fr: "Aucun contact pour l'instant. Ajoutez-en un par WebID ou QR code.",
  },
  buildingsEmpty: {
    en: "No buildings yet. Add one, or autofill it from a file.",
    de: "Noch keine Gebäude. Füge eines hinzu oder fülle es automatisch aus einer Datei.",
    fr:
      "Aucun bâtiment pour l'instant. Ajoutez-en un, ou remplissez-le automatiquement à partir d'un fichier.",
  },
  observationsEmpty: {
    en:
      "No observations yet. Add energy data on a building's observation page to see it here.",
    de:
      "Noch keine Beobachtungen. Füge Energiedaten auf der Beobachtungsseite eines Gebäudes hinzu, um sie hier zu sehen.",
    fr:
      "Aucune observation pour l'instant. Ajoutez des données énergétiques sur la page d'observation d'un bâtiment pour les voir ici.",
  },
  aggregationsEmpty: {
    en:
      "No aggregations yet. Create one to aggregate energy values across buildings.",
    de:
      "Noch keine Aggregationen. Erstelle eine, um Energiewerte über Gebäude hinweg zu aggregieren.",
    fr:
      "Aucune agrégation pour l'instant. Créez-en une pour agréger les valeurs énergétiques de plusieurs bâtiments.",
  },
  roomsEmpty: {
    en: "No data rooms yet. Host one, or add one by URI or QR code.",
    de:
      "Noch keine Datenzimmer. Erstelle einen oder füge einen per URI oder QR-Code hinzu.",
    fr:
      "Aucune salle de données pour l'instant. Créez-en une, ou ajoutez-en une par URI ou QR code.",
  },
  sharedBuildingsEmpty: {
    en:
      "No buildings shared with you yet. Join a data room so owners can find you, or ask an owner to share with your WebID.",
    de:
      "Noch keine mit dir geteilten Gebäude. Tritt einem Datenzimmer bei, damit Eigentümer dich finden, oder bitte einen Eigentümer, mit deiner WebID zu teilen.",
    fr:
      "Aucun bâtiment partagé avec vous pour l'instant. Rejoignez une salle de données pour que les propriétaires vous trouvent, ou demandez à un propriétaire de partager avec votre WebID.",
  },
  uiLanguage: { en: "Language", de: "Sprache", fr: "Langue" },
  // ⌘K command palette (plan-palette §4).
  palettePlaceholder: {
    en: "Type a command…",
    de: "Befehl eingeben…",
    fr: "Saisir une commande…",
  },
  paletteEmpty: {
    en: "No matching commands",
    de: "Keine passenden Befehle",
    fr: "Aucune commande correspondante",
  },
  paletteGroupNavigation: { en: "Go to", de: "Gehe zu", fr: "Aller à" },
  paletteGroupActions: { en: "Actions", de: "Aktionen", fr: "Actions" },
  paletteOpenAria: {
    en: "Open command palette (Ctrl K)",
    de: "Befehlspalette öffnen (Strg K)",
    fr: "Ouvrir la palette de commandes (Ctrl K)",
  },
  // Top-nav finder labels.
  navBuildings: { en: "Buildings", de: "Gebäude", fr: "Bâtiments" },
  navObservations: {
    en: "Observations",
    de: "Beobachtungen",
    fr: "Observations",
  },
  navAggregations: {
    en: "Aggregations",
    de: "Aggregationen",
    fr: "Agrégations",
  },
  navSharing: { en: "Sharing", de: "Freigaben", fr: "Partages" },
  navContacts: { en: "Contacts", de: "Kontakte", fr: "Contacts" },
  navMeet: { en: "Meet", de: "Treffen", fr: "Rencontrer" },
  // Finder page headings (exact-nav-word headings reuse the nav* ids above).
  headingYourBuildings: {
    en: "Your buildings",
    de: "Deine Gebäude",
    fr: "Vos bâtiments",
  },
  headingYourRooms: {
    en: "Your data rooms",
    de: "Deine Datenzimmer",
    fr: "Vos salles de données",
  },
  sharedBuildingsHeading: {
    en: "Buildings shared with you",
    de: "Mit dir geteilte Gebäude",
    fr: "Bâtiments partagés avec vous",
  },
  headingInbox: {
    en: "Your inbox",
    de: "Dein Posteingang",
    fr: "Votre boîte de réception",
  },
  headingOutgoingShares: {
    en: "Outgoing shares",
    de: "Ausgehende Freigaben",
    fr: "Partages sortants",
  },
  // Detail-page section headings.
  secFiles: { en: "Files", de: "Dateien", fr: "Fichiers" },
  secEnergy: { en: "Energy", de: "Energie", fr: "Énergie" },
  secSharing: { en: "Sharing", de: "Freigabe", fr: "Partage" },
  secWeather: { en: "Weather", de: "Wetter", fr: "Météo" },
  secStandortProfile: {
    en: "Location energy profile",
    de: "Standort-Energieprofil",
    fr: "Profil énergétique du site",
  },
  sepRooftopPv: { en: "Rooftop PV", de: "Dach-Photovoltaik", fr: "PV en toiture" },
  sepPotential: { en: "Potential", de: "Potenzial", fr: "Potentiel" },
  sepInstalled: { en: "Installed", de: "Installiert", fr: "Installé" },
  sepHeadroom: { en: "Untapped", de: "Ausbaulücke", fr: "Inexploité" },
  sepBuiltOut: { en: "built out", de: "erschlossen", fr: "exploité" },
  sepGroundPv: { en: "Ground-mounted PV", de: "Freiflächen-Photovoltaik", fr: "PV au sol" },
  sepGreenElectricity: {
    en: "Renewable electricity",
    de: "Erneuerbarer Strom",
    fr: "Électricité renouvelable",
  },
  sepRenewable: { en: "renewable", de: "erneuerbar", fr: "renouvelable" },
  sepSolar: { en: "Solar", de: "Solar", fr: "Solaire" },
  sepWind: { en: "Wind", de: "Wind", fr: "Éolien" },
  sepBiomass: { en: "Biomass", de: "Biomasse", fr: "Biomasse" },
  sepHydro: { en: "Hydro", de: "Wasser", fr: "Hydraulique" },
  sepGeothermal: { en: "Geothermal", de: "Geothermie", fr: "Géothermie" },
  sepBiogasPotential: { en: "Biogas potential", de: "Biogaspotenzial", fr: "Potentiel biogaz" },
  sepPlants: { en: "plants", de: "Anlagen", fr: "installations" },
  sepNearbyGeneration: {
    en: "Nearby generation",
    de: "Erzeugung in der Nähe",
    fr: "Production à proximité",
  },
  sepWithin: { en: "within", de: "im Umkreis von", fr: "dans un rayon de" },
  secResults: { en: "Results", de: "Ergebnisse", fr: "Résultats" },
  secDetails: { en: "Details", de: "Details", fr: "Détails" },
  secInvite: { en: "Invite", de: "Einladung", fr: "Invitation" },
  secMembers: { en: "Members", de: "Mitglieder", fr: "Membres" },
  secMyRoles: { en: "My role(s)", de: "Meine Rolle(n)", fr: "Mes rôles" },
  secProfile: { en: "Profile", de: "Profil", fr: "Profil" },
  secAppearsIn: { en: "Appears in", de: "Erscheint in", fr: "Apparaît dans" },
  // Building master-data section headers (read view + Add/Edit form).
  secAddress: { en: "Address", de: "Adresse", fr: "Adresse" },
  secLocationPhysical: {
    en: "Location and Physical",
    de: "Lage und Gebäude",
    fr: "Emplacement et physique",
  },
  secBuildingDetails: {
    en: "Building details",
    de: "Gebäudedetails",
    fr: "Détails du bâtiment",
  },
  secHeatingSystems: {
    en: "Heating systems",
    de: "Heizsysteme",
    fr: "Systèmes de chauffage",
  },
  secHeatGeneration: {
    en: "Heat generation",
    de: "Wärmeerzeugung",
    fr: "Production de chaleur",
  },
  secOperatingCosts: {
    en: "Operating costs",
    de: "Betriebskosten",
    fr: "Charges d'exploitation",
  },
  secCertifications: {
    en: "Certifications",
    de: "Zertifizierungen",
    fr: "Certifications",
  },
  // Confirm-dialog titles (the message/button localize in a later pass).
  dlgDeleteBuilding: {
    en: "Delete building",
    de: "Gebäude löschen",
    fr: "Supprimer le bâtiment",
  },
  dlgRevokeAccess: {
    en: "Revoke access",
    de: "Zugriff entziehen",
    fr: "Révoquer l'accès",
  },
  dlgDeleteAggregation: {
    en: "Delete aggregation",
    de: "Aggregation löschen",
    fr: "Supprimer l'agrégation",
  },
  dlgRevokeAggregation: {
    en: "Revoke aggregation access",
    de: "Aggregationszugriff entziehen",
    fr: "Révoquer l'accès à l'agrégation",
  },
  dlgDeleteRoom: {
    en: "Delete data room",
    de: "Datenzimmer löschen",
    fr: "Supprimer la salle de données",
  },
  dlgDeleteFile: {
    en: "Delete file",
    de: "Datei löschen",
    fr: "Supprimer le fichier",
  },
  dlgDeleteEnergy: {
    en: "Delete energy data",
    de: "Energiedaten löschen",
    fr: "Supprimer les données énergétiques",
  },
  dlgRestoreArchive: {
    en: "Restore archive",
    de: "Archiv wiederherstellen",
    fr: "Restaurer l'archive",
  },
  dlgRemoveAppData: {
    en: "Remove all app data",
    de: "Alle App-Daten entfernen",
    fr: "Supprimer toutes les données de l'application",
  },
  // Building Add/Edit form field labels (the hardcoded ones; vocab-derived field
  // labels already localise via fieldLabel()).
  lblStreetAddress: { en: "Street address", de: "Straße", fr: "Adresse (rue)" },
  lblLocality: { en: "Locality (city)", de: "Ort (Stadt)", fr: "Localité (ville)" },
  lblPostalCode: { en: "Postal code", de: "Postleitzahl", fr: "Code postal" },
  lblRegion: { en: "Region (state)", de: "Bundesland", fr: "Région (Land)" },
  lblLatitude: { en: "Latitude", de: "Breitengrad", fr: "Latitude" },
  lblLongitude: { en: "Longitude", de: "Längengrad", fr: "Longitude" },
  lblLabelName: { en: "Label / name", de: "Bezeichnung / Name", fr: "Libellé / nom" },
  lblPvCapacity: {
    en: "PV capacity (kW)",
    de: "PV-Leistung (kW)",
    fr: "Puissance PV (kW)",
  },
  lblPvCommissioning: {
    en: "PV commissioning year",
    de: "PV-Inbetriebnahmejahr",
    fr: "Année de mise en service PV",
  },
  lblPvOperator: {
    en: "PV operator (WebID)",
    de: "PV-Betreiber (WebID)",
    fr: "Exploitant PV (WebID)",
  },
  lblBatteryCapacity: {
    en: "Battery capacity (kWh)",
    de: "Batteriekapazität (kWh)",
    fr: "Capacité de la batterie (kWh)",
  },
  lblBatteryCommissioning: {
    en: "Battery commissioning year",
    de: "Batterie-Inbetriebnahmejahr",
    fr: "Année de mise en service de la batterie",
  },
  lblBatteryOperator: {
    en: "Battery operator (WebID)",
    de: "Batterie-Betreiber (WebID)",
    fr: "Exploitant de la batterie (WebID)",
  },
  lblChpCapacity: {
    en: "CHP electrical capacity (kW)",
    de: "BHKW elektrische Leistung (kW)",
    fr: "Puissance électrique de cogénération (kW)",
  },
  lblChpThermal: {
    en: "CHP thermal output (kW)",
    de: "BHKW thermische Leistung (kW)",
    fr: "Puissance thermique de cogénération (kW)",
  },
  lblChpCommissioning: {
    en: "CHP commissioning year",
    de: "BHKW-Inbetriebnahmejahr",
    fr: "Année de mise en service de la cogénération",
  },
  lblChpOperator: {
    en: "CHP operator (WebID)",
    de: "BHKW-Betreiber (WebID)",
    fr: "Exploitant de la cogénération (WebID)",
  },
  lblOperatedBy: {
    en: "Operated by (WebID)",
    de: "Betrieben von (WebID)",
    fr: "Exploité par (WebID)",
  },
  lblOwnedBy: {
    en: "Owned by (WebID)",
    de: "Eigentümer (WebID)",
    fr: "Propriétaire (WebID)",
  },
  lblInvestor: {
    en: "Investor (WebID)",
    de: "Investor (WebID)",
    fr: "Investisseur (WebID)",
  },
  lblFacilityManager: {
    en: "Facility manager (WebID)",
    de: "Facility Manager (WebID)",
    fr: "Gestionnaire technique (WebID)",
  },
  lblDevelopedBy: {
    en: "Developed by (WebID)",
    de: "Entwickelt von (WebID)",
    fr: "Développé par (WebID)",
  },
  lblConsultant: {
    en: "Consultant / broker (WebID)",
    de: "Berater / Makler (WebID)",
    fr: "Conseiller / courtier (WebID)",
  },
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
  lensAria: {
    en: "Marker colour lens",
    de: "Marker-Farblinse",
    fr: "Filtre de couleur des marqueurs",
  },
  lensOwnership: { en: "Ownership", de: "Eigentum", fr: "Propriété" },
  lensEnergy: { en: "Energy", de: "Energie", fr: "Énergie" },
  lensTrend: { en: "Trend", de: "Trend", fr: "Tendance" },
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
  aeClimateControl: {
    en: "Climate Control",
    de: "Klimatisierung",
    fr: "Climatisation",
  },
  aeTenancyType: { en: "Tenancy Type", de: "Mietverhältnis", fr: "Type de location" },
  aeLeaseType: { en: "Lease Type", de: "Pachtart", fr: "Type de bail" },
  aeTenantIndustry: {
    en: "Tenant Industry",
    de: "Branche des Mieters",
    fr: "Secteur du locataire",
  },
  aeIndoorTemp: {
    en: "Indoor Temp. Class",
    de: "Innentemperatur-Klasse",
    fr: "Classe de température intérieure",
  },
  aeLoadingDocks: { en: "Loading Docks", de: "Laderampen", fr: "Quais de chargement" },
  aeGreenLease: {
    en: "Green Lease Share",
    de: "Green-Lease-Anteil",
    fr: "Part de bail vert",
  },
  aeCertifications: { en: "Certifications", de: "Zertifizierungen", fr: "Certifications" },
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
  // Generic "Data source:" prefix (building producer attribution, weather, …).
  dataSourceLabel: {
    en: "Data source:",
    de: "Datenquelle:",
    fr: "Source des données :",
  },
  // Building header (back link, ownership badge).
  bhBackBuildings: { en: "← Buildings", de: "← Gebäude", fr: "← Bâtiments" },
  chipOwned: { en: "Owned", de: "Eigentum", fr: "Propriété" },
  chipSharedWithYou: {
    en: "Shared with you",
    de: "Mit Ihnen geteilt",
    fr: "Partagé avec vous",
  },
  // Master-data section heading + inline edit.
  secMasterData: { en: "Master data", de: "Stammdaten", fr: "Données de base" },
  btnEdit: { en: "Edit", de: "Bearbeiten", fr: "Modifier" },
  // Files section (component) — complements the existing filesEmpty (canWrite text).
  filesEmptyReadonly: {
    en: "No files yet.",
    de: "Noch keine Dateien.",
    fr: "Aucun fichier pour l'instant.",
  },
  btnDownloading: {
    en: "Downloading…",
    de: "Wird heruntergeladen…",
    fr: "Téléchargement…",
  },
  btnWorking: { en: "Working…", de: "Wird verarbeitet…", fr: "En cours…" },
  filesAdd: {
    en: "Add files",
    de: "Dateien hinzufügen",
    fr: "Ajouter des fichiers",
  },
  // Energy summary on the building page.
  essNoData: {
    en: "No energy data yet.",
    de: "Noch keine Energiedaten.",
    fr: "Pas encore de données énergétiques.",
  },
  essOpenEnergyPage: {
    en: "Open the energy page to add a year",
    de: "Energieseite öffnen, um ein Jahr hinzuzufügen",
    fr: "Ouvrir la page d'énergie pour ajouter une année",
  },
  essViewCharts: {
    en: "View energy charts →",
    de: "Energiediagramme ansehen →",
    fr: "Voir les graphiques d'énergie →",
  },
  essYearsSummary: {
    en: {
      one: "{count} year of energy data (latest: {year})",
      other: "{count} years of energy data (latest: {year})",
    },
    de: {
      one: "{count} Jahr Energiedaten (aktuellstes: {year})",
      other: "{count} Jahre Energiedaten (aktuellstes: {year})",
    },
    fr: {
      one: "{count} année de données énergétiques (dernière : {year})",
      other: "{count} années de données énergétiques (dernière : {year})",
    },
  },
  // Compact metric column-header abbreviations — UI chrome (the full metric
  // display labels come from the vocab via annualMetricLabel).
  metricShortElectricity: { en: "Electricity", de: "Strom", fr: "Électricité" },
  metricShortHeat: { en: "Heat", de: "Wärme", fr: "Chaleur" },
  metricShortWater: { en: "Water", de: "Wasser", fr: "Eau" },
  metricShortWastewater: { en: "Wastewater", de: "Abwasser", fr: "Eaux usées" },
  metricShortRenewable: { en: "Renewable %", de: "Erneuerbar %", fr: "Renouvelable %" },
  metricShortGeneration: { en: "Generation", de: "Erzeugung", fr: "Production" },
  // Aggregation metric-group categories (CreateAggregationDialog checklist).
  aggGroupConsumption: {
    en: "Annual Consumption",
    de: "Jahresverbrauch",
    fr: "Consommation annuelle",
  },
  aggGroupGeneration: {
    en: "Renewable Generation",
    de: "Erneuerbare Erzeugung",
    fr: "Production renouvelable",
  },
  // Weather section (component stragglers).
  wdSunshineDuration: {
    en: "Sunshine Duration Annual",
    de: "Sonnenscheindauer (jährlich)",
    fr: "Durée d'ensoleillement (annuelle)",
  },
  wdMeanTemperature: {
    en: "Mean Temperature Annual",
    de: "Mittlere Temperatur (jährlich)",
    fr: "Température moyenne (annuelle)",
  },
  wdPrecipitation: {
    en: "Precipitation Annual",
    de: "Niederschlag (jährlich)",
    fr: "Précipitations (annuelles)",
  },
  wdDistanceNA: { en: "Distance N/A", de: "Entfernung n. v.", fr: "Distance n/d" },
  wdNoStations: {
    en: "No weather stations found near this location for the selected parameter.",
    de:
      "Keine Wetterstationen in der Nähe für den gewählten Parameter gefunden.",
    fr:
      "Aucune station météo trouvée à proximité pour le paramètre sélectionné.",
  },
  wdNoData: {
    en: "No weather data available for the selected station and parameter.",
    de: "Keine Wetterdaten für die gewählte Station und den Parameter verfügbar.",
    fr:
      "Aucune donnée météo disponible pour la station et le paramètre sélectionnés.",
  },
  wdRecentData: {
    en: "Recent Weather Data",
    de: "Aktuelle Wetterdaten",
    fr: "Données météo récentes",
  },
  wdStationCaption: {
    en: "Station {id}: {name}",
    de: "Station {id}: {name}",
    fr: "Station {id} : {name}",
  },
  // Explore map legends (trend lens + ownership lens).
  legendImproving: { en: "Improving", de: "Verbessert sich", fr: "En amélioration" },
  legendLittleChange: {
    en: "Little change",
    de: "Kaum Veränderung",
    fr: "Peu de changement",
  },
  legendWorsening: {
    en: "Worsening",
    de: "Verschlechtert sich",
    fr: "En dégradation",
  },
  legendNoTrend: {
    en: "No trend yet",
    de: "Noch kein Trend",
    fr: "Pas encore de tendance",
  },
  legendMyBuildings: {
    en: "My buildings",
    de: "Meine Gebäude",
    fr: "Mes bâtiments",
  },
  legendSharedWithMe: {
    en: "Shared with me",
    de: "Mit mir geteilt",
    fr: "Partagés avec moi",
  },
  // User-energy (sub-hourly electricity series) chart labels.
  uecNoData: {
    en: "No data available for this date.",
    de: "Keine Daten für dieses Datum verfügbar.",
    fr: "Aucune donnée disponible pour cette date.",
  },
  uecDailyTotal: { en: "Daily total:", de: "Tagessumme:", fr: "Total journalier :" },
  uecReadingsCount: {
    en: { one: "{count} reading", other: "{count} readings" },
    de: { one: "{count} Messwert", other: "{count} Messwerte" },
    fr: { one: "{count} relevé", other: "{count} relevés" },
  },
  uecAvgDaily: {
    en: "Average daily consumption:",
    de: "Durchschnittlicher Tagesverbrauch:",
    fr: "Consommation journalière moyenne :",
  },
  uecDaysCount: {
    en: { one: "{count} day", other: "{count} days" },
    de: { one: "{count} Tag", other: "{count} Tage" },
    fr: { one: "{count} jour", other: "{count} jours" },
  },
  uecDailyConsumption: {
    en: "Daily Consumption (kWh)",
    de: "Tagesverbrauch (kWh)",
    fr: "Consommation journalière (kWh)",
  },
  uecAvgProfilePre: {
    en: "Average 15-minute profile across",
    de: "Durchschnittliches 15-Minuten-Profil über",
    fr: "Profil moyen sur 15 minutes sur",
  },
  uecAvgKwh: { en: "Average kWh", de: "Durchschnitt kWh", fr: "Moyenne kWh" },
  // SeriesEnergy chart title.
  seriesElectricityTitle: {
    en: "Electricity Consumption for {building}",
    de: "Stromverbrauch für {building}",
    fr: "Consommation d'électricité pour {building}",
  },
  // Observation page (Energy.tsx) load-error + no-data states.
  energyLoadError: {
    en: "Error loading data: {error}",
    de: "Fehler beim Laden der Daten: {error}",
    fr: "Erreur de chargement des données : {error}",
  },
  energyNoneShared: {
    en: "No energy data available for this building. You may not have access to this data.",
    de:
      "Für dieses Gebäude sind keine Energiedaten verfügbar. Möglicherweise haben Sie keinen Zugriff darauf.",
    fr:
      "Aucune donnée énergétique disponible pour ce bâtiment. Vous n'y avez peut-être pas accès.",
  },
  energyNoneOwn: {
    en: "No energy data yet. Use the “Edit energy years” button above to add a year.",
    de:
      "Noch keine Energiedaten. Verwenden Sie oben die Schaltfläche „Energiejahre bearbeiten“, um ein Jahr hinzuzufügen.",
    fr:
      "Pas encore de données énergétiques. Utilisez le bouton « Modifier les années d'énergie » ci-dessus pour ajouter une année.",
  },
  // Building master-data READ-view row labels (MasterDataSection ReadView).
  mdOperatedBy: { en: "Operated by", de: "Betrieben von", fr: "Exploité par" },
  mdOwnedBy: { en: "Owned by", de: "Eigentümer", fr: "Propriétaire" },
  mdInvestor: { en: "Investor", de: "Investor", fr: "Investisseur" },
  mdFacilityManager: {
    en: "Facility manager",
    de: "Gebäudeverwalter",
    fr: "Gestionnaire d'installations",
  },
  mdDevelopedBy: { en: "Developed by", de: "Entwickelt von", fr: "Développé par" },
  mdConsultant: {
    en: "Consultant / broker",
    de: "Berater / Makler",
    fr: "Conseiller / courtier",
  },
  mdBuildingArea: { en: "Building area", de: "Gebäudefläche", fr: "Surface du bâtiment" },
  mdLandArea: { en: "Land area", de: "Grundstücksfläche", fr: "Surface du terrain" },
  mdHallArea: { en: "Hall area", de: "Hallenfläche", fr: "Surface de la halle" },
  mdOfficeArea: {
    en: "Office and social area",
    de: "Büro- und Sozialfläche",
    fr: "Surface de bureaux et sociale",
  },
  mdBuildingHeight: {
    en: "Building height",
    de: "Gebäudehöhe",
    fr: "Hauteur du bâtiment",
  },
  mdLoadingDocks: { en: "Loading docks", de: "Laderampen", fr: "Quais de chargement" },
  mdYearConstruction: {
    en: "Year of construction",
    de: "Baujahr",
    fr: "Année de construction",
  },
  mdYearRenovation: {
    en: "Year of renovation",
    de: "Sanierungsjahr",
    fr: "Année de rénovation",
  },
  mdShiftRegime: { en: "Shift regime", de: "Schichtbetrieb", fr: "Régime de travail" },
  mdTenancyType: { en: "Tenancy type", de: "Mietverhältnis", fr: "Type de location" },
  mdLeaseType: { en: "Lease type", de: "Pachtart", fr: "Type de bail" },
  mdTenantIndustry: {
    en: "Tenant industry",
    de: "Branche des Mieters",
    fr: "Secteur du locataire",
  },
  mdIndoorTemp: {
    en: "Indoor temperature",
    de: "Innentemperatur",
    fr: "Température intérieure",
  },
  mdPvSystem: { en: "PV system", de: "PV-Anlage", fr: "Système PV" },
  mdPvOperator: { en: "PV operator", de: "PV-Betreiber", fr: "Exploitant PV" },
  mdBatteryStorage: {
    en: "Battery storage",
    de: "Batteriespeicher",
    fr: "Stockage par batterie",
  },
  mdBatteryOperator: {
    en: "Battery operator",
    de: "Batterie-Betreiber",
    fr: "Exploitant batterie",
  },
  mdChpSystem: { en: "Cogeneration (CHP)", de: "BHKW (KWK)", fr: "Cogénération" },
  mdChpOperator: {
    en: "CHP operator",
    de: "BHKW-Betreiber",
    fr: "Exploitant cogénération",
  },
  mdDistrictHeating: { en: "District heating", de: "Fernwärme", fr: "Chauffage urbain" },
  mdHeatPump: { en: "Heat pump", de: "Wärmepumpe", fr: "Pompe à chaleur" },
  mdGasBoiler: { en: "Gas boiler", de: "Gaskessel", fr: "Chaudière à gaz" },
  mdOilBoiler: { en: "Oil boiler", de: "Ölkessel", fr: "Chaudière à fioul" },
  mdElectricBoiler: {
    en: "Electric boiler",
    de: "Elektrokessel",
    fr: "Chaudière électrique",
  },
  // Operating-cost category labels (the investor opcost form rows).
  lblOpcostWasteDisposal: {
    en: "Waste disposal",
    de: "Abfallentsorgung",
    fr: "Élimination des déchets",
  },
  lblOpcostInsurance: { en: "Insurance", de: "Versicherung", fr: "Assurance" },
  lblOpcostOperationInspectionAndMaintenance: {
    en: "Operation, inspection and maintenance",
    de: "Betrieb, Inspektion und Wartung",
    fr: "Exploitation, inspection et maintenance",
  },
  lblOpcostRoutineCleaningOffice: {
    en: "Routine cleaning (office)",
    de: "Unterhaltsreinigung (Büro)",
    fr: "Nettoyage courant (bureau)",
  },
  lblOpcostRoutineCleaningWarehouse: {
    en: "Routine cleaning (warehouse)",
    de: "Unterhaltsreinigung (Lager)",
    fr: "Nettoyage courant (entrepôt)",
  },
  lblOpcostGlassCleaning: {
    en: "Glass cleaning",
    de: "Glasreinigung",
    fr: "Nettoyage des vitres",
  },
  lblOpcostExteriorMaintenance: {
    en: "Exterior maintenance",
    de: "Außenanlagenpflege",
    fr: "Entretien extérieur",
  },
  lblOpcostSecurity: { en: "Security", de: "Sicherheit", fr: "Sécurité" },
  lblOpcostPropertyManagement: {
    en: "Property management",
    de: "Objektverwaltung",
    fr: "Gestion immobilière",
  },
  lblOpcostCaretaker: { en: "Caretaker", de: "Hausmeister", fr: "Concierge" },
  lblOpcostRepairAndMaintenance: {
    en: "Repair and maintenance",
    de: "Reparatur und Instandhaltung",
    fr: "Réparation et entretien",
  },
  // Certification form-row labels.
  lblCertType: { en: "Type", de: "Typ", fr: "Type" },
  lblCertLevel: { en: "Level", de: "Stufe", fr: "Niveau" },
  lblCertScope: { en: "Scope", de: "Geltungsbereich", fr: "Portée" },
  lblCertificationN: {
    en: "Certification {n}",
    de: "Zertifizierung {n}",
    fr: "Certification {n}",
  },
  // Create-aggregation dialog form-field labels (the radio/metric/mode chrome is a
  // separate follow-up slice).
  aggTypeLabel: {
    en: "Aggregation type",
    de: "Aggregationsart",
    fr: "Type d'agrégation",
  },
  aggSelectBuildings: {
    en: "Select Buildings",
    de: "Gebäude auswählen",
    fr: "Sélectionner les bâtiments",
  },
  aggNameLabel: {
    en: "Aggregation name",
    de: "Name der Aggregation",
    fr: "Nom de l'agrégation",
  },
  aggMonthLabel: { en: "Month", de: "Monat", fr: "Mois" },
  aggCreateTitle: {
    en: "Create aggregation",
    de: "Aggregation erstellen",
    fr: "Créer une agrégation",
  },
  aggCreatingSnapshot: {
    en: "Creating aggregation and computing snapshot…",
    de: "Aggregation wird erstellt und Snapshot berechnet…",
    fr: "Création de l'agrégation et calcul de l'instantané…",
  },
  aggModeAnnual: {
    en: "Annual portfolio",
    de: "Jahresportfolio",
    fr: "Portefeuille annuel",
  },
  aggModeMonthly: {
    en: "Monthly (15-minute series)",
    de: "Monatlich (15-Minuten-Reihe)",
    fr: "Mensuel (série de 15 minutes)",
  },
  aggModeBenchmark: {
    en: "Compare shared buildings",
    de: "Geteilte Gebäude vergleichen",
    fr: "Comparer les bâtiments partagés",
  },
  aggDescAnnual: {
    en:
      "Aggregate annual energy figures across your buildings. The computed values are " +
      "stored as a privacy-preserving snapshot that can be shared without revealing the " +
      "source buildings.",
    de:
      "Aggregiere die Jahresenergiewerte über deine Gebäude. Die berechneten Werte werden " +
      "als datenschutzfreundlicher Snapshot gespeichert, der geteilt werden kann, ohne die " +
      "zugrunde liegenden Gebäude offenzulegen.",
    fr:
      "Agrégez les valeurs énergétiques annuelles de vos bâtiments. Les valeurs calculées " +
      "sont stockées sous forme d'instantané préservant la confidentialité, partageable sans " +
      "révéler les bâtiments sources.",
  },
  aggDescMonthly: {
    en:
      "Aggregate monthly electricity consumption across buildings that carry a 15-minute " +
      "load profile. The result is a privacy-preserving snapshot of the combined kWh total.",
    de:
      "Aggregiere den monatlichen Stromverbrauch über Gebäude mit einem 15-Minuten-Lastprofil. " +
      "Das Ergebnis ist ein datenschutzfreundlicher Snapshot der kombinierten kWh-Summe.",
    fr:
      "Agrégez la consommation d'électricité mensuelle des bâtiments dotés d'un profil de " +
      "charge de 15 minutes. Le résultat est un instantané préservant la confidentialité du " +
      "total kWh combiné.",
  },
  aggDescBenchmark: {
    en:
      "Aggregate annual consumption across the buildings shared with you. " +
      "Metrics: electricity, heat, water, and wastewater consumption (kWh / m³).",
    de:
      "Aggregiere den Jahresverbrauch über die mit dir geteilten Gebäude. " +
      "Kennzahlen: Strom-, Wärme-, Wasser- und Abwasserverbrauch (kWh / m³).",
    fr:
      "Agrégez la consommation annuelle des bâtiments partagés avec vous. " +
      "Indicateurs : consommation d'électricité, de chaleur, d'eau et d'eaux usées (kWh / m³).",
  },
  // Generic "Loading…" region text (reused wherever a region waits on data).
  loadingEllipsis: { en: "Loading…", de: "Wird geladen…", fr: "Chargement…" },
  // Explore collection-view toggle (Map | Over time | Compare years) + the
  // compare-years (small-multiples) empty state.
  exploreViewAria: {
    en: "Explore view",
    de: "Ansicht erkunden",
    fr: "Vue d'exploration",
  },
  exploreViewMap: { en: "Map", de: "Karte", fr: "Carte" },
  exploreViewOverTime: { en: "Over time", de: "Im Zeitverlauf", fr: "Dans le temps" },
  exploreViewCompareYears: {
    en: "Compare years",
    de: "Jahre vergleichen",
    fr: "Comparer les années",
  },
  // Metric selector (the cube's measure axis) — the picker label and the
  // selectable observed properties (consumption set + generation).
  metricSelectLabel: { en: "Metric", de: "Kennzahl", fr: "Indicateur" },
  metricElectricityConsumption: {
    en: "Electricity",
    de: "Strom",
    fr: "Électricité",
  },
  metricHeatConsumption: { en: "Heat", de: "Wärme", fr: "Chaleur" },
  metricWaterConsumption: { en: "Water", de: "Wasser", fr: "Eau" },
  metricWastewaterConsumption: {
    en: "Wastewater",
    de: "Abwasser",
    fr: "Eaux usées",
  },
  metricElectricityGeneration: {
    en: "Electricity generation",
    de: "Stromerzeugung",
    fr: "Production d'électricité",
  },
  // Cube-view band labels — efficiency tiers (consumption framing) and the
  // neutral low/mid/high magnitude buckets (generation framing).
  lensTierEfficient: {
    en: "More efficient",
    de: "Effizienter",
    fr: "Plus efficace",
  },
  lensTierTypical: { en: "Typical", de: "Typisch", fr: "Typique" },
  lensTierInefficient: {
    en: "Less efficient",
    de: "Weniger effizient",
    fr: "Moins efficace",
  },
  lensMagnitudeLow: { en: "Lower", de: "Niedriger", fr: "Plus faible" },
  lensMagnitudeMid: { en: "Medium", de: "Mittel", fr: "Moyen" },
  lensMagnitudeHigh: { en: "Higher", de: "Höher", fr: "Plus élevé" },
  lensBandNoData: {
    en: "No data",
    de: "Keine Daten",
    fr: "Aucune donnée",
  },
  // Calendar-heatmap view (day × hour) of a building's 15-minute series — the
  // tab label, its short legend captions, and the no-data / no-coverage states.
  calendarTab: {
    en: "Calendar",
    de: "Kalender",
    fr: "Calendrier",
  },
  calendarSubtitle: {
    en: "Hourly consumption (kWh) by day and hour",
    de: "Stündlicher Verbrauch (kWh) nach Tag und Stunde",
    fr: "Consommation horaire (kWh) par jour et heure",
  },
  calendarLegendLess: { en: "Less", de: "Weniger", fr: "Moins" },
  calendarLegendMore: { en: "More", de: "Mehr", fr: "Plus" },
  calendarNoData: {
    en: "No readings for this month.",
    de: "Keine Messwerte für diesen Monat.",
    fr: "Aucun relevé pour ce mois.",
  },
  calendarAxisHour: { en: "Hour", de: "Stunde", fr: "Heure" },
  // Energy × weather overlay (Step 6a of plan-cube-ui): the toggle, the chart's
  // weather-axis label, the station-distance caveat, and the no-overlap note.
  weatherOverlayToggle: {
    en: "Overlay weather",
    de: "Wetter überlagern",
    fr: "Superposer la météo",
  },
  weatherOverlayTitle: {
    en: "Energy and weather",
    de: "Energie und Wetter",
    fr: "Énergie et météo",
  },
  weatherOverlayEnergyAxis: {
    en: "Energy (kWh)",
    de: "Energie (kWh)",
    fr: "Énergie (kWh)",
  },
  weatherOverlayTempAxis: {
    en: "Mean temperature (°C)",
    de: "Mitteltemperatur (°C)",
    fr: "Température moyenne (°C)",
  },
  weatherOverlayTempSeries: {
    en: "Mean temperature",
    de: "Mitteltemperatur",
    fr: "Température moyenne",
  },
  // Honest station-distance caveat (mirrors the Weather panel): which station and
  // how far. {name}/{id}/{km} are interpolated.
  weatherOverlayStation: {
    en: "Nearest station {name} ({id}), {km} km away · Deutscher Wetterdienst (DWD)",
    de: "Nächste Station {name} ({id}), {km} km entfernt · Deutscher Wetterdienst (DWD)",
    fr: "Station la plus proche {name} ({id}), à {km} km · Deutscher Wetterdienst (DWD)",
  },
  weatherOverlayNoStation: {
    en: "No nearby weather station found for this location.",
    de: "Keine nahegelegene Wetterstation für diesen Standort gefunden.",
    fr: "Aucune station météo proche trouvée pour cet emplacement.",
  },
  weatherOverlayNoOverlap: {
    en:
      "No year has both energy and weather data, so they can't be compared on one axis.",
    de:
      "Kein Jahr hat sowohl Energie- als auch Wetterdaten, daher sind sie nicht auf einer Achse vergleichbar.",
    fr:
      "Aucune année ne dispose à la fois de données énergétiques et météo, elles ne peuvent donc pas être comparées sur un même axe.",
  },
  compareYearsEmpty: {
    en:
      "No annual energy data yet. Add energy years to your buildings to compare " +
      "them side by side here.",
    de:
      "Noch keine Jahresenergiedaten. Füge deinen Gebäuden Energiejahre hinzu, um sie " +
      "hier nebeneinander zu vergleichen.",
    fr:
      "Aucune donnée énergétique annuelle pour l'instant. Ajoutez des années " +
      "énergétiques à vos bâtiments pour les comparer côte à côte ici.",
  },
  // Energy-years dialog.
  eyAction: { en: "Energy years", de: "Energiejahre", fr: "Années énergétiques" },
  eyStoredYears: {
    en: "Stored years",
    de: "Gespeicherte Jahre",
    fr: "Années enregistrées",
  },
  eyNoneYet: {
    en: "No energy years entered yet.",
    de: "Noch keine Energiejahre erfasst.",
    fr: "Aucune année énergétique saisie pour l'instant.",
  },
  lblYear: { en: "Year", de: "Jahr", fr: "Année" },
  lblScenario: { en: "Scenario", de: "Szenario", fr: "Scénario" },
  scenarioActual: { en: "Actual", de: "Ist", fr: "Réel" },
  scenarioPlanned: {
    en: "Planned (Soll)",
    de: "Geplant (Soll)",
    fr: "Planifié (Soll)",
  },
  eyEditYear: {
    en: "Edit this year",
    de: "Dieses Jahr bearbeiten",
    fr: "Modifier cette année",
  },
  eyDeleteYear: {
    en: "Delete this year",
    de: "Dieses Jahr löschen",
    fr: "Supprimer cette année",
  },
  eyEditHeading: { en: "Edit year", de: "Jahr bearbeiten", fr: "Modifier l'année" },
  eyAddHeading: { en: "Add a year", de: "Jahr hinzufügen", fr: "Ajouter une année" },
  eyEditingNote: {
    en:
      "Editing existing figures for this year — change only what you need; " +
      "the rest are kept.",
    de:
      "Bestehende Werte für dieses Jahr bearbeiten — ändere nur, was nötig ist; " +
      "der Rest bleibt erhalten.",
    fr:
      "Modification des valeurs existantes pour cette année — ne changez que le " +
      "nécessaire ; le reste est conservé.",
  },
  // Create-aggregation dialog: metric-function radios + metric-selection section.
  aggFnLegend: {
    en: "Aggregation Type",
    de: "Aggregationsfunktion",
    fr: "Fonction d'agrégation",
  },
  aggFnAverage: { en: "Average", de: "Durchschnitt", fr: "Moyenne" },
  aggFnSum: { en: "Sum", de: "Summe", fr: "Somme" },
  aggFnMin: { en: "Minimum", de: "Minimum", fr: "Minimum" },
  aggFnMax: { en: "Maximum", de: "Maximum", fr: "Maximum" },
  aggMetricsLegend: {
    en: "Metrics to Include",
    de: "Einzubeziehende Kennzahlen",
    fr: "Indicateurs à inclure",
  },
  aggSelectAll: { en: "Select all", de: "Alle auswählen", fr: "Tout sélectionner" },
  aggDeselectAll: {
    en: "Deselect all",
    de: "Alle abwählen",
    fr: "Tout désélectionner",
  },
  aggSelectBuildingsFirst: {
    en: "Select buildings first",
    de: "Zuerst Gebäude auswählen",
    fr: "Sélectionnez d'abord des bâtiments",
  },
  aggNoSeriesData: {
    en: "The selected buildings carry no 15-minute series data for any month.",
    de: "Die gewählten Gebäude haben für keinen Monat 15-Minuten-Reihendaten.",
    fr: "Les bâtiments sélectionnés ne comportent de données de série de 15 minutes pour aucun mois.",
  },
  aggNamePlaceholderMonthly: {
    en: "e.g., Warehouse Portfolio March 2024",
    de: "z. B. Lagerportfolio März 2024",
    fr: "p. ex. portefeuille d'entrepôts mars 2024",
  },
  aggNamePlaceholderAnnual: {
    en: "e.g., Portfolio Average 2024",
    de: "z. B. Portfolio-Durchschnitt 2024",
    fr: "p. ex. moyenne du portefeuille 2024",
  },
  // App shell — dev-mode (Developer mode) archive + sharing-maintenance results.
  devRebaseContent: {
    en: "Content will be rebased from {base} to {target}.",
    de: "Inhalte werden von {base} auf {target} umgebast.",
    fr: "Le contenu sera rebasé de {base} vers {target}.",
  },
  devRebaseWebId: {
    en: "Owner WebID will be rewritten from {old} to {new}.",
    de: "Eigentümer-WebID wird von {old} auf {new} umgeschrieben.",
    fr: "La WebID du propriétaire sera réécrite de {old} vers {new}.",
  },
  devRestoreConfirm: {
    en:
      'Restore {count} resource(s) from "{file}" into this Pod?\n\nThis overwrites any ' +
      "existing resource at a matching path under granergize/. This cannot be undone — " +
      "intended for a wiped Pod.",
    de:
      "{count} Ressource(n) aus „{file}“ in diesen Pod wiederherstellen?\n\nDies " +
      "überschreibt vorhandene Ressourcen an passenden Pfaden unter granergize/. Kann " +
      "nicht rückgängig gemacht werden — gedacht für einen geleerten Pod.",
    fr:
      "Restaurer {count} ressource(s) depuis « {file} » dans ce Pod ?\n\nCela écrase " +
      "toute ressource existante à un chemin correspondant sous granergize/. Irréversible " +
      "— prévu pour un Pod vidé.",
  },
  devRebased: { en: " (rebased)", de: " (umgebast)", fr: " (rebasé)" },
  devRestoreSuccess: {
    en: "Restored {restored} resource(s){rebased}; reissued {reissued} share grant(s)",
    de: "{restored} Ressource(n){rebased} wiederhergestellt; {reissued} Freigabe(n) neu erteilt",
    fr: "{restored} ressource(s){rebased} restaurée(s) ; {reissued} partage(s) réémis",
  },
  devAuditMissing: {
    en: "{count} deleted skipped",
    de: "{count} gelöschte übersprungen",
    fr: "{count} supprimée(s) ignorée(s)",
  },
  devAuditSkipped: {
    en: "{count} off-Pod skipped",
    de: "{count} Pod-fremde übersprungen",
    fr: "{count} hors-Pod ignorée(s)",
  },
  devReissueRevoked: {
    en: "{count} revocation(s) replayed",
    de: "{count} Entzug/Entzüge erneut angewandt",
    fr: "{count} révocation(s) rejouée(s)",
  },
  devAuditConsistent: {
    en: "Sharing consistent: {checked} grant(s) match the log{tail}",
    de: "Freigaben konsistent: {checked} Erteilung(en) stimmen mit dem Log überein{tail}",
    fr: "Partage cohérent : {checked} autorisation(s) correspondent au journal{tail}",
  },
  devAuditDrift: {
    en:
      'Sharing drift: {drift} of {checked} grant(s) differ from the log — run "Rebuild ' +
      'sharing from log"{tail}',
    de:
      "Freigabe-Abweichung: {drift} von {checked} Erteilung(en) weichen vom Log ab — " +
      "„Freigaben aus Log neu aufbauen“ ausführen{tail}",
    fr:
      "Dérive du partage : {drift} sur {checked} autorisation(s) diffèrent du journal — " +
      "lancez « Reconstruire le partage depuis le journal »{tail}",
  },
  devReissueSuccess: {
    en: "Reissued {count} share grant(s){tail}",
    de: "{count} Freigabe(n) neu erteilt{tail}",
    fr: "{count} partage(s) réémis{tail}",
  },
  devRemoveDeletes: {
    en: "This permanently deletes {count} resource(s):",
    de: "Dies löscht dauerhaft {count} Ressource(n):",
    fr: "Cela supprime définitivement {count} ressource(s) :",
  },
  devRemoveAllHead: {
    en: "Remove ALL Granergize data from your Pod?",
    de: "ALLE Granergize-Daten aus deinem Pod entfernen?",
    fr: "Supprimer TOUTES les données Granergize de votre Pod ?",
  },
  devRemoveAllTail: {
    en: "Your profile and organisation logo are kept. This cannot be undone.",
    de: "Dein Profil und das Organisationslogo bleiben erhalten. Kann nicht rückgängig gemacht werden.",
    fr: "Votre profil et le logo de l'organisation sont conservés. Action irréversible.",
  },
  // App shell — account menu + onboarding.
  menuAccountAria: { en: "Account menu", de: "Kontomenü", fr: "Menu du compte" },
  menuProfile: { en: "Profile", de: "Profil", fr: "Profil" },
  menuOrganisation: { en: "Organisation…", de: "Organisation…", fr: "Organisation…" },
  menuDevMode: { en: "Developer mode", de: "Entwicklermodus", fr: "Mode développeur" },
  menuAddBuildings: {
    en: "Add example buildings and energy data",
    de: "Beispielgebäude und Energiedaten hinzufügen",
    fr: "Ajouter des bâtiments et données d'exemple",
  },
  menuAddContacts: {
    en: "Add example contacts and rooms",
    de: "Beispielkontakte und -datenräume hinzufügen",
    fr: "Ajouter des contacts et salles d'exemple",
  },
  menuExportArchive: {
    en: "Export archive",
    de: "Archiv exportieren",
    fr: "Exporter l'archive",
  },
  menuImportArchive: {
    en: "Import archive…",
    de: "Archiv importieren…",
    fr: "Importer une archive…",
  },
  menuCheckConsistency: {
    en: "Check sharing consistency",
    de: "Freigabe-Konsistenz prüfen",
    fr: "Vérifier la cohérence du partage",
  },
  menuRebuildSharing: {
    en: "Rebuild sharing from log",
    de: "Freigaben aus Log neu aufbauen",
    fr: "Reconstruire le partage depuis le journal",
  },
  menuHandbuch: {
    en: "Download Praxishandbuch",
    de: "Praxishandbuch herunterladen",
    fr: "Télécharger le Praxishandbuch",
  },
  menuRemoveAll: {
    en: "Remove all app data…",
    de: "Alle App-Daten entfernen…",
    fr: "Supprimer toutes les données…",
  },
  menuChangeAccount: {
    en: "Change account (full logout)",
    de: "Konto wechseln (vollständige Abmeldung)",
    fr: "Changer de compte (déconnexion complète)",
  },
  menuLogout: { en: "Logout", de: "Abmelden", fr: "Déconnexion" },
  removingAllData: {
    en: "Removing all app data…",
    de: "Alle App-Daten werden entfernt…",
    fr: "Suppression de toutes les données…",
  },
  onboardAddExamples: { en: "Add examples", de: "Beispiele hinzufügen", fr: "Ajouter des exemples" },
  btnNoThanks: { en: "No thanks", de: "Nein danke", fr: "Non merci" },
  onboardBanner: {
    en: "No buildings yet — add a couple of example buildings (with energy data) to explore?",
    de: "Noch keine Gebäude — ein paar Beispielgebäude (mit Energiedaten) zum Erkunden hinzufügen?",
    fr: "Aucun bâtiment — ajouter quelques bâtiments d'exemple (avec données énergétiques) à explorer ?",
  },
  demoContactsAdded: {
    en: "Demo contacts added",
    de: "Demo-Kontakte hinzugefügt",
    fr: "Contacts de démonstration ajoutés",
  },
  demoContactsPartial: {
    en: "Added {seeded} of {total} demo contacts",
    de: "{seeded} von {total} Demo-Kontakten hinzugefügt",
    fr: "{seeded} sur {total} contacts de démonstration ajoutés",
  },
  demoRoomsAdded: {
    en: "Demo data rooms added",
    de: "Demo-Datenzimmer hinzugefügt",
    fr: "Salles de données de démonstration ajoutées",
  },
  demoRoomsPartial: {
    en: "Added {rooms} of {total} demo data rooms",
    de: "{rooms} von {total} Demo-Datenzimmern hinzugefügt",
    fr: "{rooms} sur {total} salles de données de démonstration ajoutées",
  },
  // Reusable button / small-label ids (shared across surfaces).
  btnClose: { en: "Close", de: "Schließen", fr: "Fermer" },
  btnClear: { en: "Clear", de: "Leeren", fr: "Effacer" },
  // Login (pre-auth) screen.
  loginLogoAlt: { en: "Logo", de: "Logo", fr: "Logo" },
  loginTitleFallback: { en: "Solid Login", de: "Solid-Login", fr: "Connexion Solid" },
  loginChooseIdpPrefix: {
    en: "Choose an Identity Provider for this ",
    de: "Wähle einen Identity Provider für diese ",
    fr: "Choisissez un fournisseur d'identité pour cette ",
  },
  loginSolidApp: {
    en: "Solid Application",
    de: "Solid-Anwendung",
    fr: "application Solid",
  },
  loginClearing: { en: "Clearing…", de: "Wird gelöscht…", fr: "Effacement…" },
  loginClearRetry: {
    en: "Clear local data & retry",
    de: "Lokale Daten löschen & erneut versuchen",
    fr: "Effacer les données locales et réessayer",
  },
  loginRestoreFailed: {
    en: "Couldn’t restore your previous session: {error}",
    de: "Deine vorherige Sitzung konnte nicht wiederhergestellt werden: {error}",
    fr: "Impossible de restaurer votre session précédente : {error}",
  },
  loginTroublePrefix: {
    en: "Trouble signing in? ",
    de: "Probleme bei der Anmeldung? ",
    fr: "Problème de connexion ? ",
  },
  loginClearData: {
    en: "Clear local data",
    de: "Lokale Daten löschen",
    fr: "Effacer les données locales",
  },
  loginSignIn: { en: "Sign in", de: "Anmelden", fr: "Se connecter" },
  loginSignInAgainWith: {
    en: "Sign in again with",
    de: "Erneut anmelden mit",
    fr: "Se reconnecter avec",
  },
  loginSignInOther: {
    en: "Sign in with another identity provider",
    de: "Mit einem anderen Identity Provider anmelden",
    fr: "Se connecter avec un autre fournisseur d'identité",
  },
  loginIdpLabel: {
    en: "Identity Provider",
    de: "Identity Provider",
    fr: "Fournisseur d'identité",
  },
  loginIdpPlaceholder: {
    en: "e.g. inrupt.net",
    de: "z. B. inrupt.net",
    fr: "p. ex. inrupt.net",
  },
  btnBack: { en: "Back", de: "Zurück", fr: "Retour" },
  btnAdd: { en: "Add", de: "Hinzufügen", fr: "Ajouter" },
  revokeAccess: {
    en: "Revoke access",
    de: "Zugriff entziehen",
    fr: "Révoquer l'accès",
  },
  // Finder row-action aria-labels / tooltips.
  buildingDeleteAria: {
    en: "Delete building",
    de: "Gebäude löschen",
    fr: "Supprimer le bâtiment",
  },
  aggShareAria: {
    en: "Share aggregation",
    de: "Aggregation teilen",
    fr: "Partager l'agrégation",
  },
  aggDetailsAria: {
    en: "Aggregation details",
    de: "Aggregationsdetails",
    fr: "Détails de l'agrégation",
  },
  // Aggregation detail page (Details / Header / Results sections).
  aggDetType: { en: "Type", de: "Typ", fr: "Type" },
  aggDetBuildingsIncluded: {
    en: "Buildings included",
    de: "Einbezogene Gebäude",
    fr: "Bâtiments inclus",
  },
  aggDetMetrics: { en: "Metrics", de: "Kennzahlen", fr: "Indicateurs" },
  aggDetCreated: { en: "Created", de: "Erstellt", fr: "Créé" },
  aggDetLastComputed: {
    en: "Last computed",
    de: "Zuletzt berechnet",
    fr: "Dernier calcul",
  },
  aggDetPeriod: { en: "Period", de: "Zeitraum", fr: "Période" },
  aggDetBuildingsInSnapshot: {
    en: "Buildings in snapshot",
    de: "Gebäude im Snapshot",
    fr: "Bâtiments dans l'instantané",
  },
  aggRefreshing: { en: "Refreshing…", de: "Wird aktualisiert…", fr: "Actualisation…" },
  aggRefreshBtn: { en: "Refresh", de: "Aktualisieren", fr: "Actualiser" },
  aggResultsMetricCol: { en: "Metric", de: "Kennzahl", fr: "Indicateur" },
  aggNoSnapshotYet: {
    en: 'No snapshot computed yet. Click "Refresh" to compute aggregated values.',
    de: "Noch kein Snapshot berechnet. Klicke „Aktualisieren“, um die aggregierten Werte zu berechnen.",
    fr: "Aucun instantané calculé. Cliquez sur « Actualiser » pour calculer les valeurs agrégées.",
  },
  // Contact detail page.
  lblOrganisation: { en: "Organisation", de: "Organisation", fr: "Organisation" },
  lblAddress: { en: "Address", de: "Adresse", fr: "Adresse" },
  lblEmail: { en: "E-mail", de: "E-Mail", fr: "E-mail" },
  lblPhone: { en: "Phone", de: "Telefon", fr: "Téléphone" },
  lblWebsite: { en: "Website", de: "Webseite", fr: "Site web" },
  // Finder keyword search (shared SearchField).
  searchPlaceholder: { en: "Search…", de: "Suchen…", fr: "Rechercher…" },
  searchAria: { en: "Search this list", de: "Diese Liste durchsuchen", fr: "Rechercher dans cette liste" },
  searchClear: { en: "Clear search", de: "Suche löschen", fr: "Effacer la recherche" },
  searchNoMatches: {
    en: "No matches for “{query}”.",
    de: "Keine Treffer für „{query}“.",
    fr: "Aucun résultat pour « {query} ».",
  },
  // Provenance marker on a finder row (a building/aggregation shared with me).
  provSharedTag: { en: "Shared", de: "Geteilt", fr: "Partagé" },
  // Tier source-selector (multi-select union: which provenance sources to show).
  tierFilterAria: { en: "Filter by source", de: "Nach Quelle filtern", fr: "Filtrer par source" },
  tierMine: { en: "Mine", de: "Meine", fr: "Les miens" },
  tierShared: { en: "Shared with me", de: "Mit mir geteilt", fr: "Partagés avec moi" },
  filterNoMatch: {
    en: "Nothing matches the current filter.",
    de: "Nichts entspricht dem aktuellen Filter.",
    fr: "Rien ne correspond au filtre actuel.",
  },
  contactAddToContacts: {
    en: "Add to contacts",
    de: "Zu Kontakten hinzufügen",
    fr: "Ajouter aux contacts",
  },
  // Detail FilesSection (read-only shared files).
  fileDownloading: { en: "Downloading…", de: "Wird heruntergeladen…", fr: "Téléchargement…" },
  // Room detail sections.
  roomCopyInvite: {
    en: "Copy invite link",
    de: "Einladungslink kopieren",
    fr: "Copier le lien d'invitation",
  },
  roomMyRoles: { en: "My role(s)", de: "Meine Rolle(n)", fr: "Mon/mes rôle(s)" },
  roomRolesHint: {
    en:
      "Assign or change your role(s) anytime — this is how others share data with " +
      "you by role.",
    de:
      "Weise deine Rolle(n) jederzeit zu oder ändere sie — so teilen andere Daten " +
      "nach Rolle mit dir.",
    fr:
      "Attribuez ou modifiez vos rôles à tout moment — c'est ainsi que d'autres " +
      "partagent des données avec vous par rôle.",
  },
  aggRefreshAria: {
    en: "Refresh snapshot",
    de: "Snapshot aktualisieren",
    fr: "Actualiser l'instantané",
  },
  aggRowMeta: {
    en: "Type: {type} | Buildings: {buildings} | Metrics: {metrics}",
    de: "Typ: {type} | Gebäude: {buildings} | Kennzahlen: {metrics}",
    fr: "Type : {type} | Bâtiments : {buildings} | Indicateurs : {metrics}",
  },
  aggRowCreated: { en: "Created: {date}", de: "Erstellt: {date}", fr: "Créé : {date}" },
  aggRowLastComputed: {
    en: "Last computed: {date}",
    de: "Zuletzt berechnet: {date}",
    fr: "Dernier calcul : {date}",
  },
  aggDeleteAria: {
    en: "Delete aggregation",
    de: "Aggregation löschen",
    fr: "Supprimer l'agrégation",
  },
  roomDeleteAria: {
    en: "Delete data room",
    de: "Datenzimmer löschen",
    fr: "Supprimer la salle de données",
  },
  roomDeleteTooltip: {
    en: "Delete data room (for everyone)",
    de: "Datenzimmer löschen (für alle)",
    fr: "Supprimer la salle de données (pour tous)",
  },
  noRole: { en: "no role", de: "keine Rolle", fr: "aucun rôle" },
  lblWebId: { en: "WebID", de: "WebID", fr: "WebID" },
  contactAddAria: {
    en: "Add contact",
    de: "Kontakt hinzufügen",
    fr: "Ajouter un contact",
  },
  contactRemoveAria: {
    en: "Remove contact",
    de: "Kontakt entfernen",
    fr: "Retirer le contact",
  },
  // Generic affordances reused by the Contacts + Rooms finders.
  addingEllipsis: { en: "Adding…", de: "Wird hinzugefügt…", fr: "Ajout…" },
  scanQrCode: {
    en: "Scan QR code",
    de: "QR-Code scannen",
    fr: "Scanner le code QR",
  },
  // Rooms finder body.
  roomHostBtn: {
    en: "Host a data room",
    de: "Datenzimmer hosten",
    fr: "Héberger une salle de données",
  },
  roomHosting: { en: "Creating…", de: "Wird erstellt…", fr: "Création…" },
  roomUriLabel: {
    en: "Data room URI",
    de: "Datenzimmer-URI",
    fr: "URI de la salle de données",
  },
  roomHostedByYou: {
    en: "Hosted by you",
    de: "Von dir gehostet",
    fr: "Hébergée par vous",
  },
  roomHostedBy: {
    en: "Hosted by {host}",
    de: "Gehostet von {host}",
    fr: "Hébergée par {host}",
  },
  roomActive: { en: "active", de: "aktiv", fr: "active" },
  roomRemoveTooltip: {
    en: "Remove from your list",
    de: "Aus deiner Liste entfernen",
    fr: "Retirer de votre liste",
  },
  roomRemoveAria: {
    en: "Remove data room",
    de: "Datenzimmer entfernen",
    fr: "Retirer la salle de données",
  },
  btnShare: { en: "Share", de: "Teilen", fr: "Partager" },
  btnMap: { en: "Map", de: "Karte", fr: "Carte" },
  btnList: { en: "List", de: "Liste", fr: "Liste" },
  bldgsViewAria: {
    en: "Buildings view",
    de: "Gebäudeansicht",
    fr: "Vue des bâtiments",
  },
  bldgsAutofillFromFile: {
    en: "Autofill from file",
    de: "Aus Datei ausfüllen",
    fr: "Remplir depuis un fichier",
  },
  bldgsDownloadAll: {
    en: "Download all (Excel)",
    de: "Alle herunterladen (Excel)",
    fr: "Tout télécharger (Excel)",
  },
  btnCancel: { en: "Cancel", de: "Abbrechen", fr: "Annuler" },
  btnDone: { en: "Done", de: "Fertig", fr: "Terminé" },
  btnDelete: { en: "Delete", de: "Löschen", fr: "Supprimer" },
  btnSave: { en: "Save", de: "Speichern", fr: "Enregistrer" },
  btnSaving: { en: "Saving…", de: "Wird gespeichert…", fr: "Enregistrement…" },
  btnConfirm: { en: "Confirm", de: "Bestätigen", fr: "Confirmer" },
  confirmDefaultTitle: {
    en: "Please confirm",
    de: "Bitte bestätigen",
    fr: "Veuillez confirmer",
  },
  btnRestore: { en: "Restore", de: "Wiederherstellen", fr: "Restaurer" },
  btnRemoveAll: { en: "Remove all", de: "Alle entfernen", fr: "Tout supprimer" },
  saveChanges: {
    en: "Save Changes",
    de: "Änderungen speichern",
    fr: "Enregistrer les modifications",
  },
  saveRoles: { en: "Save roles", de: "Rollen speichern", fr: "Enregistrer les rôles" },
  btnDownload: { en: "Download", de: "Herunterladen", fr: "Télécharger" },
  // Files dialog (per-building attachments).
  filesEmpty: {
    en:
      "No files yet. Attach a PDF, image, or document below — it's stored on your " +
      "Pod and shared automatically with anyone you share the building with.",
    de:
      "Noch keine Dateien. Hänge unten ein PDF, Bild oder Dokument an — es wird auf " +
      "deinem Pod gespeichert und automatisch mit allen geteilt, mit denen du das " +
      "Gebäude teilst.",
    fr:
      "Aucun fichier pour l'instant. Ajoutez un PDF, une image ou un document " +
      "ci-dessous — il est stocké sur votre Pod et partagé automatiquement avec " +
      "toute personne avec qui vous partagez le bâtiment.",
  },
  filesSetCert: {
    en: "Set as cert",
    de: "Als Ausweis festlegen",
    fr: "Définir comme certificat",
  },
  filesUnsetCert: {
    en: "Unset cert",
    de: "Ausweis aufheben",
    fr: "Retirer le certificat",
  },
  filesDeleteAria: {
    en: "Delete {filename}",
    de: "{filename} löschen",
    fr: "Supprimer {filename}",
  },
  filesDeleteConfirm: {
    en: 'Delete "{filename}"? This cannot be undone.',
    de: "„{filename}“ löschen? Dies kann nicht rückgängig gemacht werden.",
    fr: "Supprimer « {filename} » ? Cette action est irréversible.",
  },
  filesWorking: { en: "Working…", de: "Wird verarbeitet…", fr: "Traitement…" },
  filesAddFiles: { en: "Add files", de: "Dateien hinzufügen", fr: "Ajouter des fichiers" },
  filesTooMany: {
    en: "This building will have more than {max} files — consider keeping it tidy.",
    de: "Dieses Gebäude hätte mehr als {max} Dateien — halte es übersichtlich.",
    fr: "Ce bâtiment aurait plus de {max} fichiers — pensez à rester ordonné.",
  },
  filesTooLarge: {
    en: '"{name}" is large ({size}); the upload may be slow or rejected by the Pod.',
    de: "„{name}“ ist groß ({size}); der Upload kann langsam sein oder vom Pod abgelehnt werden.",
    fr: "« {name} » est volumineux ({size}) ; l'envoi peut être lent ou refusé par le Pod.",
  },
  lblRole: { en: "Role", de: "Rolle", fr: "Rôle" },
  buildingCodeExists: {
    en: "Building code already exists",
    de: "Gebäudecode existiert bereits",
    fr: "Le code du bâtiment existe déjà",
  },
  // Add-building dialog.
  addBuildingBtn: { en: "Add Building", de: "Gebäude hinzufügen", fr: "Ajouter un bâtiment" },
  addBuildingsCount: {
    en: { one: "Add {count} Building", other: "Add {count} Buildings" },
    de: { one: "{count} Gebäude hinzufügen", other: "{count} Gebäude hinzufügen" },
    fr: {
      one: "Ajouter {count} bâtiment",
      other: "Ajouter {count} bâtiments",
    },
  },
  addTitleAutofill: {
    en: "Autofill buildings from a file",
    de: "Gebäude aus einer Datei automatisch ausfüllen",
    fr: "Remplir automatiquement des bâtiments à partir d'un fichier",
  },
  addFmtInvestor: {
    en: "Row-label sheet (one column per building)",
    de: "Zeilenbeschriftungs-Blatt (eine Spalte je Gebäude)",
    fr: "Feuille à libellés de ligne (une colonne par bâtiment)",
  },
  addFmtBenchmark: {
    en: "Table (one row per building)",
    de: "Tabelle (eine Zeile je Gebäude)",
    fr: "Tableau (une ligne par bâtiment)",
  },
  addFmtGeneric: {
    en: "Generic (field-name columns)",
    de: "Generisch (Feldnamen-Spalten)",
    fr: "Générique (colonnes par nom de champ)",
  },
  addHintInvestor: {
    en: "Row-label sheet: field labels down column B, one column per building (D–K).",
    de: "Zeilenbeschriftungs-Blatt: Feldbeschriftungen in Spalte B, eine Spalte je Gebäude (D–K).",
    fr: "Feuille à libellés : libellés de champ en colonne B, une colonne par bâtiment (D–K).",
  },
  addHintBenchmark: {
    en: "Table: one row per building, with column headers.",
    de: "Tabelle: eine Zeile je Gebäude, mit Spaltenüberschriften.",
    fr: "Tableau : une ligne par bâtiment, avec en-têtes de colonnes.",
  },
  addHintGeneric: {
    en: "Generic: field-name column headers, or a 15-minute load-profile (Lastgang) export.",
    de: "Generisch: Feldnamen-Spaltenüberschriften oder ein 15-Minuten-Lastgang-Export.",
    fr: "Générique : en-têtes par nom de champ, ou un export de profil de charge de 15 minutes.",
  },
  addImportCancelled: {
    en: "Import cancelled — any buildings already written are kept",
    de: "Import abgebrochen — bereits geschriebene Gebäude bleiben erhalten",
    fr: "Import annulé — les bâtiments déjà écrits sont conservés",
  },
  addBuildingAddedCount: {
    en: { one: "Building added", other: "{count} buildings added" },
    de: { one: "Gebäude hinzugefügt", other: "{count} Gebäude hinzugefügt" },
    fr: { one: "Bâtiment ajouté", other: "{count} bâtiments ajoutés" },
  },
  addProcessingFile: {
    en: "Processing file…",
    de: "Datei wird verarbeitet…",
    fr: "Traitement du fichier…",
  },
  addUploadingEnergyDays: {
    en: "Uploading energy data… {done}/{total} days",
    de: "Energiedaten werden hochgeladen… {done}/{total} Tage",
    fr: "Envoi des données énergétiques… {done}/{total} jours",
  },
  addUploadingBoth: {
    en: "Uploading building and energy data…",
    de: "Gebäude- und Energiedaten werden hochgeladen…",
    fr: "Envoi des données du bâtiment et de l'énergie…",
  },
  addAddingCount: {
    en: { one: "Adding building…", other: "Adding {count} buildings…" },
    de: { one: "Gebäude wird hinzugefügt…", other: "{count} Gebäude werden hinzugefügt…" },
    fr: { one: "Ajout du bâtiment…", other: "Ajout de {count} bâtiments…" },
  },
  addStarting: { en: "Starting…", de: "Wird gestartet…", fr: "Démarrage…" },
  addCancelUpload: {
    en: "Cancel upload",
    de: "Upload abbrechen",
    fr: "Annuler l'envoi",
  },
  addChooseFile: { en: "Choose file…", de: "Datei wählen…", fr: "Choisir un fichier…" },
  addFileFormat: { en: "File format", de: "Dateiformat", fr: "Format de fichier" },
  addReadingsReady: {
    en: "{count} readings ({days} days) ready to upload",
    de: "{count} Messwerte ({days} Tage) bereit zum Hochladen",
    fr: "{count} relevés ({days} jours) prêts à être envoyés",
  },
  addAnnualDetected: {
    en: "Annual energy detected for {years} — saved with the building.",
    de: "Jahresenergie für {years} erkannt — mit dem Gebäude gespeichert.",
    fr: "Énergie annuelle détectée pour {years} — enregistrée avec le bâtiment.",
  },
  addRemoveBuilding: {
    en: "Remove this building",
    de: "Dieses Gebäude entfernen",
    fr: "Retirer ce bâtiment",
  },
  addGetCoordinates: {
    en: "Get coordinates",
    de: "Koordinaten ermitteln",
    fr: "Obtenir les coordonnées",
  },
  // Sharing finder body.
  shareAggFallbackName: {
    en: "Shared aggregation",
    de: "Geteilte Aggregation",
    fr: "Agrégation partagée",
  },
  shareSharedBy: { en: "Shared by:", de: "Geteilt von:", fr: "Partagé par :" },
  shareShowValues: { en: "Show values", de: "Werte anzeigen", fr: "Afficher les valeurs" },
  shareHideValues: { en: "Hide values", de: "Werte ausblenden", fr: "Masquer les valeurs" },
  shareNoComputedValues: {
    en: "This aggregation has no computed values.",
    de: "Diese Aggregation hat keine berechneten Werte.",
    fr: "Cette agrégation n'a aucune valeur calculée.",
  },
  shareAcrossBuildings: {
    en: "{type} across {count} building(s)",
    de: "{type} über {count} Gebäude",
    fr: "{type} sur {count} bâtiment(s)",
  },
  shareChecking: { en: "Checking…", de: "Wird geprüft…", fr: "Vérification…" },
  shareCheckForNew: {
    en: "Check for new shares",
    de: "Auf neue Freigaben prüfen",
    fr: "Vérifier les nouveaux partages",
  },
  sharePreparing: { en: "Preparing…", de: "Wird vorbereitet…", fr: "Préparation…" },
  shareBuildingN: {
    en: "Building {id}",
    de: "Gebäude {id}",
    fr: "Bâtiment {id}",
  },
  shareDownloadBuildingTooltip: {
    en: "Download this building's data (Excel)",
    de: "Daten dieses Gebäudes herunterladen (Excel)",
    fr: "Télécharger les données de ce bâtiment (Excel)",
  },
  shareDownloadBuildingAria: {
    en: "Download this building's data",
    de: "Daten dieses Gebäudes herunterladen",
    fr: "Télécharger les données de ce bâtiment",
  },
  shareVisibilityTooltip: {
    en:
      "Controls whether this building appears in your dashboard. Does not affect the " +
      "owner's sharing settings.",
    de:
      "Steuert, ob dieses Gebäude in deinem Dashboard erscheint. Beeinflusst nicht die " +
      "Freigabeeinstellungen des Eigentümers.",
    fr:
      "Détermine si ce bâtiment apparaît dans votre tableau de bord. N'affecte pas les " +
      "réglages de partage du propriétaire.",
  },
  shareShown: { en: "Shown", de: "Sichtbar", fr: "Affiché" },
  shareHidden: { en: "Hidden", de: "Ausgeblendet", fr: "Masqué" },
  shareSnapshotEmpty: {
    en: "snapshot not found or empty",
    de: "Snapshot nicht gefunden oder leer",
    fr: "instantané introuvable ou vide",
  },
  // Recipient picker (shared by both share dialogs).
  racLabel: {
    en: "Recipient WebID(s)",
    de: "Empfänger-WebID(s)",
    fr: "WebID(s) du/des destinataire(s)",
  },
  racHelp: {
    en: "Pick a contact/member, or type a WebID and press Enter",
    de: "Kontakt/Mitglied wählen oder eine WebID eingeben und Enter drücken",
    fr: "Choisissez un contact/membre, ou saisissez une WebID et appuyez sur Entrée",
  },
  // Share-building dialog.
  shareBuildingTitle: {
    en: "Share Building Data",
    de: "Gebäudedaten teilen",
    fr: "Partager les données du bâtiment",
  },
  shareResolving: { en: "Resolving…", de: "Wird aufgelöst…", fr: "Résolution…" },
  shareInProgress: { en: "Sharing…", de: "Wird geteilt…", fr: "Partage en cours…" },
  shareSelfError: {
    en: "You cannot share a building with yourself",
    de: "Du kannst ein Gebäude nicht mit dir selbst teilen",
    fr: "Vous ne pouvez pas partager un bâtiment avec vous-même",
  },
  shareSelectRole: {
    en: "Select a role",
    de: "Wähle eine Rolle",
    fr: "Sélectionnez un rôle",
  },
  shareNoRoleMembers: {
    en: "No data room members currently hold that role.",
    de: "Derzeit hat kein Datenzimmer-Mitglied diese Rolle.",
    fr: "Aucun membre de la salle de données ne détient actuellement ce rôle.",
  },
  shareRoleLoadError: {
    en: "Could not load data room members: {error}",
    de: "Datenzimmer-Mitglieder konnten nicht geladen werden: {error}",
    fr: "Impossible de charger les membres de la salle de données : {error}",
  },
  shareByWebId: { en: "By WebID", de: "Nach WebID", fr: "Par WebID" },
  shareByRole: { en: "By role", de: "Nach Rolle", fr: "Par rôle" },
  shareWebIdHint: {
    en:
      "Choose recipients from your contacts and data room members, or type a WebID " +
      "and press Enter to add it.",
    de:
      "Wähle Empfänger aus deinen Kontakten und Datenzimmer-Mitgliedern, oder gib eine " +
      "WebID ein und drücke Enter, um sie hinzuzufügen.",
    fr:
      "Choisissez des destinataires parmi vos contacts et membres de la salle de " +
      "données, ou saisissez une WebID et appuyez sur Entrée pour l'ajouter.",
  },
  shareRoleHint: {
    en:
      "Share with everyone in the GRANERGIZE data room who holds the selected role.",
    de:
      "Teile mit allen im GRANERGIZE-Datenzimmer, die die gewählte Rolle innehaben.",
    fr:
      "Partagez avec toutes les personnes de la salle de données GRANERGIZE qui " +
      "détiennent le rôle sélectionné.",
  },
  shareWhatToShare: {
    en: "What to share",
    de: "Was geteilt wird",
    fr: "Que partager",
  },
  shareScopeStatic: {
    en: "Static building data only",
    de: "Nur statische Gebäudedaten",
    fr: "Données statiques du bâtiment uniquement",
  },
  shareScopeAll: {
    en: "Static building data and all energy readings",
    de: "Statische Gebäudedaten und alle Energiewerte",
    fr: "Données statiques et toutes les valeurs énergétiques",
  },
  shareScopeYears: {
    en: "Static building data and energy for specific year(s)",
    de: "Statische Gebäudedaten und Energie für bestimmte Jahre",
    fr: "Données statiques et énergie pour des années spécifiques",
  },
  shareScopeYearsSummary: {
    en: "Static building data and energy for {years}",
    de: "Statische Gebäudedaten und Energie für {years}",
    fr: "Données statiques et énergie pour {years}",
  },
  shareNoYearDatasets: {
    en: "This building has no energy datasets to share by year.",
    de: "Dieses Gebäude hat keine Energiedatensätze, die sich nach Jahr teilen lassen.",
    fr: "Ce bâtiment n'a aucun jeu de données énergétiques à partager par année.",
  },
  shareIncludes: { en: "Includes:", de: "Enthält:", fr: "Comprend :" },
  shareConfirmWithRoleCount: {
    en: {
      one: "Confirm sharing with {count} data room member:",
      other: "Confirm sharing with {count} data room members:",
    },
    de: {
      one: "Teilen mit {count} Datenzimmer-Mitglied bestätigen:",
      other: "Teilen mit {count} Datenzimmer-Mitgliedern bestätigen:",
    },
    fr: {
      one: "Confirmer le partage avec {count} membre de la salle de données :",
      other: "Confirmer le partage avec {count} membres de la salle de données :",
    },
  },
  sharedWithLabel: { en: "Shared with:", de: "Geteilt mit:", fr: "Partagé avec :" },
  shareBuildingNoneYet: {
    en: "Not shared with anyone yet. Use Share to grant access.",
    de: "Noch mit niemandem geteilt. Über „Teilen“ Zugriff gewähren.",
    fr: "Pas encore partagé. Utilisez « Partager » pour accorder l'accès.",
  },
  // Share-aggregation dialog.
  shareAggTitle: {
    en: 'Share "{name}"',
    de: "„{name}“ teilen",
    fr: "Partager « {name} »",
  },
  shareAggIntro: {
    en:
      "Share this aggregation with another user by entering their WebID. They will " +
      "receive read access to the computed snapshot (values only, no building details).",
    de:
      "Teile diese Aggregation mit einer anderen Person, indem du ihre WebID eingibst. " +
      "Sie erhält Lesezugriff auf den berechneten Snapshot (nur Werte, keine Gebäudedetails).",
    fr:
      "Partagez cette agrégation avec un autre utilisateur en saisissant sa WebID. Il " +
      "recevra un accès en lecture à l'instantané calculé (valeurs uniquement, sans détails).",
  },
  shareEnterOneWebId: {
    en: "Enter at least one WebID",
    de: "Gib mindestens eine WebID ein",
    fr: "Saisissez au moins une WebID",
  },
  confirmRevoke: { en: "Revoke", de: "Entziehen", fr: "Révoquer" },
  shareSuccessWith: {
    en: "Shared successfully with",
    de: "Erfolgreich geteilt mit",
    fr: "Partagé avec succès avec",
  },
  shareBenchmarkHint: {
    en:
      "This is a benchmark. Share it back to everyone who contributed a building so " +
      "they can compare against the peer average.",
    de:
      "Dies ist ein Benchmark. Teile ihn an alle zurück, die ein Gebäude beigetragen " +
      "haben, damit sie sich mit dem Peer-Durchschnitt vergleichen können.",
    fr:
      "Ceci est un benchmark. Repartagez-le avec tous ceux qui ont contribué un bâtiment " +
      "afin qu'ils puissent se comparer à la moyenne des pairs.",
  },
  shareAddAllContributors: {
    en: "Add all {count} contributors",
    de: "Alle {count} Beitragenden hinzufügen",
    fr: "Ajouter les {count} contributeurs",
  },
  shareDataRoomMembers: {
    en: "Data room members",
    de: "Datenzimmer-Mitglieder",
    fr: "Membres de la salle de données",
  },
  shareNoMembers: {
    en: "No other members in your active data room. Enter a WebID below instead.",
    de:
      "Keine weiteren Mitglieder in deinem aktiven Datenzimmer. Gib stattdessen unten eine " +
      "WebID ein.",
    fr:
      "Aucun autre membre dans votre salle de données active. Saisissez plutôt une WebID " +
      "ci-dessous.",
  },
  shareStateShared: { en: "Shared", de: "Geteilt", fr: "Partagé" },
  shareStateAdded: { en: "Added", de: "Hinzugefügt", fr: "Ajouté" },
  shareReviewAndShare: {
    en: "Review and Share",
    de: "Prüfen und teilen",
    fr: "Vérifier et partager",
  },
  shareConfirmWith: {
    en: "Confirm sharing with:",
    de: "Teilen bestätigen mit:",
    fr: "Confirmer le partage avec :",
  },
  shareSnapshotOnly: {
    en: "Recipients will see computed snapshot values only — no building details.",
    de: "Empfänger sehen nur die berechneten Snapshot-Werte — keine Gebäudedetails.",
    fr: "Les destinataires ne verront que les valeurs calculées — sans détails de bâtiment.",
  },
  shareConfirmShare: {
    en: "Confirm Share",
    de: "Teilen bestätigen",
    fr: "Confirmer le partage",
  },
  shareCurrentlyWith: {
    en: "Currently shared with:",
    de: "Aktuell geteilt mit:",
    fr: "Actuellement partagé avec :",
  },
  shareNoneYet: {
    en: "Not shared with anyone yet.",
    de: "Noch mit niemandem geteilt.",
    fr: "Pas encore partagé.",
  },
  aggregationSharedCount: {
    en: {
      one: "Aggregation shared with {count} recipient",
      other: "Aggregation shared with {count} recipients",
    },
    de: {
      one: "Aggregation mit {count} Empfänger geteilt",
      other: "Aggregation mit {count} Empfängern geteilt",
    },
    fr: {
      one: "Agrégation partagée avec {count} destinataire",
      other: "Agrégation partagée avec {count} destinataires",
    },
  },
  confirmRevokeMessage: {
    en: "Revoke access for {webId}?",
    de: "Zugriff für {webId} entziehen?",
    fr: "Révoquer l'accès pour {webId} ?",
  },
  aggRevokeMessage: {
    en: "Revoke aggregation access for {webId}?",
    de: "Aggregations-Zugriff für {webId} entziehen?",
    fr: "Révoquer l'accès à l'agrégation pour {webId} ?",
  },
  aggDeleteConfirm: {
    en: "Delete this aggregation? This also revokes access for everyone it is shared with.",
    de:
      "Diese Aggregation löschen? Damit wird auch der Zugriff für alle entzogen, mit denen " +
      "sie geteilt ist.",
    fr:
      "Supprimer cette agrégation ? Cela révoque aussi l'accès de toutes les personnes avec " +
      "qui elle est partagée.",
  },
  roomDeleteConfirm: {
    en:
      "Delete this data room for everyone? This removes the data room and its entire " +
      "membership and role history. This cannot be undone.",
    de:
      "Diesen Datenzimmer für alle löschen? Damit werden der Datenzimmer und seine gesamte " +
      "Mitglieds- und Rollenhistorie entfernt. Dies kann nicht rückgängig gemacht werden.",
    fr:
      "Supprimer cette salle de données pour tous ? Cela supprime la salle et tout son " +
      "historique de membres et de rôles. Cette action est irréversible.",
  },
  eyDeleteConfirm: {
    en: "Delete the {scenario} figures for {year}?",
    de: "Die {scenario}-Werte für {year} löschen?",
    fr: "Supprimer les valeurs {scenario} pour {year} ?",
  },
  // Organisation dialog chrome.
  orgDialogTitle: {
    en: "Your organisation",
    de: "Deine Organisation",
    fr: "Votre organisation",
  },
  orgChooseLogo: { en: "Choose logo…", de: "Logo wählen…", fr: "Choisir un logo…" },
  orgLogoFormats: {
    en: "PNG, JPG, SVG, WEBP or GIF",
    de: "PNG, JPG, SVG, WEBP oder GIF",
    fr: "PNG, JPG, SVG, WEBP ou GIF",
  },
  orgLogoAlt: {
    en: "Organisation logo",
    de: "Organisationslogo",
    fr: "Logo de l'organisation",
  },
  lblCompanyName: {
    en: "Company name",
    de: "Firmenname",
    fr: "Nom de l'entreprise",
  },
  lblHomepageUri: { en: "Homepage URI", de: "Homepage-URI", fr: "URI de la page d'accueil" },
  lblOrgWebId: {
    en: "Organisation WebID",
    de: "Organisations-WebID",
    fr: "WebID de l'organisation",
  },
  orgWebIdHelp: {
    en: "If the company has its own WebID, link it here.",
    de: "Falls das Unternehmen eine eigene WebID hat, verknüpfe sie hier.",
    fr: "Si l'entreprise possède sa propre WebID, reliez-la ici.",
  },
  // Rooms / Meet notifications (imperative toasts → resolved via `msg()` at fire time).
  roomAdded: {
    en: "Data room added to your list",
    de: "Datenzimmer zu deiner Liste hinzugefügt",
    fr: "Salle de données ajoutée à votre liste",
  },
  roomCreated: {
    en: "Data room created",
    de: "Datenzimmer erstellt",
    fr: "Salle de données créée",
  },
  roomUnreachable: {
    en: "Data room is not reachable",
    de: "Datenzimmer nicht erreichbar",
    fr: "Salle de données injoignable",
  },
  roomLeft: {
    en: "You left the data room",
    de: "Du hast den Datenzimmer verlassen",
    fr: "Vous avez quitté la salle de données",
  },
  roomDeleted: {
    en: "Data room deleted",
    de: "Datenzimmer gelöscht",
    fr: "Salle de données supprimée",
  },
  rolesUpdated: {
    en: "Roles updated",
    de: "Rollen aktualisiert",
    fr: "Rôles mis à jour",
  },
  inviteCopied: {
    en: "Invite link copied",
    de: "Einladungslink kopiert",
    fr: "Lien d'invitation copié",
  },
  inviteCopyFailed: {
    en: "Could not copy link",
    de: "Link konnte nicht kopiert werden",
    fr: "Impossible de copier le lien",
  },
  removedFromList: {
    en: "Removed from your list",
    de: "Aus deiner Liste entfernt",
    fr: "Retiré de votre liste",
  },
  // Building / sharing success toasts.
  buildingDeleted: {
    en: "Building deleted",
    de: "Gebäude gelöscht",
    fr: "Bâtiment supprimé",
  },
  buildingUpdated: {
    en: "Building updated",
    de: "Gebäude aktualisiert",
    fr: "Bâtiment mis à jour",
  },
  buildingShared: {
    en: "Building shared successfully",
    de: "Gebäude erfolgreich geteilt",
    fr: "Bâtiment partagé avec succès",
  },
  accessRevoked: {
    en: "Access revoked",
    de: "Zugriff entzogen",
    fr: "Accès révoqué",
  },
  // Aggregation area + create/share dialogs.
  snapshotRefreshed: {
    en: "Snapshot refreshed",
    de: "Snapshot aktualisiert",
    fr: "Instantané actualisé",
  },
  aggregationDeleted: {
    en: "Aggregation deleted",
    de: "Aggregation gelöscht",
    fr: "Agrégation supprimée",
  },
  aggregationAccessRevoked: {
    en: "Aggregation access revoked",
    de: "Aggregationszugriff entzogen",
    fr: "Accès à l'agrégation révoqué",
  },
  aggregationCreated: {
    en: "Aggregation created successfully",
    de: "Aggregation erfolgreich erstellt",
    fr: "Agrégation créée avec succès",
  },
  enterAggregationName: {
    en: "Please enter an aggregation name",
    de: "Bitte gib einen Aggregationsnamen ein",
    fr: "Veuillez saisir un nom d'agrégation",
  },
  selectBuilding: {
    en: "Please select at least one building",
    de: "Bitte wähle mindestens ein Gebäude",
    fr: "Veuillez sélectionner au moins un bâtiment",
  },
  selectMonth: {
    en: "Please select a month",
    de: "Bitte wähle einen Monat",
    fr: "Veuillez sélectionner un mois",
  },
  selectMetric: {
    en: "Please select at least one metric",
    de: "Bitte wähle mindestens eine Kennzahl",
    fr: "Veuillez sélectionner au moins une métrique",
  },
  // Energy-year + organisation dialogs, geocoding, account/session.
  enterValidYear: {
    en: "Enter a valid year",
    de: "Gib ein gültiges Jahr ein",
    fr: "Saisissez une année valide",
  },
  enterFigure: {
    en: "Enter at least one figure",
    de: "Gib mindestens einen Wert ein",
    fr: "Saisissez au moins une valeur",
  },
  energySaved: {
    en: "Energy data saved",
    de: "Energiedaten gespeichert",
    fr: "Données énergétiques enregistrées",
  },
  energyYearDeleted: {
    en: "Energy year deleted",
    de: "Energiejahr gelöscht",
    fr: "Année énergétique supprimée",
  },
  chooseImageType: {
    en: "Please choose a PNG, JPG, SVG, WEBP or GIF image",
    de: "Bitte wähle ein PNG-, JPG-, SVG-, WEBP- oder GIF-Bild",
    fr: "Veuillez choisir une image PNG, JPG, SVG, WEBP ou GIF",
  },
  organisationSaved: {
    en: "Organisation saved",
    de: "Organisation gespeichert",
    fr: "Organisation enregistrée",
  },
  addressNotFound: {
    en: "Address not found",
    de: "Adresse nicht gefunden",
    fr: "Adresse introuvable",
  },
  coordinatesUpdated: {
    en: "Coordinates updated",
    de: "Koordinaten aktualisiert",
    fr: "Coordonnées mises à jour",
  },
  demoBuildingsAdded: {
    en: "Demo buildings and energy data added",
    de: "Beispielgebäude und Energiedaten hinzugefügt",
    fr: "Bâtiments et données énergétiques de démonstration ajoutés",
  },
  allDataRemoved: {
    en: "All app data removed",
    de: "Alle App-Daten entfernt",
    fr: "Toutes les données de l'application supprimées",
  },
  inboxSetUp: {
    en: "Set up your Granergize inbox on this Pod",
    de: "Granergize-Posteingang auf diesem Pod eingerichtet",
    fr: "Boîte de réception Granergize configurée sur ce Pod",
  },
  loggedOut: {
    en: "User logged out successfully",
    de: "Erfolgreich abgemeldet",
    fr: "Déconnexion réussie",
  },
  noBuildingsInFile: {
    en: "No buildings found in file",
    de: "Keine Gebäude in der Datei gefunden",
    fr: "Aucun bâtiment trouvé dans le fichier",
  },
  checkedForShares: {
    en: "Checked for new shares",
    de: "Auf neue Freigaben geprüft",
    fr: "Recherche de nouveaux partages effectuée",
  },
  loadedWithReadings: {
    en: "Loaded building with {readings} readings ({days} days)",
    de: "Gebäude mit {readings} Messwerten geladen ({days} Tage)",
    fr: "Bâtiment chargé avec {readings} relevés ({days} jours)",
  },
  loadedBuildings: {
    en: "Loaded {count} building(s) from file",
    de: "{count} Gebäude aus der Datei geladen",
    fr: "{count} bâtiment(s) chargé(s) depuis le fichier",
  },
  archived: {
    en: "Archived {count} resource(s)",
    de: "{count} Ressource(n) archiviert",
    fr: "{count} ressource(s) archivée(s)",
  },
  demoBuildingsPartial: {
    en: "Added {seeded} of {total} demo buildings (with energy data)",
    de: "{seeded} von {total} Beispielgebäuden hinzugefügt (mit Energiedaten)",
    fr:
      "{seeded} bâtiments de démonstration sur {total} ajoutés (avec données énergétiques)",
  },
  // The two classified-warning sentences (session-expiry gate + optimistic-lock
  // conflict) — complete sentences about an app-level state, not "Failed to …".
  sessionExpired: {
    en: "Session expired — please log in again",
    de: "Sitzung abgelaufen — bitte melde dich erneut an",
    fr: "Session expirée — veuillez vous reconnecter",
  },
  conflictReload: {
    en: "This changed elsewhere — please reload and try again.",
    de: "Dies wurde anderswo geändert — bitte lade neu und versuche es erneut.",
    fr: "Ceci a été modifié ailleurs — veuillez recharger et réessayer.",
  },

  // Error-toast template + its action phrases (the `formatError` chokepoint). The
  // action is nominalised in de/fr so it slots into each language's template
  // grammar ("Failed to {verb phrase}" / "Fehler beim {gerund}" / "Échec de {nom}").
  failedTo: {
    en: "Failed to {action}: {detail}",
    de: "Fehler beim {action}: {detail}",
    fr: "Échec de {action} : {detail}",
  },
  actionAddBuilding: {
    en: "add the building",
    de: "Hinzufügen des Gebäudes",
    fr: "l'ajout du bâtiment",
  },
  actionUpdateBuilding: {
    en: "update the building",
    de: "Aktualisieren des Gebäudes",
    fr: "la mise à jour du bâtiment",
  },
  actionSaveEnergy: {
    en: "save energy data",
    de: "Speichern der Energiedaten",
    fr: "l'enregistrement des données énergétiques",
  },
  actionDeleteEnergy: {
    en: "delete energy data",
    de: "Löschen der Energiedaten",
    fr: "la suppression des données énergétiques",
  },
  actionUploadFile: {
    en: "upload the file",
    de: "Hochladen der Datei",
    fr: "le téléversement du fichier",
  },
  actionDeleteFile: {
    en: "delete the file",
    de: "Löschen der Datei",
    fr: "la suppression du fichier",
  },
  actionUpdateCertificate: {
    en: "update the energy certificate",
    de: "Aktualisieren des Energieausweises",
    fr: "la mise à jour du certificat énergétique",
  },
  actionShareBuilding: {
    en: "share the building",
    de: "Teilen des Gebäudes",
    fr: "le partage du bâtiment",
  },
  actionShareAggregation: {
    en: "share the aggregation",
    de: "Teilen der Aggregation",
    fr: "le partage de l'agrégation",
  },
  actionCreateAggregation: {
    en: "create the aggregation",
    de: "Erstellen der Aggregation",
    fr: "la création de l'agrégation",
  },
  actionSaveOrganisation: {
    en: "save your organisation",
    de: "Speichern deiner Organisation",
    fr: "l'enregistrement de votre organisation",
  },
  actionAddDemoContacts: {
    en: "add demo contacts",
    de: "Hinzufügen der Beispielkontakte",
    fr: "l'ajout des contacts de démonstration",
  },
  actionAddDemoRooms: {
    en: "add demo data rooms",
    de: "Hinzufügen der Beispiel-Datenzimmer",
    fr: "l'ajout des salles de données de démonstration",
  },
  actionAddDemoBuildings: {
    en: "add demo buildings and energy data",
    de: "Hinzufügen der Beispielgebäude und Energiedaten",
    fr: "l'ajout des bâtiments et données énergétiques de démonstration",
  },
  actionRemoveAppData: {
    en: "remove app data",
    de: "Entfernen der App-Daten",
    fr: "la suppression des données de l'application",
  },
  actionRestoreArchive: {
    en: "restore the archive",
    de: "Wiederherstellen des Archivs",
    fr: "la restauration de l'archive",
  },
  actionRebuildSharing: {
    en: "rebuild sharing",
    de: "Neuaufbau der Freigaben",
    fr: "la reconstruction des partages",
  },
  actionDownloadArchive: {
    en: "download the archive",
    de: "Herunterladen des Archivs",
    fr: "le téléchargement de l'archive",
  },
  actionCheckSharing: {
    en: "check sharing consistency",
    de: "Prüfen der Freigabe-Konsistenz",
    fr: "la vérification de la cohérence des partages",
  },
  actionReadInbox: {
    en: "read your inbox",
    de: "Lesen deines Posteingangs",
    fr: "la lecture de votre boîte de réception",
  },
  actionCheckShares: {
    en: "check for new shares",
    de: "Prüfen auf neue Freigaben",
    fr: "la vérification des nouveaux partages",
  },
  actionExportBuilding: {
    en: "export the building",
    de: "Exportieren des Gebäudes",
    fr: "l'export du bâtiment",
  },
  actionExportBuildings: {
    en: "export the buildings",
    de: "Exportieren der Gebäude",
    fr: "l'export des bâtiments",
  },
  actionComputeAggregation: {
    en: "compute the aggregation summary",
    de: "Berechnen der Aggregations-Zusammenfassung",
    fr: "le calcul du résumé de l'agrégation",
  },
  actionParseFile: {
    en: "parse the file",
    de: "Einlesen der Datei",
    fr: "l'analyse du fichier",
  },
  actionReadArchive: {
    en: "read the archive",
    de: "Lesen des Archivs",
    fr: "la lecture de l'archive",
  },
  actionDownloadFile: {
    en: "download the file",
    de: "Herunterladen der Datei",
    fr: "le téléchargement du fichier",
  },
  actionAddContact: {
    en: "add contact",
    de: "Hinzufügen des Kontakts",
    fr: "l'ajout du contact",
  },
  // Contacts flow notifications (the `showNotification` vocabulary — migrated per
  // area; the add-failure toast still goes through `formatError`, a later slice).
  enterWebId: {
    en: "Enter a WebID (an http(s) URI)",
    de: "Gib eine WebID ein (eine http(s)-URI)",
    fr: "Saisissez un WebID (une URI http(s))",
  },
  contactAdded: { en: "Contact added", de: "Kontakt hinzugefügt", fr: "Contact ajouté" },
  contactRemoved: {
    en: "Contact removed",
    de: "Kontakt entfernt",
    fr: "Contact supprimé",
  },
  // Per-object action-menu verb labels (the intent-registry-driven row/section
  // actions — plan-palette §3). One id per registry descriptor whose verb is
  // surfaced as an action control; the registry maps `descriptor.name` → these.
  intentAddBuilding: {
    en: "Add building…",
    de: "Gebäude hinzufügen…",
    fr: "Ajouter un bâtiment…",
  },
  intentUpdateBuilding: {
    en: "Edit building…",
    de: "Gebäude bearbeiten…",
    fr: "Modifier le bâtiment…",
  },
  intentCreateAggregation: {
    en: "Create aggregation…",
    de: "Aggregation erstellen…",
    fr: "Créer une agrégation…",
  },
  intentDeleteBuilding: {
    en: "Delete building",
    de: "Gebäude löschen",
    fr: "Supprimer le bâtiment",
  },
  intentShareBuilding: {
    en: "Share building",
    de: "Gebäude teilen",
    fr: "Partager le bâtiment",
  },
  intentToggleBuildingVisibility: {
    en: "Show/hide building",
    de: "Gebäude ein-/ausblenden",
    fr: "Afficher/masquer le bâtiment",
  },
  intentDeleteAggregation: {
    en: "Delete aggregation",
    de: "Aggregation löschen",
    fr: "Supprimer l'agrégation",
  },
  intentRefreshAggregation: {
    en: "Refresh snapshot",
    de: "Snapshot aktualisieren",
    fr: "Actualiser l'instantané",
  },
  intentShareAggregation: {
    en: "Share aggregation",
    de: "Aggregation teilen",
    fr: "Partager l'agrégation",
  },
  intentSaveEnergyYear: {
    en: "Enter energy…",
    de: "Energie eingeben…",
    fr: "Saisir l'énergie…",
  },
  intentDeleteEnergyYear: {
    en: "Delete energy…",
    de: "Energie löschen…",
    fr: "Supprimer l'énergie…",
  },
  // Additional verb labels for the schema-driven palette param form (the
  // form-eligible verbs not already surfaced by a per-object menu). The "…"
  // marks that a form/parameter step follows.
  intentRevokeBuildingAccess: {
    en: "Revoke building access…",
    de: "Gebäudezugriff entziehen…",
    fr: "Révoquer l'accès au bâtiment…",
  },
  intentRevokeAggregationAccess: {
    en: "Revoke aggregation access…",
    de: "Aggregationszugriff entziehen…",
    fr: "Révoquer l'accès à l'agrégation…",
  },
  intentRemoveContact: {
    en: "Remove contact…",
    de: "Kontakt entfernen…",
    fr: "Supprimer le contact…",
  },
  intentEnterRoom: {
    en: "Enter data room…",
    de: "Datenzimmer betreten…",
    fr: "Entrer dans la salle de données…",
  },
  intentExitRoom: {
    en: "Leave data room…",
    de: "Datenzimmer verlassen…",
    fr: "Quitter la salle de données…",
  },
  intentDeleteRoom: {
    en: "Delete data room…",
    de: "Datenzimmer löschen…",
    fr: "Supprimer la salle de données…",
  },
  intentRemoveBookmark: {
    en: "Remove data room bookmark…",
    de: "Datenzimmer-Lesezeichen entfernen…",
    fr: "Retirer le marque-page de la salle de données…",
  },
  intentAddRoom: {
    en: "Add a data room…",
    de: "Datenzimmer hinzufügen…",
    fr: "Ajouter une salle de données…",
  },
  // Palette labels for the dev demo seeders surfaced as direct-invoke verbs (the
  // account-menu groups contacts+rooms under one item; the palette surfaces each
  // verb on its own, so they need distinct wording).
  intentSeedDemoContacts: {
    en: "Add example contacts",
    de: "Beispielkontakte hinzufügen",
    fr: "Ajouter des contacts d'exemple",
  },
  intentSeedDemoRooms: {
    en: "Add example data rooms",
    de: "Beispiel-Datenzimmer hinzufügen",
    fr: "Ajouter des salles de données d'exemple",
  },
  // Per-param field labels for the schema-driven palette form (paramForm.ts /
  // IntentParamForm.tsx). Keyed by param name where unambiguous; the share-flow
  // recipient/year fields reuse the existing racLabel/lblYear ids.
  paramBuilding: { en: "Building", de: "Gebäude", fr: "Bâtiment" },
  paramAggregation: { en: "Aggregation", de: "Aggregation", fr: "Agrégation" },
  paramRoom: { en: "Data room", de: "Datenzimmer", fr: "Salle de données" },
  paramWebId: { en: "Person (WebID)", de: "Person (WebID)", fr: "Personne (WebID)" },
  paramIncludeEnergyData: {
    en: "Include energy data",
    de: "Energiedaten einbeziehen",
    fr: "Inclure les données énergétiques",
  },
  paramYears: { en: "Years", de: "Jahre", fr: "Années" },
  paramRoomInput: {
    en: "Invite link or room URI",
    de: "Einladungslink oder Datenzimmer-URI",
    fr: "Lien d'invitation ou URI de la salle de données",
  },
  // Generic param-form chrome.
  paramFormRequired: {
    en: "This field is required",
    de: "Dieses Feld ist erforderlich",
    fr: "Ce champ est obligatoire",
  },
  paramFormSubmit: { en: "Run", de: "Ausführen", fr: "Exécuter" },
  paramFormSuccess: { en: "Done", de: "Erledigt", fr: "Terminé" },
  paramYearAdd: {
    en: "Type a year and press Enter",
    de: "Jahr eingeben und Enter drücken",
    fr: "Saisissez une année et appuyez sur Entrée",
  },
  paramNoAggregations: {
    en: "No aggregations yet.",
    de: "Noch keine Aggregationen.",
    fr: "Aucune agrégation pour l'instant.",
  },
  paramNoRooms: {
    en: "No data rooms yet.",
    de: "Noch keine Datenzimmer.",
    fr: "Aucune salle de données pour l'instant.",
  },
  paramNoBuildings: {
    en: "No buildings yet.",
    de: "Noch keine Gebäude.",
    fr: "Aucun bâtiment pour l'instant.",
  },
  // A plural exemplar (drives the machinery's `Intl.PluralRules` path; German has
  // the same form for one/other, English/French differ).
  buildingCount: {
    en: { one: "{count} building", other: "{count} buildings" },
    de: { one: "{count} Gebäude", other: "{count} Gebäude" },
    fr: { one: "{count} bâtiment", other: "{count} bâtiments" },
  },
} satisfies Record<string, Message>;

export type MessageId = keyof typeof MESSAGES;

const isPlural = (v: string | PluralForms): v is PluralForms =>
  typeof v === "object";

/** Replace every `{name}` with `params[name]` (missing → left as-is, visible). */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(
    /\{(\w+)\}/g,
    (whole, key) => (key in params ? String(params[key]) : whole),
  );
}

/**
 * Resolve a message id to a string in `lang`. Falls back to the {@link DEFAULT_LANG}
 * string for a missing translation, and (for a plural entry) to the `other` form
 * when the selected category is absent. Pure — the active locale is passed in.
 */
export function translate(
  lang: Lang,
  id: MessageId,
  params?: MessageParams,
): string {
  const entry = MESSAGES[id] as Record<Lang, string | PluralForms>;
  const value = entry[lang] ?? entry[DEFAULT_LANG];
  if (isPlural(value)) {
    const count = typeof params?.count === "number" ? params.count : 0;
    const cat = new Intl.PluralRules(lang).select(count);
    const form = value[cat] ?? value.other;
    return interpolate(form, params);
  }
  return interpolate(value, params);
}

/**
 * Resolve a message id in the CURRENT active locale — the imperative counterpart
 * to `useT()`/`translate`. For one-shot strings fired outside render (notification
 * toasts in handlers/effects/`onSuccess`): it reads `getLanguage()` at call time,
 * so the toast shows in the locale active when it fires, no React/hook needed. Use
 * `useT()` for strings RENDERED in the tree (they must re-render on a locale switch).
 */
export function msg(id: MessageId, params?: MessageParams): string {
  return translate(getLanguage(), id, params);
}
