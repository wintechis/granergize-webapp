/** Catalog slice — Finder row-action labels, aggregation/agent detail pages, the tier source facet, and the Agents/Rooms/Aggregations finders.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const detailRooms = {
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
  // Agent detail page.
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
  // Tier source-selector (multi-select union: which provenance sources to show).
  tierFilterAria: { en: "Filter by source", de: "Nach Quelle filtern", fr: "Filtrer par source" },
  tierMine: { en: "Mine", de: "Meine", fr: "Les miens" },
  tierShared: { en: "Shared with me", de: "Mit mir geteilt", fr: "Partagés avec moi" },
  tierOpen: { en: "Open data", de: "Offene Daten", fr: "Données ouvertes" },
  openBuildingLabel: {
    en: "Open building",
    de: "Offenes Gebäude",
    fr: "Bâtiment ouvert",
  },
  openBuildingDetailTitle: {
    en: "Open building — rooftop potential",
    de: "Offenes Gebäude — Dachpotenzial",
    fr: "Bâtiment ouvert — potentiel de toiture",
  },
  openBuildingUnavailable: {
    en: "This open building's data couldn't be loaded.",
    de: "Die Daten dieses offenen Gebäudes konnten nicht geladen werden.",
    fr: "Les données de ce bâtiment ouvert n'ont pas pu être chargées.",
  },
  openNeedsOwnBuilding: {
    en: "Open data shows around your own buildings — add one with a location to see it.",
    de: "Offene Daten erscheinen rund um Ihre eigenen Gebäude — fügen Sie eines mit Standort hinzu, um sie zu sehen.",
    fr: "Les données ouvertes apparaissent autour de vos propres bâtiments — ajoutez-en un avec une localisation pour les voir.",
  },
  exploreToggle: {
    en: "Explore this area",
    de: "Diesen Bereich erkunden",
    fr: "Explorer cette zone",
  },
  explorePlacePlaceholder: {
    en: "Search a place…",
    de: "Ort suchen…",
    fr: "Rechercher un lieu…",
  },
  exploreSearchBtn: {
    en: "Search",
    de: "Suchen",
    fr: "Rechercher",
  },
  exploreNoMatch: {
    en: 'No place found for "{place}".',
    de: 'Kein Ort für „{place}" gefunden.',
    fr: 'Aucun lieu trouvé pour « {place} ».',
  },
  exploreChooseArea: {
    en: "Exploring open data — pan the map or search a place to choose an area.",
    de: "Offene Daten erkunden — Karte verschieben oder einen Ort suchen, um einen Bereich zu wählen.",
    fr: "Exploration des données ouvertes — déplacez la carte ou recherchez un lieu pour choisir une zone.",
  },
  filterNoMatch: {
    en: "Nothing matches the current filter.",
    de: "Nichts entspricht dem aktuellen Filter.",
    fr: "Rien ne correspond au filtre actuel.",
  },
  agentAddToBook: {
    en: "Add to agents",
    de: "Zu Agenten hinzufügen",
    fr: "Ajouter aux agents",
  },
  agentName: { en: "Name", de: "Name", fr: "Nom" },
  // Agent kind toggle: an agent is a person or an organisation.
  agentKind: { en: "Type", de: "Art", fr: "Type" },
  agentKindPerson: { en: "Person", de: "Person", fr: "Personne" },
  agentKindOrganisation: {
    en: "Organisation",
    de: "Organisation",
    fr: "Organisation",
  },
  // A locally-asserted "works for" edge from a person agent to an org agent.
  agentWorksFor: { en: "Works for", de: "Arbeitet für", fr: "Travaille pour" },
  agentWorksForNone: { en: "— none —", de: "— keine —", fr: "— aucune —" },
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
  agentAddAria: {
    en: "Add agent",
    de: "Agent hinzufügen",
    fr: "Ajouter un agent",
  },
  agentRemoveAria: {
    en: "Remove agent",
    de: "Agent entfernen",
    fr: "Retirer le agent",
  },
  // Generic affordances reused by the Agents + Rooms finders.
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
  roomLeaveBtn: { en: "Leave", de: "Verlassen", fr: "Quitter" },
  roomLeaving: { en: "Leaving…", de: "Wird verlassen…", fr: "Sortie…" },
  roomUriLabel: {
    en: "Data room URI",
    de: "Datenzimmer-URI",
    fr: "URI de la salle de données",
  },
  roomNameLabel: {
    en: "Room name",
    de: "Raumname",
    fr: "Nom de la salle",
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
  btnTable: { en: "Table", de: "Tabelle", fr: "Tableau" },
  regStatsViewAria: {
    en: "Regional statistics view",
    de: "Ansicht der Regionalstatistik",
    fr: "Vue des statistiques régionales",
  },
  btnList: { en: "List", de: "Liste", fr: "Liste" },
  bldgsViewAria: {
    en: "Buildings view",
    de: "Gebäudeansicht",
    fr: "Vue des bâtiments",
  },
  // Aggregations finder guise toggle (list | map | timeline).
  guiseTimeline: { en: "Timeline", de: "Zeitverlauf", fr: "Chronologie" },
  aggGuiseAria: {
    en: "Aggregations view",
    de: "Aggregationsansicht",
    fr: "Vue des agrégations",
  },
  aggExtentLabel: {
    en: "Region level",
    de: "Regionsebene",
    fr: "Niveau de région",
  },
  aggExtentHelp: {
    en: "Resolved from the selected buildings; “Automatic” uses the finest region they share.",
    de:
      "Aus den gewählten Gebäuden bestimmt; „Automatisch“ nimmt die feinste gemeinsame Region.",
    fr:
      "Déterminé d’après les bâtiments sélectionnés ; « Automatique » prend la région commune la plus fine.",
  },
  aggExtentAuto: { en: "Automatic", de: "Automatisch", fr: "Automatique" },
  aggExtentGemeinde: { en: "Municipality", de: "Gemeinde", fr: "Commune" },
  aggExtentKreis: { en: "District", de: "Kreis", fr: "Arrondissement" },
  aggExtentLand: { en: "State", de: "Bundesland", fr: "Land" },
  aggExtentBund: { en: "Germany", de: "Deutschland", fr: "Allemagne" },
  aggRegionMapTitle: {
    en: "Covered region",
    de: "Abgedeckte Region",
    fr: "Région couverte",
  },
  aggMapEmpty: {
    en: "No own aggregations to map yet.",
    de: "Noch keine eigenen Aggregationen für die Karte.",
    fr: "Aucune agrégation propre à cartographier pour le moment.",
  },
  aggMapMetricLabel: { en: "Shade by", de: "Einfärben nach", fr: "Colorer selon" },
  aggTimelineEmpty: {
    en: "No aggregations or datasets to chart yet.",
    de: "Noch keine Aggregationen oder Datensätze für das Diagramm.",
    fr: "Aucune agrégation ou jeu de données à tracer pour le moment.",
  },
  aggTimelineNoData: {
    en: "No yearly data for this metric.",
    de: "Keine Jahresdaten für diese Kennzahl.",
    fr: "Aucune donnée annuelle pour cette métrique.",
  },
  aggMapUnplaced: {
    en: "Not placed ({count}) — no single shared region, or only a Bundesland:",
    de: "Nicht verortet ({count}) — keine gemeinsame Region oder nur ein Bundesland:",
    fr: "Non localisées ({count}) — pas de région commune, ou seulement un Land :",
  },
  mapChoroplethUnplaced: {
    en: { one: "{count} building without a region", other: "{count} buildings without a region" },
    de: { one: "{count} Gebäude ohne Region", other: "{count} Gebäude ohne Region" },
    fr: { one: "{count} bâtiment sans région", other: "{count} bâtiments sans région" },
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
  // The unsaved-input guard shown when Escape is pressed in a dirty dialog
  // (the in-app confirm that replaced the native `window.confirm`).
  dlgDiscardTitle: {
    en: "Discard changes?",
    de: "Änderungen verwerfen?",
    fr: "Abandonner les modifications ?",
  },
  dlgDiscardBody: {
    en: "You have unsaved changes. Discard them?",
    de: "Sie haben ungespeicherte Änderungen. Verwerfen?",
    fr: "Vous avez des modifications non enregistrées. Les abandonner ?",
  },
  btnDiscard: { en: "Discard", de: "Verwerfen", fr: "Abandonner" },
  btnRestore: { en: "Restore", de: "Wiederherstellen", fr: "Restaurer" },
  btnRemoveAll: { en: "Remove all", de: "Alle entfernen", fr: "Tout supprimer" },
  saveRoles: { en: "Save roles", de: "Rollen speichern", fr: "Enregistrer les rôles" },
  btnDownload: { en: "Download", de: "Herunterladen", fr: "Télécharger" },
} satisfies Record<string, Message>;
