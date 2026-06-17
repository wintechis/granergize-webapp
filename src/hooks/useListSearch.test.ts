/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { useListSearch } from "./useListSearch.ts";

/** Render useListSearch alongside the raw params so a test can inspect the URL. */
function useProbe(key?: string) {
  const search = useListSearch(key);
  const [params] = useSearchParams();
  return { search, params };
}

const wrapperAt = (entry: string) =>
({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: [entry] }, children);

Deno.test("useListSearch: reads the query from the URL", () => {
  const { result } = renderHook(() => useProbe(), { wrapper: wrapperAt("/?q=hof") });
  assert.equal(result.current.search.query, "hof");
});

Deno.test("useListSearch: setQuery writes ?q and resets the paging offset", () => {
  const { result } = renderHook(() => useProbe(), {
    wrapper: wrapperAt("/?offset=40"),
  });
  act(() => result.current.search.setQuery("nürnberg"));
  assert.equal(result.current.search.query, "nürnberg");
  assert.equal(result.current.params.get("q"), "nürnberg");
  assert.equal(result.current.params.get("offset"), null, "offset cleared → page 1");
});

Deno.test("useListSearch: a blank query clears the param", () => {
  const { result } = renderHook(() => useProbe(), { wrapper: wrapperAt("/?q=hof") });
  act(() => result.current.search.setQuery("   "));
  assert.equal(result.current.search.query, "");
  assert.equal(result.current.params.get("q"), null);
});

Deno.test("useListSearch: key namespaces the params (multi-list page)", () => {
  const { result } = renderHook(() => useProbe("shared"), {
    wrapper: wrapperAt("/?shared_offset=20"),
  });
  act(() => result.current.search.setQuery("alice"));
  assert.equal(result.current.params.get("shared_q"), "alice");
  assert.equal(result.current.params.get("shared_offset"), null);
});
