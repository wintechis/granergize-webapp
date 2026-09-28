/** Catalog slice — Finders (empty states + search), the ⌘K command palette, navigation labels & detail-page section headings.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const navFinders = {
  // Finder empty states — the highest-value app-chrome prose to translate (each is
  // a self-contained `"No X yet. <how to get one>"` per the UI conventions).
  agentsEmpty: {
    en: "No agents yet. Add one by WebID or QR code.",
    de: "Noch keine Akteure. Füge einen per WebID oder QR-Code hinzu.",
    fr: "Aucun agent pour l'instant. Ajoutez-en un par WebID ou QR code.",
  },
  // Agents finder: the source-tier facet now reuses the shared TierFilter (mine/
  // shared/open, tierMine/tierShared/tierOpen), so a per-row hint marks the ones
  // referenced-but-not-saved.
  agentReferencedHint: {
    en: "Referenced in your buildings — not yet saved",
    de: "In deinen Gebäuden referenziert — noch nicht gespeichert",
    fr: "Référencé dans vos bâtiments — pas encore enregistré",
  },
  agentSaveToBookAria: {
    en: "Save to agents",
    de: "Zu Akteuren speichern",
    fr: "Enregistrer dans les agents",
  },
  buildingsEmpty: {
    en:
      "No buildings yet. Add one, or autofill from a file — \"Autofill from file\" also offers example files to try.",
    de:
      "Noch keine Gebäude. Füge eines hinzu oder fülle automatisch aus einer Datei — unter „Automatisch aus Datei“ stehen auch Beispieldateien zum Ausprobieren bereit.",
    fr:
      "Aucun bâtiment pour l'instant. Ajoutez-en un, ou remplissez automatiquement à partir d'un fichier — « Remplir depuis un fichier » propose aussi des fichiers d'exemple à essayer.",
  },
  observationsEmpty: {
    en:
      "No observations yet. Add energy data on a building's observation page to see it here.",
    de:
      "Noch keine Beobachtungen. Füge Energiedaten auf der Beobachtungsseite eines Gebäudes hinzu, um sie hier zu sehen.",
    fr:
      "Aucune observation pour l'instant. Ajoutez des données énergétiques sur la page d'observation d'un bâtiment pour les voir ici.",
  },
  obsClearAria: {
    en: "Clear all data",
    de: "Alle Daten löschen",
    fr: "Effacer toutes les données",
  },
  obsClearTitle: {
    en: "Clear observation data",
    de: "Beobachtungsdaten löschen",
    fr: "Effacer les données d'observation",
  },
  obsClearConfirm: {
    en:
      "Delete all observations ({years} year(s)) for {name}? The building stays; only its energy data is removed. This cannot be undone.",
    de:
      "Alle Beobachtungen ({years} Jahr(e)) für {name} löschen? Das Gebäude bleibt; nur die Energiedaten werden entfernt. Dies kann nicht rückgängig gemacht werden.",
    fr:
      "Supprimer toutes les observations ({years} année(s)) pour {name} ? Le bâtiment reste ; seules ses données énergétiques sont supprimées. Action irréversible.",
  },
  obsDeleteLooseConfirm: {
    en:
      "Delete the building-less observation for {year}? This cannot be undone.",
    de:
      "Die gebäudelose Beobachtung für {year} löschen? Dies kann nicht rückgängig gemacht werden.",
    fr:
      "Supprimer l'observation sans bâtiment pour {year} ? Action irréversible.",
  },
  obsCleared: {
    en: "Observations cleared for {name}",
    de: "Beobachtungen für {name} gelöscht",
    fr: "Observations effacées pour {name}",
  },
  obsClearedPartial: {
    en: "Cleared {done} of {total} observation datasets for {name} — the rest could not be deleted",
    de: "{done} von {total} Beobachtungs-Datensätzen für {name} gelöscht — der Rest konnte nicht gelöscht werden",
    fr: "{done} des {total} jeux d'observations de {name} effacés — le reste n'a pas pu être supprimé",
  },
  exportedBuildingsPartial: {
    en: "Exported {done} of {total} buildings; the rest could not be read.",
    de: "{done} von {total} Gebäuden exportiert; der Rest konnte nicht gelesen werden.",
    fr: "{done} des {total} bâtiments exportés ; le reste n’a pas pu être lu.",
  },
  obsDatasetSummary: {
    en: {
      one: "1 year ({range}) · {kind}",
      other: "{count} years ({range}) · {kind}",
    },
    de: {
      one: "1 Jahr ({range}) · {kind}",
      other: "{count} Jahre ({range}) · {kind}",
    },
    fr: {
      one: "1 an ({range}) · {kind}",
      other: "{count} ans ({range}) · {kind}",
    },
  },
  obsKindAnnual: {
    en: "annual",
    de: "jährlich",
    fr: "annuel",
  },
  obsKindAnnualPlusSeries: {
    en: "annual + time series",
    de: "jährlich + Zeitreihe",
    fr: "annuel + série temporelle",
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
    en: "Search or type a command…",
    de: "Suchen oder Befehl eingeben…",
    fr: "Rechercher ou saisir une commande…",
  },
  paletteEmpty: {
    en: "No matches",
    de: "Keine Treffer",
    fr: "Aucun résultat",
  },
  paletteGroupNavigation: { en: "Go to", de: "Gehe zu", fr: "Aller à" },
  paletteGroupActions: { en: "Actions", de: "Aktionen", fr: "Actions" },
  // Per-building quick action: jump to a building's observation page with the
  // energy-year dialog auto-opened (owner-only buildings).
  paletteAddObservation: {
    en: "Add observation to {name}",
    de: "Beobachtung zu {name} hinzufügen",
    fr: "Ajouter une observation à {name}",
  },
  // Dev-mode JSON paste-and-launch (plan-intent-core §10): paste a `{name,params}`
  // intent into the palette and press Enter to launch it.
  paletteLaunchHint: {
    en: "Launch JSON intent — press Enter to run",
    de: "JSON-Intent starten — Enter zum Ausführen",
    fr: "Lancer l'intention JSON — Entrée pour exécuter",
  },
  // NL→intent translation: a query starting with `>` is natural language the LLM
  // turns into intent JSON (which then lands in the JSON launch mode). User-facing.
  paletteNlHint: {
    en: "Translate to intent — press Enter",
    de: "In Intent übersetzen — Enter drücken",
    fr: "Traduire en intention — appuyez sur Entrée",
  },
  paletteNlBusy: {
    en: "Translating…",
    de: "Übersetze…",
    fr: "Traduction…",
  },
  // Suffix word for the retry indicator, e.g. "Translating… (retry 1/1)".
  paletteNlRetry: {
    en: "retry",
    de: "Wiederholung",
    fr: "nouvelle tentative",
  },
  paletteOpenAria: {
    en: "Search (Ctrl K)",
    de: "Suchen (Strg K)",
    fr: "Rechercher (Ctrl K)",
  },
  // Top-nav finder labels.
  navBuildings: { en: "Buildings", de: "Gebäude", fr: "Bâtiments" },
  // The analytical surface over the energy cube — named for what you do there, not for
  // the resources it renders (Step 1 of `plans/plan-cube-centered-ui.md`; the id keeps
  // its historical name so every consumer, incl. the e2e helpers, follows the text).
  navObservations: {
    en: "Explore",
    de: "Erkunden",
    fr: "Explorer",
  },
  navAggregations: {
    en: "Aggregations",
    de: "Aggregationen",
    fr: "Agrégations",
  },
  navSharing: { en: "Sharing", de: "Freigaben", fr: "Partages" },
  navAgents: { en: "Agents", de: "Akteure", fr: "Agents" },
  navMeet: { en: "Meet", de: "Treffen", fr: "Rencontrer" },
  // Finder page headings (exact-nav-word headings reuse the nav* ids above).
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
  sepRooftopPv: {
    en: "Rooftop PV",
    de: "Dach-Photovoltaik",
    fr: "PV en toiture",
  },
  // Per-building rooftop-PV (computed in-app over the LoD2 roof geometry).
  rpRooftopPotential: {
    en: "Rooftop PV (this building)",
    de: "Dach-Photovoltaik (dieses Gebäude)",
    fr: "PV en toiture (ce bâtiment)",
  },
  rpInstallable: { en: "Installable", de: "Installierbar", fr: "Installable" },
  rpAnnualYield: {
    en: "Annual yield",
    de: "Jahresertrag",
    fr: "Production annuelle",
  },
  rpValuePerYear: { en: "Value/year", de: "Wert/Jahr", fr: "Valeur/an" },
  rpUsableArea: {
    en: "Usable roof area",
    de: "Nutzbare Dachfläche",
    fr: "Surface utile",
  },
  rpOrientation: { en: "Orientation", de: "Ausrichtung", fr: "Orientation" },
  rpEstimateCaption: {
    en: "Estimate at {price} ct/kWh self-consumption",
    de: "Schätzung bei {price} ct/kWh Eigenverbrauch",
    fr: "Estimation à {price} ct/kWh autoconsommation",
  },
  rpViewOnMap: {
    en: "View on the LoD2 map ↗",
    de: "Auf der LoD2-Karte ansehen ↗",
    fr: "Voir sur la carte LoD2 ↗",
  },
  // The 3D viewer: the building's full LoD2 solid (roof/wall/ground) from linked-lod2-by.
  b3dTitle: { en: "3D model", de: "3D-Modell", fr: "Modèle 3D" },
  b3dReset: {
    en: "Reset view (north up)",
    de: "Ansicht zurücksetzen (Norden oben)",
    fr: "Réinitialiser la vue (nord en haut)",
  },
  b3dHint: {
    en:
      "Measured LoD2 building model (Bayerische Vermessungsverwaltung, via linked-lod2-by). Drag to orbit, scroll to zoom.",
    de:
      "Gemessenes LoD2-Gebäudemodell (Bayerische Vermessungsverwaltung, über linked-lod2-by). Ziehen zum Drehen, Scrollen zum Zoomen.",
    fr:
      "Modèle LoD2 mesuré du bâtiment (Bayerische Vermessungsverwaltung, via linked-lod2-by). Glisser pour pivoter, molette pour zoomer.",
  },
  // The roof-plan: the building's LoD2 roof surfaces, shaded by PV yield.
  rpRoofPlan: {
    en: "Roof surfaces",
    de: "Dachflächen",
    fr: "Surfaces de toiture",
  },
  rpRoofPlanHint: {
    en:
      "Each roof face shaded by expected PV yield; grey = unsuitable (north-facing or too steep).",
    de:
      "Jede Dachfläche nach erwartetem PV-Ertrag eingefärbt; grau = ungeeignet (nordseitig oder zu steil).",
    fr:
      "Chaque pan de toit coloré selon le rendement PV attendu ; gris = inadapté (nord ou trop pentu).",
  },
  rpRoofUnsuitable: { en: "unsuitable", de: "ungeeignet", fr: "inadapté" },
  sepPotential: { en: "Potential", de: "Potenzial", fr: "Potentiel" },
  sepInstalled: { en: "Installed", de: "Installiert", fr: "Installé" },
  sepHeadroom: { en: "Untapped", de: "Ausbaulücke", fr: "Inexploité" },
  sepBuiltOut: { en: "built out", de: "erschlossen", fr: "exploité" },
  // Rooftop-PV benchmark: this building's own installed/potential against its Gemeinde.
  sepBmTitle: {
    en: "Rooftop PV in context",
    de: "Dach-PV im Vergleich",
    fr: "PV en toiture en contexte",
  },
  sepBmThisBuilding: {
    en: "This building",
    de: "Dieses Gebäude",
    fr: "Ce bâtiment",
  },
  sepBmArea: { en: "This area", de: "Diese Gemeinde", fr: "Cette commune" },
  sepBmRealizedCaption: {
    en: "share of rooftop potential already installed",
    de: "Anteil des Dach-Potenzials, bereits installiert",
    fr: "part du potentiel en toiture déjà installée",
  },
  sepBmShare: {
    en: "This roof's {self} kWp add to the area's {remaining} MWp of remaining rooftop potential.",
    de: "Die {self} kWp dieses Dachs zählen zu den {remaining} MWp verbleibendem Dach-Potenzial der Gemeinde.",
    fr: "Les {self} kWp de ce toit s'ajoutent aux {remaining} MWp de potentiel en toiture restant de la commune.",
  },
  sepBmVsAvg: {
    en: "Typical local PV installation ≈ {typical} kWp; this building {self} kWp.",
    de: "Typische PV-Anlage vor Ort ≈ {typical} kWp; dieses Gebäude {self} kWp.",
    fr: "Installation PV locale typique ≈ {typical} kWp ; ce bâtiment {self} kWp.",
  },
  sepGroundPv: {
    en: "Ground-mounted PV",
    de: "Freiflächen-Photovoltaik",
    fr: "PV au sol",
  },
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
  sepBiogasPotential: {
    en: "Biogas potential",
    de: "Biogaspotenzial",
    fr: "Potentiel biogaz",
  },
  sepPlants: { en: "plants", de: "Anlagen", fr: "installations" },
  sepNearbyGeneration: {
    en: "Nearby generation",
    de: "Erzeugung in der Nähe",
    fr: "Production à proximité",
  },
  sepActualGeneration: {
    en: "{kwh} kWh actually generated ({year})",
    de: "{kwh} kWh tatsächlich erzeugt ({year})",
    fr: "{kwh} kWh réellement produits ({year})",
  },
  sepWithin: { en: "within", de: "im Umkreis von", fr: "dans un rayon de" },
  secResults: { en: "Results", de: "Ergebnisse", fr: "Résultats" },
  secDetails: { en: "Details", de: "Details", fr: "Détails" },
  secInvite: { en: "Invite", de: "Einladung", fr: "Invitation" },
  secMembers: { en: "Members", de: "Mitglieder", fr: "Membres" },
  secProfile: { en: "Profile", de: "Profil", fr: "Profil" },
  secAppearsIn: { en: "Appears in", de: "Erscheint in", fr: "Apparaît dans" },
} satisfies Record<string, Message>;
