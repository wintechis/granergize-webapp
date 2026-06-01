/** Shared RDF vocabulary IRI constants used across services */

export const GRAN_NS =
  "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";
export const USERVOC_NS =
  "https://solid.ti.rw.fau.de/private/granergize/user-vocab.ttl#";
export const INVESTOR_NS =
  "https://solid.ti.rw.fau.de/private/granergize/investor-vocab.ttl#";
export const BENCH_NS =
  "https://solid.ti.rw.fau.de/private/granergize/benchmark-vocab.ttl#";

/** FOAF — personal avatar (foaf:img) and the organisation's name/logo/homepage. */
export const FOAF_NS = "http://xmlns.com/foaf/0.1/";

/** vCard — profile photo (vcard:hasPhoto) fallback for the avatar. */
export const VCARD_NS = "http://www.w3.org/2006/vcard/ns#";

/** W3C Org ontology — person→organisation membership (org:memberOf). */
export const ORG_NS = "http://www.w3.org/ns/org#";

/** OWL — owl:sameAs links the local org node to the org's own WebID, if any. */
export const OWL_NS = "http://www.w3.org/2002/07/owl#";

export const SOSA_NS = "http://www.w3.org/ns/sosa/";
export const TIME_NS = "http://www.w3.org/2006/time#";
export const SSN_NS = "http://www.w3.org/ns/ssn/";

/** SIOC — data room roles are sioc:Role values linked via sioc:has_function */
export const SIOC_NS = "http://rdfs.org/sioc/ns#";

/** Activity Streams 2.0 — data room membership events (as:Join / as:Leave / as:Update) */
export const AS_NS = "https://www.w3.org/ns/activitystreams#";

/** PROV-O — used for the append-only data room role-assignment log */
export const PROV_NS = "http://www.w3.org/ns/prov#";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const ACL_NS = "http://www.w3.org/ns/auth/acl#";

export const XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime";
export const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
export const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";
