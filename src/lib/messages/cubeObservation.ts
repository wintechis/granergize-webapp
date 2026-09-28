/** Catalog slice — Cube / observation UI: metric selector, xlsx export, band labels, choropleths, calendar heatmap, weather overlay, energy-years dialog.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const cubeObservation = {
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
  // Metric selector (the cube's measure axis) — the picker label and the
  // selectable observed properties (consumption set + generation).
  metricSelectLabel: { en: "Metric", de: "Kennzahl", fr: "Indicateur" },
  metricElectricityConsumption: {
    en: "Electricity",
    de: "Strom",
    fr: "Électricité",
  },
  metricHeatConsumption: { en: "Heat", de: "Wärme", fr: "Chaleur" },
  // The property ladder's rollup rung — a DERIVED measure (electricity + heat, the two
  // kWh carriers), labelled so the figure is never an unexplained total.
  metricEnergyTotal: {
    en: "Total energy (electricity + heat)",
    de: "Gesamtenergie (Strom + Wärme)",
    fr: "Énergie totale (électricité + chaleur)",
  },
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
  // xlsx export — sheet names + the Observations sheet's column headers. These are
  // human-facing chrome, so they localise. (The generic round-trip columns are
  // machine keys, and the investor/benchmark labels are detection-keyed German, so
  // both of those stay fixed regardless of locale.)
  xlsxSheetBuildings: { en: "Buildings", de: "Gebäude", fr: "Bâtiments" },
  xlsxSheetObservations: {
    en: "Observations",
    de: "Beobachtungen",
    fr: "Observations",
  },
  xlsxObsYear: { en: "Year", de: "Jahr", fr: "Année" },
  xlsxObsElectricity: {
    en: "Electricity (kWh)",
    de: "Strom (kWh)",
    fr: "Électricité (kWh)",
  },
  xlsxObsElectricityGeneration: {
    en: "Electricity generation (kWh)",
    de: "Stromerzeugung (kWh)",
    fr: "Production d'électricité (kWh)",
  },
  xlsxObsHeat: { en: "Heat (kWh)", de: "Wärme (kWh)", fr: "Chaleur (kWh)" },
  xlsxObsWater: { en: "Water (m³)", de: "Wasser (m³)", fr: "Eau (m³)" },
  xlsxObsWastewater: {
    en: "Wastewater (m³)",
    de: "Abwasser (m³)",
    fr: "Eaux usées (m³)",
  },
  xlsxObsRenewable: {
    en: "Renewable self-generated (%)",
    de: "Erneuerbar selbst erzeugt (%)",
    fr: "Renouvelable autoproduit (%)",
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
  // Observations finder — the View toggle (Map/List reuse btnMap/btnList) + the
  // per-building trend labels (the Trend view + each row's direction).
  obsViewAria: {
    en: "Observations view",
    de: "Beobachtungsansicht",
    fr: "Vue des observations",
  },
  obsViewOvertime: { en: "Over time", de: "Im Zeitverlauf", fr: "Dans le temps" },
  obsWithoutBuilding: {
    en: "Without a building",
    de: "Ohne Gebäude",
    fr: "Sans bâtiment",
  },
  obsLooseOnlyHint: {
    en:
      "{count} observation(s) aren't linked to a building yet — link them in the List to compare them here.",
    de:
      "{count} Beobachtung(en) sind noch keinem Gebäude zugeordnet — verknüpfen Sie sie in der Liste, um sie hier zu vergleichen.",
    fr:
      "{count} observation(s) ne sont pas encore associées à un bâtiment — associez-les dans la liste pour les comparer ici.",
  },
  obsOpenSection: {
    en: "Open generation (nearby)",
    de: "Offene Erzeugung (in der Nähe)",
    fr: "Production ouverte (à proximité)",
  },
  openObsUnavailable: {
    en: "This open observation's data couldn't be loaded.",
    de: "Die Daten dieser offenen Beobachtung konnten nicht geladen werden.",
    fr: "Les données de cette observation ouverte n'ont pas pu être chargées.",
  },
  openObsNoGeneration: {
    en: "No settled generation reported for this plant.",
    de: "Für diese Anlage ist keine abgerechnete Erzeugung gemeldet.",
    fr: "Aucune production réglée déclarée pour cette installation.",
  },
  obsOpenFallback: {
    en: "Renewable installation",
    de: "Erneuerbare-Anlage",
    fr: "Installation renouvelable",
  },
  obsOpenGenerationRow: {
    en: "{kwh} kWh generated ({year})",
    de: "{kwh} kWh erzeugt ({year})",
    fr: "{kwh} kWh produits ({year})",
  },
  obsLinkToBuilding: {
    en: "Link to a building",
    de: "Mit Gebäude verknüpfen",
    fr: "Associer à un bâtiment",
  },
  obsViewOveryears: { en: "Over years", de: "Über die Jahre", fr: "Au fil des ans" },
  obsViewTrend: { en: "Trend", de: "Trend", fr: "Tendance" },
  // The year column the grids emphasise: the time cut held across the views (the map
  // slider's `?y=`, or the latest reachable year while none is picked).
  cubeHeldYear: {
    en: "The year held across the views",
    de: "Das über die Ansichten gehaltene Jahr",
    fr: "L'année retenue dans toutes les vues",
  },
  // Pivot view — the rows × years grid whose row level is chosen (`?rows=`). The
  // region options reuse the choropleth level labels below; only the finest grain
  // and the no-region bucket need their own wording.
  obsViewPivot: { en: "Pivot", de: "Pivot", fr: "Tableau croisé" },
  pivotRowsLabel: { en: "Rows", de: "Zeilen", fr: "Lignes" },
  pivotRowsBuilding: { en: "Buildings", de: "Gebäude", fr: "Bâtiments" },
  pivotRowsBund: { en: "National (Bund)", de: "Bund", fr: "National" },
  pivotRowBund: { en: "Germany", de: "Deutschland", fr: "Allemagne" },
  pivotDrillInto: {
    en: "Drill down into {feature}",
    de: "{feature} aufschlüsseln",
    fr: "Détailler {feature}",
  },
  pivotScope: {
    en: "Within {region}",
    de: "Innerhalb von {region}",
    fr: "Dans {region}",
  },
  pivotRowUnassigned: {
    en: "Without a region",
    de: "Ohne Region",
    fr: "Sans région",
  },
  pivotCellTooltip: {
    en: "{feature} — {metric} {year}: {value} {unit} ({band})",
    de: "{feature} — {metric} {year}: {value} {unit} ({band})",
    fr: "{feature} — {metric} {year} : {value} {unit} ({band})",
  },
  pivotCellGap: {
    en: "{feature} — {metric} {year}: no data",
    de: "{feature} — {metric} {year}: keine Daten",
    fr: "{feature} — {metric} {year} : aucune donnée",
  },
  pivotCellAverage: {
    en: { one: "Ø of {count} building", other: "Ø of {count} buildings" },
    de: { one: "Ø aus {count} Gebäude", other: "Ø aus {count} Gebäuden" },
    fr: { one: "Ø de {count} bâtiment", other: "Ø de {count} bâtiments" },
  },
  // Materialized cells — the aggregation snapshots rendered beside the live rows
  // (`services/cube/snapshotCells.ts`): a labelled figure someone already computed,
  // with its Ø count and, for a benchmark, the agent that produced it.
  pivotMaterialized: {
    en: "Computed figures",
    de: "Berechnete Werte",
    fr: "Valeurs calculées",
  },
  pivotSnapshotTooltip: {
    en: "{name} — {metric} {year}: {value} {unit}",
    de: "{name} — {metric} {year}: {value} {unit}",
    fr: "{name} — {metric} {year} : {value} {unit}",
  },
  pivotSnapshotBy: {
    en: "Computed by {agent}",
    de: "Berechnet von {agent}",
    fr: "Calculé par {agent}",
  },
  // External cells — the official regional statistics (`qb:` cube) rendered beside
  // the live grid at a Land/Kreis row level (`services/cube/regionalCells.ts`): the
  // cube's drill-across. Its indicators keep their own names (the `reg*` ids) and
  // units, so each row states both.
  pivotOfficial: {
    en: "Official statistics",
    de: "Amtliche Statistik",
    fr: "Statistiques officielles",
  },
  pivotOfficialRow: {
    en: "{region} — {indicator} ({unit})",
    de: "{region} — {indicator} ({unit})",
    fr: "{region} — {indicator} ({unit})",
  },
  pivotOfficialCell: {
    en: "{region} — {indicator} {year}: {value} {unit}",
    de: "{region} — {indicator} {year}: {value} {unit}",
    fr: "{region} — {indicator} {year} : {value} {unit}",
  },
  // The time drill (`?series=`) — descending from a building row of the over-time /
  // pivot grid to the cube's FINEST time grain (its sub-hourly series), rendered as a
  // panel below the grid. The affordance shows only where such cells exist (the cube
  // is sparse), and the panel restates the full coordinate: which building, which
  // grain. Closing it reuses `btnClose`.
  seriesDrillAria: {
    en: "Show the sub-hourly series for {building}",
    de: "Viertelstundenreihe für {building} anzeigen",
    fr: "Afficher la série infra-horaire de {building}",
  },
  seriesDrillTitle: {
    en: "{building} — sub-hourly series",
    de: "{building} — Viertelstundenreihe",
    fr: "{building} — série infra-horaire",
  },
  // The entity-page → Explore hand-off ("explore this"): jump into the Explore
  // surface at the coordinate this page's entity sits at (`cube/exploreContext.ts`).
  // ONE label for every detail page that offers it, so the affordance reads the same
  // on a building, an observation and a regional dataset.
  showInExplore: {
    en: "Show in Explore",
    de: "In Erkunden anzeigen",
    fr: "Afficher dans Explorer",
  },
  // The Explore → saved-views hand-off: save the cut you are looking at as an
  // aggregation (opens the create dialog on the saved-views projection).
  obsSaveAsAggregation: {
    en: "Save as aggregation",
    de: "Als Aggregation speichern",
    fr: "Enregistrer comme agrégation",
  },
  pivotEmpty: {
    en:
      "No annual energy data yet. Add energy years to your buildings to pivot them " +
      "by building or region here.",
    de:
      "Noch keine Jahresenergiedaten. Füge deinen Gebäuden Energiejahre hinzu, um sie " +
      "hier nach Gebäude oder Region auszuwerten.",
    fr:
      "Aucune donnée énergétique annuelle pour l'instant. Ajoutez des années " +
      "énergétiques à vos bâtiments pour les croiser par bâtiment ou par région ici.",
  },
  trendImproving: {
    en: "Improving",
    de: "Verbessert sich",
    fr: "En amélioration",
  },
  trendFlat: { en: "Little change", de: "Kaum Veränderung", fr: "Peu de changement" },
  trendWorsening: {
    en: "Worsening",
    de: "Verschlechtert sich",
    fr: "En dégradation",
  },
  trendUnknown: {
    en: "No trend yet",
    de: "Noch kein Trend",
    fr: "Pas encore de tendance",
  },
  lensBandNoData: {
    en: "No data",
    de: "Keine Daten",
    fr: "Aucune donnée",
  },
  // The over-time heatmap's two colour keys and the hints that tell them apart: a
  // CELL is peer-relative (re-framed by what's shown), a TREND is self-relative (not).
  // The trend key's group label is `obsViewTrend` — the column it explains.
  obsLegendCells: {
    en: "Cell colour",
    de: "Zellfarbe",
    fr: "Couleur des cellules",
  },
  obsLegendCellsHint: {
    en:
      "A cell ranks its building against the other buildings shown in that same " +
      "year — changing the selection changes the colours.",
    de:
      "Eine Zelle vergleicht ihr Gebäude mit den übrigen angezeigten Gebäuden " +
      "desselben Jahres — eine andere Auswahl verändert die Farben.",
    fr:
      "Une cellule classe son bâtiment par rapport aux autres bâtiments affichés " +
      "pour la même année — modifier la sélection modifie les couleurs.",
  },
  obsLegendTrendHint: {
    en:
      "The trend compares each building with its own two most recent years, so it " +
      "stays the same whatever else is shown.",
    de:
      "Der Trend vergleicht jedes Gebäude mit seinen eigenen beiden jüngsten Jahren " +
      "und bleibt daher unabhängig von der Auswahl.",
    fr:
      "La tendance compare chaque bâtiment à ses deux années les plus récentes ; " +
      "elle reste donc identique quelle que soit la sélection.",
  },
  obsTrendTooltip: {
    en: "{name} — {from} → {to}: {change} ({unit})",
    de: "{name} — {from} → {to}: {change} ({unit})",
    fr: "{name} — {from} → {to} : {change} ({unit})",
  },
  obsTrendTooltipUnknown: {
    en: "Two comparable years are needed before a trend can be shown.",
    de: "Für einen Trend werden zwei vergleichbare Jahre benötigt.",
    fr: "Deux années comparables sont nécessaires pour afficher une tendance.",
  },
  // Region choropleth — the statistics map shaded by AGS-keyed regionalstatistik.
  choroplethTitle: {
    en: "Regional statistics",
    de: "Regionalstatistik",
    fr: "Statistiques régionales",
  },
  choroplethLevelLand: {
    en: "Bundesländer",
    de: "Bundesländer",
    fr: "Länder",
  },
  choroplethLevelKreis: {
    en: "Kreise",
    de: "Kreise",
    fr: "Arrondissements",
  },
  choroplethLoading: {
    en: "Loading regions…",
    de: "Regionen werden geladen…",
    fr: "Chargement des régions…",
  },
  choroplethLevelGemeinde: {
    en: "Gemeinden",
    de: "Gemeinden",
    fr: "Communes",
  },
  choroplethZoomHint: {
    en: "Zoom in for finer regions",
    de: "Für feinere Regionen hineinzoomen",
    fr: "Zoomez pour des régions plus fines",
  },
  choroplethGemeindeMetric: {
    en: "Rooftop-PV build-out (Ausbaugrad)",
    de: "PV-Dachflächen-Ausbaugrad",
    fr: "Taux d'équipement PV en toiture",
  },
  // Neighbourhood energy-profile choropleth on the building's observation page.
  neighbourhoodTitle: {
    en: "Location energy profile — neighbourhood",
    de: "Standort-Energieprofil — Umgebung",
    fr: "Profil énergétique du site — voisinage",
  },
  neighbourhoodSource: {
    en: "Rooftop-PV build-out per municipality · Energie-Atlas Bayern (Bavaria only)",
    de: "PV-Dachausbaugrad je Gemeinde · Energie-Atlas Bayern (nur Bayern)",
    fr: "Taux d'équipement PV par commune · Energie-Atlas Bayern (Bavière)",
  },
  choroplethGemeindeSource: {
    en: "Bavaria only · Energie-Atlas Bayern",
    de: "nur Bayern · Energie-Atlas Bayern",
    fr: "Bavière uniquement · Energie-Atlas Bayern",
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
  // The over-time heatmap's empty state (was `compareYearsEmpty`, orphaned when the
  // Compare-years view was folded into Over time).
  obsMatrixEmpty: {
    en:
      "No annual energy data yet. Add energy years to your buildings to compare " +
      "them over time here.",
    de:
      "Noch keine Jahresenergiedaten. Fügen Sie Ihren Gebäuden Energiejahre hinzu, " +
      "um sie hier im Zeitverlauf zu vergleichen.",
    fr:
      "Aucune donnée énergétique annuelle pour l'instant. Ajoutez des années " +
      "énergétiques à vos bâtiments pour les comparer dans le temps ici.",
  },
  // Energy-years dialog.
  eyAction: { en: "Energy years", de: "Energiejahre", fr: "Années énergétiques" },
} satisfies Record<string, Message>;
