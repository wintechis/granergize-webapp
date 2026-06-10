/** Shared RDF vocabulary IRI constants used across services */

// The three Granergize vocabularies, partitioned by subject (see vocab/README.md):
// core (app/interop plumbing), building (rec:Building master data), consumption
// (SOSA energy observations + the views/benchmarks derived from them).
export const GRAN_NS = "https://solid.ti.rw.fau.de/gra/vocab.ttl#";
export const BUILDING_NS = "https://solid.ti.rw.fau.de/gra/building.ttl#";
export const CONSUMPTION_NS = "https://solid.ti.rw.fau.de/gra/consumption.ttl#";
/**
 * Benchmark result — a `cons:AggregatedViewSnapshot` a benchmark service provider
 * computes over the buildings shared to it and shares back. `BENCH_COMPUTED_BY`
 * names the computing agent (foaf:Agent); `BENCH_METRIC_PERIOD` the year covered.
 */
export const BENCH_RESULT = `${CONSUMPTION_NS}BenchmarkResult`;
export const BENCH_COMPUTED_BY = `${CONSUMPTION_NS}computedBy`;
export const BENCH_METRIC_PERIOD = `${CONSUMPTION_NS}metricPeriod`;

/** FOAF — personal avatar (foaf:img) and the organisation's name/logo/homepage. */
export const FOAF_NS = "http://xmlns.com/foaf/0.1/";
/** foaf:Agent — the rdfs:range of agent-valued properties (e.g. rec:operatedBy). */
export const FOAF_AGENT = `${FOAF_NS}Agent`;
export const FOAF_NAME = `${FOAF_NS}name`;
export const FOAF_IMG = `${FOAF_NS}img`;
/** foaf:logo — an organisation's logo image (used for map markers). */
export const FOAF_LOGO = `${FOAF_NS}logo`;

/** vCard — profile photo (vcard:hasPhoto) fallback for the avatar. */
export const VCARD_NS = "http://www.w3.org/2006/vcard/ns#";
export const VCARD_FN = `${VCARD_NS}fn`;
export const VCARD_HAS_PHOTO = `${VCARD_NS}hasPhoto`;
export const VCARD_INDIVIDUAL = `${VCARD_NS}Individual`;
export const VCARD_ADDRESS_BOOK = `${VCARD_NS}AddressBook`;
export const VCARD_HAS_MEMBER = `${VCARD_NS}hasMember`;

/**
 * W3C Basic Geo (WGS84). A building's coordinates live on a `geo:Point` blank
 * node linked by `geo:location`, so the geocoding precision can be attached to
 * the coordinate itself (`bldg:geocodePrecision`) rather than the building.
 */
export const GEO_NS = "http://www.w3.org/2003/01/geo/wgs84_pos#";
export const GEO_LOCATION = `${GEO_NS}location`;
export const GEO_POINT = `${GEO_NS}Point`;
export const GEO_LAT = `${GEO_NS}lat`;
export const GEO_LONG = `${GEO_NS}long`;

/**
 * Granergize: how precisely a `geo:Point` was geocoded — `Address` (full
 * street), `Postcode` (postcode + city) or `City` (city only) — recorded when
 * the lookup had to fall back to a coarser query. IRI-valued (controlled vocab).
 */
export const GRAN_GEOCODE_PRECISION = `${BUILDING_NS}geocodePrecision`;
export const GEOCODE_PRECISION_IRI = {
  address: `${BUILDING_NS}Address`,
  postcode: `${BUILDING_NS}Postcode`,
  city: `${BUILDING_NS}City`,
} as const;
export type GeocodePrecision = keyof typeof GEOCODE_PRECISION_IRI;
/** Reverse of {@link GEOCODE_PRECISION_IRI} (IRI → precision key), for parsing. */
export const IRI_TO_GEOCODE_PRECISION: Record<string, GeocodePrecision> = Object
  .fromEntries(
    Object.entries(GEOCODE_PRECISION_IRI).map(([k, v]) => [v, k]),
  ) as Record<string, GeocodePrecision>;

/** W3C Org ontology — person→organisation membership (org:memberOf). */
export const ORG_NS = "http://www.w3.org/ns/org#";
export const ORG_MEMBER_OF = `${ORG_NS}memberOf`;

