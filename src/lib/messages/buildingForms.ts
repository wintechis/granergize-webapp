/** Catalog slice — Building master-data section headers, confirm-dialog titles & the Add/Edit form field labels.
 *
 * Part of the message catalog assembled in `../messages.ts`; see it for the
 * translator/lookup machinery. */
import type { Message } from "./messageTypes.ts";

export const buildingForms = {
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
    en: "Delete all app data",
    de: "Alle App-Daten löschen",
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
} satisfies Record<string, Message>;
