// Intent core (React-free) for SetEnergyCertificate. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { setEnergyCertificate } from "../services/attachmentManager.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the SetEnergyCertificate intent. */
export interface SetEnergyCertificateParams {
  /** The building file's IRI (the resource carrying the flag). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The attachment IRI to flag as the energy certificate (`null` clears it). */
  url: string | null;
}

/**
 * React-free core of
 * {@link import("../hooks/mutations.ts").useSetEnergyCertificate}: flag one
 * attachment as the energy certificate (`url: null` clears it). The adapter owns
 * the buildings invalidation.
 */
export async function setEnergyCertificateCore(
  session: Session,
  params: SetEnergyCertificateParams,
): Promise<Settled> {
  await setEnergyCertificate(params.fileUri, params.subjectUri, params.url, session);
  return { ok: true };
}
