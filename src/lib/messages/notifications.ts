/** Catalog slice — Toasts & notifications, the formatError error-toast template, and the palette verb / param-form labels.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const notifications = {
  // Organisation dialog chrome.
  orgDialogTitle: {
    en: "Your organisation",
    de: "Deine Organisation",
    fr: "Votre organisation",
  },
  orgEmpty: {
    en: "No organisation yet. Add your organisation's name and logo.",
    de: "Noch keine Organisation. Füge Name und Logo deiner Organisation hinzu.",
    fr: "Aucune organisation. Ajoutez le nom et le logo de votre organisation.",
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
  markerProducerLogoAlt: {
    en: "Building producer logo",
    de: "Logo des Gebäudeproduzenten",
    fr: "Logo du producteur du bâtiment",
  },
  markerOperatorLogoAlt: {
    en: "Building operator logo",
    de: "Logo des Gebäudebetreibers",
    fr: "Logo de l'exploitant du bâtiment",
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
  btnEditEnergyYears: {
    en: "Edit energy years",
    de: "Energiejahre bearbeiten",
    fr: "Modifier les années énergétiques",
  },
  cubeYearAria: {
    en: "Energy year",
    de: "Energiejahr",
    fr: "Année énergétique",
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
    en: "All app data deleted",
    de: "Alle App-Daten gelöscht",
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
  actionCreateBuilding: {
    en: "create the building",
    de: "Erstellen des Gebäudes",
    fr: "la création du bâtiment",
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
  actionDeclineDemos: {
    en: "dismiss the demo-data offer",
    de: "Ablehnen des Demodaten-Angebots",
    fr: "le refus de l'offre de données de démonstration",
  },
  actionClearObservations: {
    en: "clear the building's observations",
    de: "Löschen der Beobachtungen des Gebäudes",
    fr: "l'effacement des observations du bâtiment",
  },
  actionLinkObservation: {
    en: "link the observation to a building",
    de: "Verknüpfen der Beobachtung mit einem Gebäude",
    fr: "l'association de l'observation à un bâtiment",
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
  actionAddDemoAgents: {
    en: "add demo agents",
    de: "Hinzufügen der Beispielagenten",
    fr: "l'ajout des agents de démonstration",
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
  actionDeleteAppData: {
    en: "delete app data",
    de: "Löschen der App-Daten",
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
  actionCheckObsLinks: {
    en: "check observation links",
    de: "Prüfen der Beobachtungs-Verknüpfungen",
    fr: "la vérification des liens d'observation",
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
  actionAddAgent: {
    en: "add agent",
    de: "Hinzufügen des Agenten",
    fr: "l'ajout du agent",
  },
  // Agents flow notifications (the `showNotification` vocabulary — migrated per
  // area; the add-failure toast still goes through `formatError`, a later slice).
  enterWebId: {
    en: "Enter a WebID (an http(s) URI)",
    de: "Gib eine WebID ein (eine http(s)-URI)",
    fr: "Saisissez un WebID (une URI http(s))",
  },
  agentAdded: { en: "Agent added", de: "Agent hinzugefügt", fr: "Agent ajouté" },
  agentRemoved: {
    en: "Agent removed",
    de: "Agent entfernt",
    fr: "Agent supprimé",
  },
  // Per-object action-menu verb labels (the intent-registry-driven row/section
  // actions — plan-palette §3). One id per registry descriptor whose verb is
  // surfaced as an action control; the registry maps `descriptor.name` → these.
  intentCreateBuilding: {
    en: "Create building…",
    de: "Gebäude erstellen…",
    fr: "Créer un bâtiment…",
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
  intentRemoveAgent: {
    en: "Remove agent…",
    de: "Agent entfernen…",
    fr: "Supprimer le agent…",
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
  intentAddBookmark: {
    en: "Bookmark data room…",
    de: "Datenzimmer-Lesezeichen hinzufügen…",
    fr: "Ajouter un marque-page de salle de données…",
  },
  // Palette labels for the dev demo seeders surfaced as direct-invoke verbs (the
  // account-menu groups agents+rooms under one item; the palette surfaces each
  // verb on its own, so they need distinct wording).
  intentSeedDemoAgents: {
    en: "Add example agents",
    de: "Beispielagenten hinzufügen",
    fr: "Ajouter des agents d'exemple",
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
  paramAttachments: { en: "Attachments", de: "Anhänge", fr: "Pièces jointes" },
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
