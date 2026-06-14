/**
 * Building identity — the single chokepoint for minting and interpreting
 * building subject IRIs.
 *
 * A building's identity IS its subject IRI; nothing rests on UUID uniqueness.
 * Own buildings are minted `<file>.ttl#it` — the file name carries a UUID
 * purely as a collision-free local *file name*, and the constant fragment
 * separates the building (the thing) from its document. The app-level
 * {@link buildingIdFor id} is the subject IRI verbatim, shortened to the
 * storage-root-relative reference when the building lives on the user's own
 * Pod: `granergize/buildings/<uuid>.ttl#it`. Foreign/shared buildings keep
 * their full absolute IRI — the only identifier another Pod's minting
 * guarantees — including the fragment (one foreign document may hold several
 * buildings).
 *
 * The two id shapes are syntactically disjoint (RFC 3986: a relative
 * reference cannot carry a scheme), so {@link isAbsoluteIri} disambiguates
 * without any marker. Ids contain `/` and `#`; route/link builders must
 * `encodeURIComponent` them (inside the HashRouter a raw `#` truncates the
 * route).
 */

/** The constant fragment of an own building's subject IRI. */
export const BUILDING_FRAGMENT = "it";

/** `<file>.ttl` → `<file>.ttl#it` — the only place a building subject is minted. */
export function mintBuildingSubject(fileUri: string): string {
  return `${fileUri}#${BUILDING_FRAGMENT}`;
}

/**
 * True iff `ref` is an absolute IRI (carries a scheme, RFC 3986 §4.3). The
 * scheme must precede any `/`, which the regex guarantees by excluding `/`
 * from the scheme characters — a storage-relative id (`granergize/…`) never
 * matches.
 */
export function isAbsoluteIri(ref: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref);
}

/**
 * Subject IRI → app-level id: the storage-root-relative reference when the
 * subject lives under `ownStorageRoot`, else the IRI verbatim. Callers
 * without a resolved root (offline fixtures, headless paths) pass nothing
 * and get all-absolute ids — the shapes stay interchangeable via
 * {@link buildingSubjectFor}.
 */
export function buildingIdFor(
  subjectIri: string,
  ownStorageRoot?: string,
): string {
  if (ownStorageRoot && subjectIri.startsWith(ownStorageRoot)) {
    return subjectIri.slice(ownStorageRoot.length);
  }
  return subjectIri;
}

/** App-level id → absolute subject IRI (identity for already-absolute ids). */
export function buildingSubjectFor(id: string, ownStorageRoot: string): string {
  return isAbsoluteIri(id) ? id : `${ownStorageRoot}${id}`;
}

/** Subject IRI (or any ref) → its document URL: the fragment stripped. */
export function buildingFileUri(subjectIri: string): string {
  return subjectIri.split("#")[0];
}

/** App-level id → absolute document URL. */
export function buildingFileUriFor(id: string, ownStorageRoot: string): string {
  return buildingFileUri(buildingSubjectFor(id, ownStorageRoot));
}

/**
 * Display-only short form of an id, for label FALLBACKS (`Building <stem>`):
 * the fragment when it is meaningful, else the file stem (basename minus
 * `.ttl`). Never an identifier — two stems may collide; the id itself is the
 * identity.
 */
export function buildingIdStem(id: string): string {
  const [doc, fragment] = id.split("#");
  if (fragment && fragment !== BUILDING_FRAGMENT) return fragment;
  const basename = doc.split("/").filter(Boolean).pop() ?? doc;
  return basename.replace(/\.ttl$/, "");
}
