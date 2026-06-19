/// <reference lib="deno.ns" />
/**
 * Catalog task `contacts` (headless): a referenced building agent (the `operatedBy`
 * WebID) is auto-remembered into the address book. This is the headless,
 * deterministic counterpart of `contacts.spec.ts` — whose e2e assertion polls a
 * fire-and-forget write through the browser and so flakes under load. Here we test
 * the two halves directly:
 *
 *   1. `rememberAgent` itself — AWAITED (its promise settles after the immediate
 *      fragment-named write), so the contact's presence is a deterministic fact, not
 *      a race. The agent WebID is an unresolvable `.example` IRI, so the label stays
 *      the WebID fragment (the background profile upgrade can't refine it) — exactly
 *      the e2e's fallback path.
 *   2. The `AddBuilding` intent WIRING — a building saved with an `operatedBy` WebID
 *      fires `rememberAgent` (un-awaited, `void`), so we poll the book briefly. No
 *      browser, no Cloudflare, local Pod → the immediate write lands in ms.
 *
 * Self-cleaning: A's `contacts.ttl` is snapshotted and restored, and the seeded
 * building is deleted.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { invoke } from "../../../src/intents/registry.ts";
import {
  contactsUri,
  readContacts,
  rememberAgent,
} from "../../../src/services/contacts.ts";
import { webIdFragment } from "../../../src/services/agents/agentResolver.ts";
import { deleteBuilding } from "../../../src/services/rdf/building/buildingSerializer.ts";

export const name = "contacts";

/** Unresolvable agent WebIDs → the remembered name stays the fragment. */
const OP_DIRECT = "https://contacts-it.example/profile/card#OperatorDirect";
const OP_VIA_BUILDING = "https://contacts-it.example/profile/card#OperatorBuilding";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, check } = ctx;
  const contacts = contactsUri(a.webId);
  const contactsSnap = await snapshot(a.raw, contacts);

  let buildingUri = "";
  try {
    // ── 1. rememberAgent directly (AWAITED) — deterministic presence + label ──
    await rememberAgent(a.session, OP_DIRECT);
    const afterRemember = await readContacts(a.session);
    const direct = afterRemember.find((c) => c.webId === OP_DIRECT);
    check(
      "rememberAgent writes the agent into the address book",
      !!direct,
      `contacts=[${afterRemember.map((c) => c.webId).join(", ")}]`,
    );
    check(
      "the remembered contact is labelled by the WebID fragment (no resolve)",
      direct?.name === webIdFragment(OP_DIRECT),
      `name=${direct?.name} expected=${webIdFragment(OP_DIRECT)}`,
    );

    // ── 2. AddBuilding intent wiring — saving operatedBy auto-remembers it ────
    const addOutcome = await invoke(
      "AddBuilding",
      {
        buildings: [
          {
            streetAddress: "Kontaktweg 4",
            locality: "Nürnberg",
            lat: "49.45",
            long: "11.08",
            operatedBy: OP_VIA_BUILDING,
          },
        ],
      },
      a.session,
    );
    buildingUri = addOutcome.added[0] ?? "";
    check("invoke(AddBuilding) wrote one building", addOutcome.added.length === 1);

    // The intent fires `void rememberAgent` — poll the book until it lands (ms on a
    // local Pod; a bounded loop keeps it deterministic without assuming ordering).
    let remembered = false;
    for (let i = 0; i < 25 && !remembered; i++) {
      const list = await readContacts(a.session);
      remembered = list.some((c) => c.webId === OP_VIA_BUILDING);
      if (!remembered) await new Promise((r) => setTimeout(r, 200));
    }
    check(
      "saving a building's operatedBy WebID auto-remembers it as a contact",
      remembered,
    );
  } finally {
    if (buildingUri) {
      await deleteBuilding(a.session, a.webId, buildingUri).catch(() => {});
    }
    await restore(a.raw, contacts, contactsSnap);
  }
}
