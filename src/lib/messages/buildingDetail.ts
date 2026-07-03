/** Catalog slice — Building detail page (header, master-data read view, heat systems, files, energy summary), operating-cost & certification rows.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const buildingDetail = {
  // Building header: the ownership badge uses the shared tier labels
  // (tierMine / tierShared) via TierBadge.
  // Master-data section heading + inline edit.
  secMasterData: { en: "Master data", de: "Stammdaten", fr: "Données de base" },
  secEnergySystems: {
    en: "Energy systems",
    de: "Energieanlagen",
    fr: "Systèmes énergétiques",
  },
  btnAddSystem: { en: "Add system", de: "Anlage hinzufügen", fr: "Ajouter un système" },
  energySystemsEmpty: {
    en: "No energy systems yet. Add a PV plant, battery, or CHP unit.",
    de: "Noch keine Energieanlagen. Füge eine PV-Anlage, einen Speicher oder ein BHKW hinzu.",
    fr: "Aucun système énergétique. Ajoutez une centrale PV, une batterie ou une unité de cogénération.",
  },
  energySystemsEmptyShared: {
    en: "No energy systems.",
    de: "Keine Energieanlagen.",
    fr: "Aucun système énergétique.",
  },
  mdSystemOperator: { en: "Operated by", de: "Betreiber", fr: "Exploité par" },
  pickerSearchPlaceholder: { en: "Search…", de: "Suchen…", fr: "Rechercher…" },
  pickerSelectAll: {
    en: "Select all ({count})",
    de: "Alle auswählen ({count})",
    fr: "Tout sélectionner ({count})",
  },
  pickerClearAll: { en: "Clear all", de: "Auswahl löschen", fr: "Tout effacer" },
  unitObsHeading: {
    en: "Per-unit observations",
    de: "Beobachtungen je Anlage",
    fr: "Observations par unité",
  },
  lblSystemCapacityKW: { en: "Capacity (kW)", de: "Leistung (kW)", fr: "Puissance (kW)" },
  lblSystemCapacityKWh: {
    en: "Capacity (kWh)",
    de: "Kapazität (kWh)",
    fr: "Capacité (kWh)",
  },
  lblSystemThermalKW: {
    en: "Thermal capacity (kW)",
    de: "Thermische Leistung (kW)",
    fr: "Puissance thermique (kW)",
  },
  lblCommissioningYear: {
    en: "Commissioning year",
    de: "Inbetriebnahmejahr",
    fr: "Année de mise en service",
  },
  lblSystemOperator: {
    en: "Operator (WebID)",
    de: "Betreiber (WebID)",
    fr: "Exploitant (WebID)",
  },
  btnAddPv: { en: "Add PV plant", de: "PV-Anlage", fr: "Centrale PV" },
  btnAddBattery: { en: "Add battery", de: "Speicher", fr: "Batterie" },
  btnAddChp: { en: "Add CHP", de: "BHKW", fr: "Cogénération" },
  // Heat-generation section — heat generators are :TechnicalSystem nodes too.
  btnAddHeatGenerator: { en: "Add heat generator", de: "Wärmeerzeuger", fr: "Générateur de chaleur" },
  btnAddHeatPump: { en: "Add heat pump", de: "Wärmepumpe", fr: "Pompe à chaleur" },
  btnAddGasBoiler: { en: "Add gas boiler", de: "Gaskessel", fr: "Chaudière à gaz" },
  btnAddDistrictHeating: { en: "Add district heating", de: "Fernwärme", fr: "Chauffage urbain" },
  btnAddOilBoiler: { en: "Add oil boiler", de: "Ölkessel", fr: "Chaudière à fioul" },
  btnAddElectricBoiler: { en: "Add electric boiler", de: "Elektrokessel", fr: "Chaudière électrique" },
  heatGenerationEmpty: {
    en: "No heat generators yet. Add a heat pump, boiler or district-heating connection.",
    de: "Noch keine Wärmeerzeuger. Füge eine Wärmepumpe, einen Kessel oder Fernwärme hinzu.",
    fr: "Aucun générateur de chaleur. Ajoutez une pompe à chaleur, une chaudière ou le chauffage urbain.",
  },
  heatGenerationEmptyShared: {
    en: "No heat generators recorded for this building.",
    de: "Für dieses Gebäude sind keine Wärmeerzeuger erfasst.",
    fr: "Aucun générateur de chaleur enregistré pour ce bâtiment.",
  },
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
  essViewCharts: {
    en: "View energy charts →",
    de: "Energiediagramme ansehen →",
    fr: "Voir les graphiques d'énergie →",
  },
  // Per-system link from a system row to its own observations (observation page).
  sysViewObservations: {
    en: "View observations →",
    de: "Beobachtungen ansehen →",
    fr: "Voir les observations →",
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
} satisfies Record<string, Message>;
