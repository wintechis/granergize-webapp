/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import type { AttachmentRef } from "../../../types/types.ts";
import {
  deleteAttachment,
  filesContainerFor,
  setEnergyCertificate,
  uploadAttachment,
} from "./attachmentManager.ts";
import { parseBuildings } from "./buildingParser.ts";
import {
  DCTERMS_CREATED,
  GRAN_HAS_ATTACHMENT,
  GRAN_HAS_ENERGY_CERTIFICATE,
  RDF_TYPE,
  REC_BUILDING,
  SCHEMA_CONTENT_SIZE,
  SCHEMA_NAME,
} from "./vocabularies.ts";

const FILE = "https://pod.example/granergize/buildings/b1.ttl";
const SUBJECT = `${FILE}#building`;
const OWNER = "https://me.example/profile/card#me";

/** A stateful multi-resource fake Pod keyed by URL (query stripped). */
function makePod(seed: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(seed));
  const session = {
    info: { isLoggedIn: true, webId: OWNER },
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        store.set(url, String(init?.body ?? ""));
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (method === "DELETE") {
        const had = store.delete(url);
        return Promise.resolve(new Response(null, { status: had ? 205 : 404 }));
      }
      if (method === "HEAD") {
        return Promise.resolve(
          new Response(null, { status: store.has(url) ? 200 : 404 }),
        );
      }
      return Promise.resolve(
        store.has(url)
          ? new Response(store.get(url)!, {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          })
          : new Response("not found", { status: 404 }),
      );
    },
  } as unknown as Session;
  return { session, store };
}

const building = () => `<${SUBJECT}> <${RDF_TYPE}> <${REC_BUILDING}> .\n`;
const parse = (ttl: string) =>
  new Store(new Parser({ baseIRI: FILE }).parse(ttl));
const newFile = (name: string, body = "hello", type = "application/pdf") =>
  new File([body], name, { type });

Deno.test("filesContainerFor derives the per-building files/ container", () => {
  assert.equal(
    filesContainerFor(SUBJECT),
    "https://pod.example/granergize/buildings/b1/files/",
  );
  assert.equal(
    filesContainerFor(FILE),
    "https://pod.example/granergize/buildings/b1/files/",
  );
});

Deno.test("uploadAttachment stores the binary and links it with metadata", async () => {
  const { session, store } = makePod({ [FILE]: building() });

  const ref = await uploadAttachment(FILE, SUBJECT, newFile("report.pdf"), session);

  const container = filesContainerFor(FILE);
  const expectedUrl = `${container}report.pdf`;
  assert.equal(ref.url, expectedUrl);
  assert.equal(ref.filename, "report.pdf");
  assert.equal(ref.mediaType, "application/pdf");
  assert.equal(ref.size, 5);
  // Binary stored, and the container was provisioned.
  assert.ok(store.has(expectedUrl), "binary PUT to files/");
  assert.ok(store.has(container), "files/ container provisioned");

  const g = parse(store.get(FILE)!);
  assert.equal(
    g.getObjects(SUBJECT, GRAN_HAS_ATTACHMENT, null)[0]?.value,
    expectedUrl,
    "gran:hasAttachment link",
  );
  assert.equal(g.getObjects(expectedUrl, SCHEMA_NAME, null)[0]?.value, "report.pdf");
  assert.equal(g.getObjects(expectedUrl, SCHEMA_CONTENT_SIZE, null)[0]?.value, "5");
  assert.ok(
    g.getObjects(expectedUrl, DCTERMS_CREATED, null)[0]?.value,
    "dcterms:created set",
  );
});

Deno.test("duplicate filenames are de-duplicated, not clobbered", async () => {
  const { session, store } = makePod({ [FILE]: building() });
  const a = await uploadAttachment(FILE, SUBJECT, newFile("report.pdf"), session);
  const b = await uploadAttachment(FILE, SUBJECT, newFile("report.pdf"), session);

  assert.notEqual(a.url, b.url, "second upload gets a distinct URL");
  assert.ok(b.url.endsWith("report-1.pdf"));
  const links = parse(store.get(FILE)!).getObjects(SUBJECT, GRAN_HAS_ATTACHMENT, null);
  assert.equal(links.length, 2, "two distinct attachments linked");
});

Deno.test("setEnergyCertificate flags a file; deleteAttachment removes it + the flag", async () => {
  const { session, store } = makePod({ [FILE]: building() });
  const ref = await uploadAttachment(FILE, SUBJECT, newFile("epc.pdf"), session);

  await setEnergyCertificate(FILE, SUBJECT, ref.url, session);
  let g = parse(store.get(FILE)!);
  assert.equal(
    g.getObjects(SUBJECT, GRAN_HAS_ENERGY_CERTIFICATE, null)[0]?.value,
    ref.url,
    "cert flag points at the file",
  );
  // Parsed building reflects the flag.
  const parsed = [
    ...parseBuildings([...g]).values(),
  ][0];
  const certEntry = (parsed.attachments as AttachmentRef[]).find((x) =>
    x.url === ref.url
  );
  assert.equal(certEntry?.isEnergyCertificate, true);

  await deleteAttachment(FILE, SUBJECT, ref.url, session);
  assert.ok(!store.has(ref.url), "binary deleted");
  g = parse(store.get(FILE)!);
  assert.equal(
    g.getObjects(SUBJECT, GRAN_HAS_ATTACHMENT, null).length,
    0,
    "attachment link removed",
  );
  assert.equal(
    g.getObjects(SUBJECT, GRAN_HAS_ENERGY_CERTIFICATE, null).length,
    0,
    "cert flag cleared",
  );
  assert.equal(
    g.getObjects(ref.url, SCHEMA_NAME, null).length,
    0,
    "metadata removed",
  );
});

Deno.test("parser synthesizes an attachment for a legacy certificate (no gran:hasAttachment)", () => {
  const legacy =
    "https://pod.example/granergize/buildings/certificates/b1_energy_certificate.pdf";
  const ttl = `${building()}<${SUBJECT}> <${GRAN_HAS_ENERGY_CERTIFICATE}> <${legacy}> .\n`;
  const parsed = [...parseBuildings([...parse(ttl)]).values()][0];
  const list = parsed.attachments as AttachmentRef[];
  assert.equal(list.length, 1);
  assert.equal(list[0].url, legacy);
  assert.equal(list[0].filename, "b1_energy_certificate.pdf");
  assert.equal(list[0].isEnergyCertificate, true);
});
