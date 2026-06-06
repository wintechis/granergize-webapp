/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  serializeBuildingToTurtle,
  updateBuilding,
} from "./buildingSerializer.ts";
import { INVESTOR_NS } from "./vocabularies.ts";

const FILE = "https://pod.example/granergize/buildings/b1.ttl";
const SUBJECT = `${FILE}#b1`;

/** A stateful single-resource fake: GET serves the body, PUT overwrites it. */
function podWith(initialBody: string): { session: Session; body: () => string } {
  let body = initialBody;
  const session = {
    info: { isLoggedIn: true, webId: "https://me.example/profile/card#me" },
    fetch: (_input: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        body = String(init?.body ?? "");
        return Promise.resolve(new Response(null, { status: 205 }));
      }
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    },
  } as unknown as Session;
  return { session, body: () => body };
}

Deno.test("updateBuilding preserves operating-cost and certification substructures on a scalar edit", async () => {
  // A building file carrying an operating-cost node and a certification node.
  const initial = serializeBuildingToTurtle(
    {
      streetAddress: "Old Street 1",
      _opcost_insurance: "1200",
      _cert_0_type: "LEED",
      _cert_0_level: "Gold",
    },
    FILE,
  );
  const { session, body } = podWith(initial);

  // Edit only a scalar field (the Edit dialog never sends _opcost_/_cert_ keys).
  await updateBuilding(session, FILE, SUBJECT, { streetAddress: "New Street 2" });

  const store = new Store(new Parser({ baseIRI: FILE }).parse(body()));
  // The blank-node substructures must survive the edit untouched.
  assert.equal(
    store.getQuads(null, `${INVESTOR_NS}hasOperatingCosts`, null, null).length,
    1,
    "operating-cost node preserved",
  );
  assert.equal(
    store.getObjects(null, `${INVESTOR_NS}insurance`, null)[0]?.value,
    "1200",
    "operating-cost value preserved",
  );
  assert.equal(
    store.getQuads(null, `${INVESTOR_NS}hasBuildingCertification`, null, null)
      .length,
    1,
    "certification node preserved",
  );
  assert.equal(
    store.getObjects(null, `${INVESTOR_NS}certificationLevel`, null)[0]?.value,
    "Gold",
    "certification level preserved",
  );
});

Deno.test("updateBuilding replaces operating costs and certifications when the edit carries those keys", async () => {
  const initial = serializeBuildingToTurtle(
    {
      streetAddress: "Old Street 1",
      _opcost_insurance: "1200",
      _cert_0_type: "LEED",
      _cert_0_level: "Gold",
    },
    FILE,
  );
  const { session, body } = podWith(initial);

  // Edit the substructures: change the insurance figure and the cert level.
  await updateBuilding(session, FILE, SUBJECT, {
    _opcost_insurance: "1500",
    _cert_0_type: "LEED",
    _cert_0_level: "Platinum",
  });

  const store = new Store(new Parser({ baseIRI: FILE }).parse(body()));
  assert.equal(
    store.getObjects(null, `${INVESTOR_NS}insurance`, null)[0]?.value,
    "1500",
    "operating cost updated",
  );
  // Exactly one operating-cost node (replaced, not duplicated).
  assert.equal(
    store.getQuads(null, `${INVESTOR_NS}hasOperatingCosts`, null, null).length,
    1,
  );
  assert.equal(
    store.getObjects(null, `${INVESTOR_NS}certificationLevel`, null)[0]?.value,
    "Platinum",
    "certification level updated",
  );
  assert.equal(
    store.getQuads(null, `${INVESTOR_NS}hasBuildingCertification`, null, null)
      .length,
    1,
  );
});

Deno.test("updateBuilding clears an operating-cost field when its edited value is emptied", async () => {
  const initial = serializeBuildingToTurtle(
    { streetAddress: "S", _opcost_insurance: "1200", _opcost_security: "300" },
    FILE,
  );
  const { session, body } = podWith(initial);

  // Re-submit the operating costs with insurance cleared (security kept).
  await updateBuilding(session, FILE, SUBJECT, {
    _opcost_insurance: "",
    _opcost_security: "300",
  });

  const store = new Store(new Parser({ baseIRI: FILE }).parse(body()));
  assert.equal(
    store.getObjects(null, `${INVESTOR_NS}insurance`, null).length,
    0,
    "cleared field removed",
  );
  assert.equal(
    store.getObjects(null, `${INVESTOR_NS}security`, null)[0]?.value,
    "300",
    "other field kept",
  );
});
