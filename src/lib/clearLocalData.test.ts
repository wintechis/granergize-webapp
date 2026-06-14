/// <reference lib="deno.ns" />
import assert from "node:assert";
import { clearLocalData } from "./clearLocalData.ts";

/** Minimal Storage fake recording whether `clear()` ran. */
function fakeStorage() {
  const map = new Map<string, string>();
  let cleared = false;
  return {
    storage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => {
        cleared = true;
        map.clear();
      },
    },
    wasCleared: () => cleared,
    map,
  };
}

/** IndexedDB fake exposing `databases()` + recording deleted names. */
function fakeIndexedDb(
  names: (string | undefined)[],
  { request = "success" }: { request?: "success" | "error" | "blocked" } = {},
) {
  const deleted: string[] = [];
  const db = {
    databases: () => Promise.resolve(names.map((name) => ({ name }))),
    deleteDatabase: (name: string) => {
      deleted.push(name);
      const req: Record<string, (() => void) | null> = {
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      // Fire the matching callback on the next microtask, mirroring the real
      // event-based API the helper subscribes to.
      queueMicrotask(() => {
        const cb = req[`on${request}`];
        if (cb) cb();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  };
  return { db, deleted };
}

function install(
  localStore: ReturnType<typeof fakeStorage>,
  sessionStore: ReturnType<typeof fakeStorage>,
  idb: ReturnType<typeof fakeIndexedDb> | undefined,
) {
  Object.defineProperty(globalThis, "localStorage", {
    value: localStore.storage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: sessionStore.storage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "indexedDB", {
    value: idb?.db,
    configurable: true,
    writable: true,
  });
}

Deno.test("clears all three stores and deletes every named database", async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  const idb = fakeIndexedDb(["solid-client-authn", "app-cache"]);
  install(local, session, idb);

  await clearLocalData();

  assert.ok(local.wasCleared());
  assert.ok(session.wasCleared());
  assert.deepStrictEqual(idb.deleted, ["solid-client-authn", "app-cache"]);
});

Deno.test("skips databases without a name", async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  const idb = fakeIndexedDb(["named", undefined]);
  install(local, session, idb);

  await clearLocalData();

  assert.deepStrictEqual(idb.deleted, ["named"]);
});

Deno.test("resolves when a deletion is blocked rather than hanging", async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  const idb = fakeIndexedDb(["stuck"], { request: "blocked" });
  install(local, session, idb);

  // Would hang forever if the helper only listened for onsuccess.
  await clearLocalData();
  assert.deepStrictEqual(idb.deleted, ["stuck"]);
});

Deno.test("clears web storage even when IndexedDB is unavailable", async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  install(local, session, undefined);

  await clearLocalData();

  assert.ok(local.wasCleared());
  assert.ok(session.wasCleared());
});

Deno.test("a failing store does not stop the others", async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  const idb = fakeIndexedDb(["db"]);
  install(local, session, idb);
  // localStorage.clear() throws → session + IndexedDB must still run.
  local.storage.clear = () => {
    throw new Error("storage disabled");
  };

  await clearLocalData();

  assert.ok(session.wasCleared());
  assert.deepStrictEqual(idb.deleted, ["db"]);
});
