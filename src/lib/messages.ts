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
import { DEFAULT_LANG, type Lang } from "./language.ts";

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
