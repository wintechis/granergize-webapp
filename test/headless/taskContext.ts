/// <reference lib="deno.ns" />
/**
 * Shared context + small harness for the Tier-2 headless task modules
 * (`test/headless/tasks/<slug>.ts`). Each task gets two ACTORS (A, B) — the same
 * A/B model the browser tier uses — plus a `check()` that tallies into one
 * pass/fail summary across all tasks. `snapshot`/`restore` (and diff-delete in the
 * tasks) keep each task self-cleaning so the local CSS is left as found.
 */
import type { Session } from "@inrupt/solid-client-authn-browser";
import type { LiveSessionLike } from "./liveSession.ts";

/** A headless actor: the app `Session` for data-layer calls + the raw handle for
 * direct fetches (snapshot/restore, ACL-enforcement truth checks). */
export interface Actor {
  slot: string;
  webId: string;
  session: Session;
  raw: LiveSessionLike;
}

export interface TaskContext {
  a: Actor;
  b: Actor;
  /** Charlie, the benchmark service provider — used by the benchmark round-trip. */
  c: Actor;
  check(label: string, cond: boolean, detail?: string): void;
}

export interface TaskModule {
  /** Catalog slug, e.g. "data-room". */
  name: string;
  run(ctx: TaskContext): Promise<void>;
}

export interface Harness {
  check(label: string, cond: boolean, detail?: string): void;
  passed: number;
  failed: number;
}

export function makeHarness(): Harness {
  const h: Harness = {
    passed: 0,
    failed: 0,
    check(label, cond, detail = "") {
      if (cond) {
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
        h.passed++;
      } else {
        console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
        h.failed++;
      }
    },
  };
  return h;
}

type Fetcher = Pick<LiveSessionLike, "fetch">;

export async function snapshot(s: Fetcher, url: string): Promise<string | null> {
  const r = await s.fetch(`${url}?t=${Date.now()}`).catch(() => null);
  return r && r.status === 200 ? await r.text() : null;
}

export async function restore(s: Fetcher, url: string, body: string | null) {
  if (body === null) {
    await s.fetch(url, { method: "DELETE" }).catch(() => {});
  } else {
    await s.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body,
    }).catch(() => {});
  }
}
