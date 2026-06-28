/** Catalog slice — Create-mode + create-aggregation dialogs, app-shell dev tools, account menu & onboarding, shared buttons, the login screen.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const shellAuth = {
  // Create mode (Observations finder → "Add observation"): the required building
  // picker (the FeatureOfInterest) and the placeholder before one is chosen.
  eyBuildingLabel: { en: "Building", de: "Gebäude", fr: "Bâtiment" },
  eyBuildinglessHint: {
    en: "No building selected — this observation will be unbound. Link it to a building later.",
    de: "Kein Gebäude gewählt — diese Beobachtung bleibt ungebunden. Verknüpfen Sie sie später mit einem Gebäude.",
    fr: "Aucun bâtiment sélectionné — cette observation restera non liée. Associez-la à un bâtiment plus tard.",
  },
  eyAddObservation: {
    en: "Add observation",
    de: "Beobachtung hinzufügen",
    fr: "Ajouter une observation",
  },
  eyObserveFor: {
    en: "Observe for",
    de: "Beobachten für",
    fr: "Observer pour",
  },
  eyFoiBuilding: {
    en: "Building (whole)",
    de: "Gebäude (gesamt)",
    fr: "Bâtiment (entier)",
  },
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
  menuAddAgents: {
    en: "Add example agents and rooms",
    de: "Beispielagenten und -datenräume hinzufügen",
    fr: "Ajouter des agents et salles d'exemple",
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
  menuCheckObsLinks: {
    en: "Check observation links",
    de: "Beobachtungs-Verknüpfungen prüfen",
    fr: "Vérifier les liens d'observation",
  },
  devObsLinksConsistent: {
    en: "Observation links consistent: {checked} observation(s) match their buildings",
    de:
      "Beobachtungs-Verknüpfungen konsistent: {checked} Beobachtung(en) stimmen mit ihren Gebäuden überein",
    fr:
      "Liens d'observation cohérents : {checked} observation(s) correspondent à leurs bâtiments",
  },
  devObsLinksDrift: {
    en:
      "Observation-link drift: {drift} of {checked} observation(s) are out of sync with their buildings (see the console)",
    de:
      "Verknüpfungs-Abweichung: {drift} von {checked} Beobachtung(en) sind nicht mit ihren Gebäuden synchron (siehe Konsole)",
    fr:
      "Dérive des liens : {drift} sur {checked} observation(s) ne sont pas synchronisées avec leurs bâtiments (voir la console)",
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
    en: "Delete all app data…",
    de: "Alle App-Daten löschen…",
    fr: "Supprimer toutes les données…",
  },
  menuChangeAccount: {
    en: "Change account (full logout)",
    de: "Konto wechseln (vollständige Abmeldung)",
    fr: "Changer de compte (déconnexion complète)",
  },
  menuLogout: { en: "Logout", de: "Abmelden", fr: "Déconnexion" },
  removingAllData: {
    en: "Deleting all app data…",
    de: "Alle App-Daten werden gelöscht…",
    fr: "Suppression de toutes les données…",
  },
  onboardAddExamples: { en: "Add examples", de: "Beispiele hinzufügen", fr: "Ajouter des exemples" },
  btnNoThanks: { en: "No thanks", de: "Nein danke", fr: "Non merci" },
  appErrorLoadingData: {
    en: "Error loading data: {error}",
    de: "Fehler beim Laden der Daten: {error}",
    fr: "Erreur lors du chargement des données : {error}",
  },
  buildingNotFoundOrNoAccess: {
    en: "Building not found or you don’t have access to view this building.",
    de: "Gebäude nicht gefunden oder Sie haben keinen Zugriff auf dieses Gebäude.",
    fr: "Bâtiment introuvable ou vous n’avez pas accès à ce bâtiment.",
  },
  removalCancelled: {
    en: "Removal cancelled — some data may already be deleted",
    de: "Entfernung abgebrochen — einige Daten wurden möglicherweise bereits gelöscht",
    fr: "Suppression annulée — certaines données ont peut-être déjà été supprimées",
  },
  onboardBanner: {
    en: "No buildings yet — add a couple of example buildings (with energy data) to explore?",
    de: "Noch keine Gebäude — ein paar Beispielgebäude (mit Energiedaten) zum Erkunden hinzufügen?",
    fr: "Aucun bâtiment — ajouter quelques bâtiments d'exemple (avec données énergétiques) à explorer ?",
  },
  demoAgentsAdded: {
    en: "Demo agents added",
    de: "Demo-Agenten hinzugefügt",
    fr: "Agents de démonstration ajoutés",
  },
  demoAgentsPartial: {
    en: "Added {seeded} of {total} demo agents",
    de: "{seeded} von {total} Demo-Agenten hinzugefügt",
    fr: "{seeded} sur {total} agents de démonstration ajoutés",
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
  loginLede: {
    en:
      "Use the Granergize App to browse, compare and share energy consumption data of " +
      "logistics real estate. With the Granergize App, you keep control over your data.",
    de:
      "Mit der Granergize App durchsuchen, vergleichen und teilen Sie Energieverbrauchs" +
      "daten von Logistikimmobilien. Mit der Granergize App behalten Sie die Kontrolle " +
      "über Ihre Daten.",
    fr:
      "Utilisez la Granergize App pour parcourir, comparer et partager les données de " +
      "consommation énergétique de l'immobilier logistique. Avec la Granergize App, vous " +
      "gardez le contrôle de vos données.",
  },
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
  loginCouldNotSignInTo: {
    en: "Couldn’t sign in to {idp}.",
    de: "Anmeldung bei {idp} fehlgeschlagen.",
    fr: "Échec de la connexion à {idp}.",
  },
  loginCouldNotSignIn: {
    en: "Couldn’t sign in.",
    de: "Anmeldung fehlgeschlagen.",
    fr: "Échec de la connexion.",
  },
  loginEnterIdpHint: {
    en:
      "Enter your identity provider’s web address — for example https://login.inrupt.com or https://solidcommunity.net — not your email or WebID.",
    de:
      "Geben Sie die Web-Adresse Ihres Identitätsanbieters ein — zum Beispiel https://login.inrupt.com oder https://solidcommunity.net — nicht Ihre E-Mail oder WebID.",
    fr:
      "Saisissez l’adresse web de votre fournisseur d’identité — par exemple https://login.inrupt.com ou https://solidcommunity.net — et non votre e-mail ou WebID.",
  },
  loginSignIn: {
    en: "Recommended identity providers",
    de: "Empfohlene Identity Provider",
    fr: "Fournisseurs d'identité recommandés",
  },
  loginSignInAgainWith: {
    en: "Previously used",
    de: "Zuletzt verwendet",
    fr: "Récemment utilisés",
  },
  loginSignInOther: {
    en: "Other",
    de: "Andere",
    fr: "Autre",
  },
  loginIdpLabel: {
    en: "Identity provider URI",
    de: "Identity-Provider-URI",
    fr: "URI du fournisseur d'identité",
  },
  loginIdpPlaceholder: {
    en: "e.g. https://inrupt.net",
    de: "z. B. https://inrupt.net",
    fr: "p. ex. https://inrupt.net",
  },
  btnBack: { en: "Back", de: "Zurück", fr: "Retour" },
  btnAdd: { en: "Add", de: "Hinzufügen", fr: "Ajouter" },
  revokeAccess: {
    en: "Revoke access",
    de: "Zugriff entziehen",
    fr: "Révoquer l'accès",
  },
} satisfies Record<string, Message>;
