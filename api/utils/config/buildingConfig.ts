import type { BuildingType } from "../../../types/types.ts"

export const predicateMap: { [key: string]: keyof BuildingType } = {
  "http://schema.org/customer": "customer",
  "http://www.w3.org/2003/01/geo/wgs84_pos#lat": "lat",
  "http://www.w3.org/2003/01/geo/wgs84_pos#long": "long",
  "http://www.w3.org/2006/vcard/ns#locality": "locality",
  "http://www.w3.org/2006/vcard/ns#postal-code": "postalCode",
  "http://www.w3.org/2006/vcard/ns#region": "region",
  "http://www.w3.org/2006/vcard/ns#street-address": "streetAddress",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingArea": "buildingArea",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasLandArea": "landArea",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasPVSystem": "hasPVSystem",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#investor": "investor",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#officeArea": "officeArea",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#usedAs": "usedAs",
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#yearOfConstruction": "yearOfConstruction",
  "https://w3id.org/rec#nace-code": "naceCode",
  "https://w3id.org/rec#operatedBy": "operatedBy",
};

export const parsingFunctions: { [key: string]: (value: string) => number | boolean } = {
  "lat": parseFloat,
  "long": parseFloat,
  "postalCode": parseInt,
  "buildingArea": parseInt,
  "landArea": parseInt,
  "hasPVSystem": (value: string) => value.toLowerCase() === "true",
  "officeArea": parseInt,
  "yearOfConstruction": parseInt,
  "naceCode": parseFloat,
};