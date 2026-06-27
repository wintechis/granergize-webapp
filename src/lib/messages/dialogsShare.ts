/** Catalog slice — Files, add-building, sharing, share-building, share-aggregation & organisation dialogs.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const dialogsShare = {
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
  addBuildingBtn: { en: "Create Building", de: "Gebäude erstellen", fr: "Créer un bâtiment" },
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
    en: "Pick an agent/member, or type a WebID and press Enter",
    de: "Agent/Mitglied wählen oder eine WebID eingeben und Enter drücken",
    fr: "Choisissez un agent/membre, ou saisissez une WebID et appuyez sur Entrée",
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
      "Choose recipients from your agents and data room members, or type a WebID " +
      "and press Enter to add it.",
    de:
      "Wähle Empfänger aus deinen Agenten und Datenzimmer-Mitgliedern, oder gib eine " +
      "WebID ein und drücke Enter, um sie hinzuzufügen.",
    fr:
      "Choisissez des destinataires parmi vos agents et membres de la salle de " +
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
  shareAttachmentsLabel: {
    en: "Attachments to share",
    de: "Zu teilende Anhänge",
    fr: "Pièces jointes à partager",
  },
  shareAttachmentsHint: {
    en:
      "All attachments are shared by default (including files added later). Uncheck any to withhold it.",
    de:
      "Standardmäßig werden alle Anhänge geteilt (auch später hinzugefügte Dateien). Häkchen entfernen, um eine Datei zurückzuhalten.",
    fr:
      "Toutes les pièces jointes sont partagées par défaut (y compris les fichiers ajoutés ultérieurement). Décochez pour en retenir une.",
  },
  shareAttachmentsAllSummary: {
    en: "All attachments",
    de: "Alle Anhänge",
    fr: "Toutes les pièces jointes",
  },
  shareAttachmentsSubsetSummary: {
    en: "Attachments: {names}",
    de: "Anhänge: {names}",
    fr: "Pièces jointes : {names}",
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
} satisfies Record<string, Message>;