/** OWL — owl:sameAs links the local org node to the org's own WebID, if any. */
export const OWL_NS = "http://www.w3.org/2002/07/owl#";

export const SOSA_NS = "http://www.w3.org/ns/sosa/";
export const TIME_NS = "http://www.w3.org/2006/time#";
export const SSN_NS = "http://www.w3.org/ns/ssn/";

/** QUDT units — kWh (`KiloW-HR`), m³ (`M3`), percent (`PERCENT`) on energy results. */
export const UNIT_NS = "https://qudt.org/vocab/unit#";

/** SIOC — data room roles are sioc:Role values linked via sioc:has_function */
export const SIOC_NS = "http://rdfs.org/sioc/ns#";

/** Activity Streams 2.0 — data room membership events (as:Join / as:Leave / as:Update) */
export const AS_NS = "https://www.w3.org/ns/activitystreams#";

/** PROV-O — building data provenance (qualified attribution to a producing agent). */
export const PROV_NS = "http://www.w3.org/ns/prov#";
export const PROV_QUALIFIED_ATTRIBUTION = `${PROV_NS}qualifiedAttribution`;
export const PROV_ATTRIBUTION = `${PROV_NS}Attribution`;
export const PROV_AGENT = `${PROV_NS}agent`;
export const PROV_WAS_ASSOCIATED_WITH = `${PROV_NS}wasAssociatedWith`;
export const PROV_GENERATED_AT_TIME = `${PROV_NS}generatedAtTime`;

// Solid Application Interoperability — the access-grant vocabulary used for the
// sharing event logs (shared-in/ and shared-out/) and the inbox messages.
export const INTEROP_NS = "http://www.w3.org/ns/solid/interop#";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const ACL_NS = "http://www.w3.org/ns/auth/acl#";

export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const XSD_DATETIME = `${XSD_NS}dateTime`;
export const XSD_INTEGER = `${XSD_NS}integer`;
export const XSD_DECIMAL = `${XSD_NS}decimal`;
export const XSD_DATE = `${XSD_NS}date`;
export const XSD_STRING = `${XSD_NS}string`;
export const XSD_BOOLEAN = `${XSD_NS}boolean`;
export const XSD_GYEAR = `${XSD_NS}gYear`;

/** LDP — container membership (`ldp:contains`) and inbox discovery (`ldp:inbox`). */
export const LDP_NS = "http://www.w3.org/ns/ldp#";
export const LDP_CONTAINS = `${LDP_NS}contains`;
export const LDP_INBOX = `${LDP_NS}inbox`;

/** RealEstateCore (industry ontology, not W3C) — a building resource is typed `rec:Building`. */
export const REC_NS = "https://w3id.org/rec#";
export const REC_BUILDING = `${REC_NS}Building`;
/** rec:ownedBy — the building's owner as a WebID (reused directly, like rec:operatedBy). */
export const REC_OWNED_BY = `${REC_NS}ownedBy`;

/**
 * Building file attachments. A building links each uploaded file with
 * `bldg:hasAttachment <fileIRI>`; the file IRI is itself the subject of the
 * media metadata (schema.org `MediaObject`), so no blank node is needed. The
 * energy certificate is just one such file, additionally flagged with
 * `bldg:hasEnergyCertificate` (see {@link GRAN_HAS_ENERGY_CERTIFICATE}).
 */
export const GRAN_HAS_ATTACHMENT = `${BUILDING_NS}hasAttachment`;
export const GRAN_HAS_ENERGY_CERTIFICATE = `${BUILDING_NS}hasEnergyCertificate`;

/** schema.org — file metadata (a `schema:MediaObject` describing a stored file). */
export const SCHEMA_NS = "http://schema.org/";
export const SCHEMA_MEDIA_OBJECT = `${SCHEMA_NS}MediaObject`;
export const SCHEMA_NAME = `${SCHEMA_NS}name`;
export const SCHEMA_ENCODING_FORMAT = `${SCHEMA_NS}encodingFormat`;
export const SCHEMA_CONTENT_SIZE = `${SCHEMA_NS}contentSize`;

/** Dublin Core Terms — `dcterms:created` for an attachment's upload timestamp. */
export const DCTERMS_NS = "http://purl.org/dc/terms/";
export const DCTERMS_CREATED = `${DCTERMS_NS}created`;
