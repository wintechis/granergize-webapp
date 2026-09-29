/// <reference lib="deno.ns" />
import assert from "node:assert";
import { resolvePodDataDir } from "./podData.ts";

Deno.test("resolvePodDataDir: unset or blank → throwaway (undefined)", () => {
  assert.equal(resolvePodDataDir({}), undefined);
  assert.equal(resolvePodDataDir({ LOCAL_POD_DATA: "" }), undefined);
  assert.equal(resolvePodDataDir({ LOCAL_POD_DATA: "   " }), undefined);
});

Deno.test("resolvePodDataDir: a set dir is used, trimmed", () => {
  assert.equal(resolvePodDataDir({ LOCAL_POD_DATA: " ./.local-pod " }), "./.local-pod");
});

Deno.test("resolvePodDataDir: the browser lane (E2E_LOCAL=1) never persists", () => {
  assert.equal(
    resolvePodDataDir({ LOCAL_POD_DATA: "./.local-pod", E2E_LOCAL: "1" }),
    undefined,
  );
  // Only the exact opt-in value guards; anything else leaves the dir in force.
  assert.equal(
    resolvePodDataDir({ LOCAL_POD_DATA: "./.local-pod", E2E_LOCAL: "" }),
    "./.local-pod",
  );
});
