// Agent object model — the saved-agent address-book record and the organisation
// profile node. First-class peers of BuildingType (the persisted records the user
// curates); their parse/serialize lives in `services/savedAgents.ts` /
// `services/organisation/organisationManager.ts`, which re-export these for their
// existing importers. Reached via the `src/types.ts` barrel.

/**
 * A saved agent (the vCard address-book record). `kind` distinguishes a person
 * (`vcard:Individual`) from an organisation (`vcard:Organization`). For an
 * organisation the user may *override* the canonical profile locally — the agent's
 * own profile isn't ours to edit — so the book also caches the org's editable
 * `homepage` (`vcard:hasURL`) and `sameAs` (`owl:sameAs`, e.g. a Wikidata entity the
 * logo derives from). The local record wins over the resolved profile.
 */
export interface SavedAgent {
  webId: string;
  name?: string;
  avatarUrl?: string;
  kind?: "person" | "organisation";
  /** An organisation agent's logo image (`vcard:logo`), uploaded to the user's own
   *  Pod — the local-record counterpart of the own-org `foaf:logo`. */
  logoUrl?: string;
  /** An organisation's website (`vcard:hasURL`). */
  homepage?: string;
  /** Cross-references (`owl:sameAs`), e.g. a Wikidata entity for logo derivation. */
  sameAs?: string[];
  /**
   * A locally-asserted "works for" edge (`org:memberOf`) to the WebID of an
   * organisation the user also keeps as an agent. Independent of the agent's own
   * profile — the user records the affiliation they know of; this local edge wins
   * over any `org:memberOf` the agent's own profile publishes (see resolveAgentOrg).
   */
  memberOf?: string;
}

/** The user's own organisation node (`<#org>` on the WebID profile). */
export interface Organisation {
  /** Display name (foaf:name). */
  name?: string;
  /** Logo image IRI (foaf:logo). */
  logoUrl?: string;
  /** Homepage IRI (foaf:homepage). */
  homepage?: string;
  /** The organisation's own WebID/IRI, if any (owl:sameAs). */
  sameAs?: string;
}
