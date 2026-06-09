/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import { act, renderHook } from "@testing-library/react";
import { usePaging } from "./usePaging.ts";

/** A list of N items: "item-0" … "item-(N-1)". */
const list = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);

Deno.test("usePaging: hundreds of items split into pages of the given size", () => {
  const items = list(300);
  const { result } = renderHook(() => usePaging(items, 20));

  assert.equal(result.current.total, 300);
  assert.equal(result.current.pageCount, 15);
  assert.equal(result.current.page, 1);
  assert.equal(result.current.pageItems.length, 20);
  assert.equal(result.current.pageItems[0], "item-0");
  assert.equal(result.current.pageItems[19], "item-19");
});

Deno.test("usePaging: navigates to a later page and slices correctly", () => {
  const items = list(300);
  const { result } = renderHook(() => usePaging(items, 20));

  act(() => result.current.setPage(15));
  assert.equal(result.current.page, 15);
  assert.equal(result.current.pageItems[0], "item-280");
  assert.equal(result.current.pageItems.at(-1), "item-299");
});

Deno.test("usePaging: clamps out-of-range page requests", () => {
  const items = list(300);
  const { result } = renderHook(() => usePaging(items, 20));

  act(() => result.current.setPage(999));
  assert.equal(result.current.page, 15); // clamped to last page

  act(() => result.current.setPage(0));
  assert.equal(result.current.page, 1); // clamped to first page
});

Deno.test("usePaging: a shrunk list never strands you on an empty page", () => {
  let items = list(300);
  const { result, rerender } = renderHook(() => usePaging(items, 20));

  act(() => result.current.setPage(15)); // last page of 300
  assert.equal(result.current.page, 15);

  items = list(25); // now only 2 pages
  rerender();
  assert.equal(result.current.pageCount, 2);
  assert.equal(result.current.page, 2); // clamped, not blank
  assert.equal(result.current.pageItems.length, 5); // items 20..24
});

Deno.test("usePaging: a short list is a single page (Pager will hide)", () => {
  const { result } = renderHook(() => usePaging(list(7), 20));
  assert.equal(result.current.pageCount, 1);
  assert.equal(result.current.pageItems.length, 7);
});

Deno.test("usePaging: empty list is one empty page", () => {
  const { result } = renderHook(() => usePaging([], 20));
  assert.equal(result.current.pageCount, 1);
  assert.equal(result.current.total, 0);
  assert.equal(result.current.pageItems.length, 0);
});
