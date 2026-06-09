/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { createZip, crc32, readZip, type ZipEntry } from "./zip.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

Deno.test("crc32 matches the canonical IEEE check value", () => {
  // The standard CRC-32 of the ASCII string "123456789".
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

Deno.test("createZip output begins with the local-file-header signature", () => {
  const zip = createZip([{ path: "a.txt", data: enc.encode("hi") }]);
  // PK\x03\x04
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

Deno.test("round-trips text and binary entries, preserving order and bytes", () => {
  const binary = new Uint8Array([0, 1, 2, 254, 255, 128, 7]);
  const entries: ZipEntry[] = [
    { path: "manifest.json", data: enc.encode('{"v":1}') },
    { path: "buildings/Nürnberg.ttl", data: enc.encode("@prefix x: <#> .") },
    { path: "files/photo.bin", data: binary },
    { path: "empty", data: new Uint8Array(0) },
  ];
  const out = readZip(createZip(entries));

  assert.equal(out.length, entries.length);
  // Order preserved (central directory written in insertion order).
  assert.deepEqual(out.map((e) => e.path), entries.map((e) => e.path));
  // UTF-8 filename survives.
  assert.equal(dec.decode(enc.encode(out[1].path)), "buildings/Nürnberg.ttl");
  // Exact byte fidelity, including the binary and empty entries.
  assert.deepEqual([...out[2].data], [...binary]);
  assert.equal(out[3].data.length, 0);
  assert.equal(dec.decode(out[0].data), '{"v":1}');
});

Deno.test("readZip rejects a non-ZIP blob", () => {
  assert.throws(
    () => readZip(enc.encode("not a zip file at all")),
    /no end-of-central-directory/,
  );
});

Deno.test("readZip parses an archive embedded inside a larger buffer", () => {
  // Guards the DataView offset math: the zip lives at a non-zero byteOffset.
  const zip = createZip([{ path: "x", data: enc.encode("y") }]);
  const padded = new Uint8Array(zip.length + 8);
  padded.set(zip, 8);
  const view = padded.subarray(8);
  const out = readZip(view);
  assert.equal(out.length, 1);
  assert.equal(dec.decode(out[0].data), "y");
});
