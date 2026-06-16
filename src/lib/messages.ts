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
      "Noch keine Datenräume. Erstelle einen oder füge einen per URI oder QR-Code hinzu.",
    fr:
      "Aucune salle de données pour l'instant. Créez-en une, ou ajoutez-en une par URI ou QR code.",
  },
  sharedBuildingsEmpty: {
    en:
      "No buildings shared with you yet. Join a data room so owners can find you, or ask an owner to share with your WebID.",
    de:
      "Noch keine mit dir geteilten Gebäude. Tritt einem Datenraum bei, damit Eigentümer dich finden, oder bitte einen Eigentümer, mit deiner WebID zu teilen.",
    fr:
      "Aucun bâtiment partagé avec vous pour l'instant. Rejoignez une salle de données pour que les propriétaires vous trouvent, ou demandez à un propriétaire de partager avec votre WebID.",
  },
  sharedAggregationsEmpty: {
    en:
      "No aggregations shared with you yet. An aggregation a partner shares appears here.",
    de:
      "Noch keine mit dir geteilten Aggregationen. Eine von einem Partner geteilte Aggregation erscheint hier.",
    fr:
      "Aucune agrégation partagée avec vous pour l'instant. Une agrégation partagée par un partenaire apparaît ici.",
  },
  uiLanguage: { en: "Language", de: "Sprache", fr: "Langue" },
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
    de: "Deine Datenräume",
    fr: "Vos salles de données",
  },
  sharedBuildingsHeading: {
    en: "Buildings shared with you",
    de: "Mit dir geteilte Gebäude",
    fr: "Bâtiments partagés avec vous",
  },
  sharedAggregationsHeading: {
    en: "Aggregations shared with you",
    de: "Mit dir geteilte Aggregationen",
    fr: "Agrégations partagées avec vous",
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
    de: "Datenraum löschen",
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
  // Reusable button / small-label ids (shared across surfaces).
  btnClose: { en: "Close", de: "Schließen", fr: "Fermer" },
  btnBack: { en: "Back", de: "Zurück", fr: "Retour" },
  btnAdd: { en: "Add", de: "Hinzufügen", fr: "Ajouter" },
  revokeAccess: {
    en: "Revoke access",
    de: "Zugriff entziehen",
    fr: "Révoquer l'accès",
  },
  noRole: { en: "no role", de: "keine Rolle", fr: "aucun rôle" },
  btnShare: { en: "Share", de: "Teilen", fr: "Partager" },
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
    de: "Datenraum-Mitglieder",
    fr: "Membres de la salle de données",
  },
  shareNoMembers: {
    en: "No other members in your active data room. Enter a WebID below instead.",
    de:
      "Keine weiteren Mitglieder in deinem aktiven Datenraum. Gib stattdessen unten eine " +
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
    de: "Datenraum zu deiner Liste hinzugefügt",
    fr: "Salle de données ajoutée à votre liste",
  },
  roomCreated: {
    en: "Data room created",
    de: "Datenraum erstellt",
    fr: "Salle de données créée",
  },
  roomUnreachable: {
    en: "Data room is not reachable",
    de: "Datenraum nicht erreichbar",
    fr: "Salle de données injoignable",
  },
  roomLeft: {
    en: "You left the data room",
    de: "Du hast den Datenraum verlassen",
    fr: "Vous avez quitté la salle de données",
  },
  roomDeleted: {
    en: "Data room deleted",
    de: "Datenraum gelöscht",
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
    de: "Hinzufügen der Beispiel-Datenräume",
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
