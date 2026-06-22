/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { useListFacet } from "./useListFacet.ts";

const TIERS = ["mine", "shared"] as const;

function useProbe(key?: string) {
  const facet = useListFacet("tiers", TIERS, key);
  const [params] = useSearchParams();
  return { facet, params };
}

const wrapperAt = (entry: string) =>
({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: [entry] }, children);

Deno.test("useListFacet: absent param → all selected (default)", () => {
  const { result } = renderHook(() => useProbe(), { wrapper: wrapperAt("/") });
  assert.deepEqual(result.current.facet.selected, ["mine", "shared"]);
  assert.equal(result.current.facet.isSelected("mine"), true);
});

Deno.test("useListFacet: reads a stated subset from the URL", () => {
  const { result } = renderHook(() => useProbe(), {
    wrapper: wrapperAt("/?tiers=shared"),
  });
  assert.deepEqual(result.current.facet.selected, ["shared"]);
  assert.equal(result.current.facet.isSelected("mine"), false);
});

Deno.test("useListFacet: replace to a subset writes ?tiers and resets offset", () => {
  const { result } = renderHook(() => useProbe(), {
    wrapper: wrapperAt("/?offset=40"),
  });
  act(() => result.current.facet.replace(["mine"]));
  assert.deepEqual(result.current.facet.selected, ["mine"]);
  assert.equal(result.current.params.get("tiers"), "mine");
  assert.equal(result.current.params.get("offset"), null, "offset cleared → page 1");
});

Deno.test("useListFacet: replace to ALL clears the param (clean default URL)", () => {
  const { result } = renderHook(() => useProbe(), {
    wrapper: wrapperAt("/?tiers=mine"),
  });
  act(() => result.current.facet.replace(["mine", "shared"]));
  assert.equal(result.current.params.get("tiers"), null);
  assert.deepEqual(result.current.facet.selected, ["mine", "shared"]);
});

Deno.test("useListFacet: empty replace is ignored (last value can't be unticked)", () => {
  const { result } = renderHook(() => useProbe(), {
    wrapper: wrapperAt("/?tiers=mine"),
  });
  act(() => result.current.facet.replace([]));
  assert.deepEqual(result.current.facet.selected, ["mine"]); // unchanged
  assert.equal(result.current.params.get("tiers"), "mine");
});

Deno.test("useListFacet: junk values are dropped, key namespaces the param", () => {
  const { result } = renderHook(() => useProbe("l"), {
    wrapper: wrapperAt("/?l_tiers=bogus,shared"),
  });
  assert.deepEqual(result.current.facet.selected, ["shared"]);
  act(() => result.current.facet.replace(["mine"]));
  assert.equal(result.current.params.get("l_tiers"), "mine");
});

// `open` is opt-in: a facet that offers it must NOT select it by default.
const OPEN_TIERS = ["mine", "shared", "open"] as const;
function useOpenProbe() {
  const facet = useListFacet("tiers", OPEN_TIERS);
  const [params] = useSearchParams();
  return { facet, params };
}

Deno.test("useListFacet: `open` is opt-in — absent param defaults to mine+shared only", () => {
  const { result } = renderHook(() => useOpenProbe(), { wrapper: wrapperAt("/") });
  assert.deepEqual(result.current.facet.selected, ["mine", "shared"]);
  assert.equal(result.current.facet.isSelected("open"), false);
});

Deno.test("useListFacet: ticking ALL (incl. open) writes ?tiers so it persists (not the default)", () => {
  const { result } = renderHook(() => useOpenProbe(), { wrapper: wrapperAt("/") });
  act(() => result.current.facet.replace(["mine", "shared", "open"]));
  assert.equal(result.current.params.get("tiers"), "mine,shared,open");
  assert.equal(result.current.facet.isSelected("open"), true);
});

Deno.test("useListFacet: replace to the default (mine+shared) clears ?tiers", () => {
  const { result } = renderHook(() => useOpenProbe(), {
    wrapper: wrapperAt("/?tiers=mine,shared,open"),
  });
  act(() => result.current.facet.replace(["mine", "shared"]));
  assert.equal(result.current.params.get("tiers"), null, "the default → clean URL");
  assert.equal(result.current.facet.isSelected("open"), false);
});
