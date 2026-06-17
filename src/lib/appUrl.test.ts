/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { appRootUrl, resetUrlToAppRoot } from "./appUrl.ts";

Deno.test("appRootUrl returns __APP_BASE__ when set, else '/'", () => {
  assert.equal(appRootUrl("/granergize/"), "/granergize/");
  assert.equal(appRootUrl(undefined), "/");
});

Deno.test("resetUrlToAppRoot replaces the URL with the deploy root", () => {
  const calls: Array<{ url: string | URL | null | undefined }> = [];
  const history = {
    replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
      calls.push({ url });
    },
  };
  resetUrlToAppRoot(history, "/granergize/");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/granergize/");
});

Deno.test("resetUrlToAppRoot falls back to '/' at the bare root", () => {
  const calls: Array<string | URL | null | undefined> = [];
  const history = {
    replaceState: (_d: unknown, _u: string, url?: string | URL | null) => {
      calls.push(url);
    },
  };
  resetUrlToAppRoot(history, undefined);
  assert.deepEqual(calls, ["/"]);
});
