/// <reference lib="deno.ns" />
import assert from "node:assert";

/**
 * The dev-mode store reads `localStorage` once at module load, so each test
 * seeds a fresh fake storage on `globalThis` and dynamically imports a fresh
 * copy of the module (cache-busted via a query string) to re-run that init.
 */
function installStorage(seed?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return { map, storage };
}

Deno.test("reads the persisted flag at load (default off)", async () => {
  installStorage();
  const mod = await import("./devMode.ts?case=default");
  assert.strictEqual(mod.getDevMode(), false);
});

Deno.test("reads the persisted flag at load (on)", async () => {
  installStorage({ "granergize.devMode": "1" });
  const mod = await import("./devMode.ts?case=seeded-on");
  assert.strictEqual(mod.getDevMode(), true);
});

Deno.test("setDevMode persists and notifies subscribers", async () => {
  const { map } = installStorage();
  const mod = await import("./devMode.ts?case=set");

  let notified = 0;
  const unsub = mod.subscribeDevMode(() => {
    notified++;
  });

  mod.setDevMode(true);
  assert.strictEqual(mod.getDevMode(), true);
  assert.strictEqual(map.get("granergize.devMode"), "1");
  assert.strictEqual(notified, 1);

  // A no-op write neither persists a change nor notifies again.
  mod.setDevMode(true);
  assert.strictEqual(notified, 1);

  mod.setDevMode(false);
  assert.strictEqual(mod.getDevMode(), false);
  assert.strictEqual(map.get("granergize.devMode"), "0");
  assert.strictEqual(notified, 2);

  // After unsubscribing, further changes don't reach the listener.
  unsub();
  mod.setDevMode(true);
  assert.strictEqual(notified, 2);
});

Deno.test("tolerates localStorage being unavailable", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    get() {
      throw new Error("storage disabled");
    },
    configurable: true,
  });
  const mod = await import("./devMode.ts?case=no-storage");
  // Initial read swallows the throw → defaults off; setting keeps the in-memory
  // value without throwing even though persistence fails.
  assert.strictEqual(mod.getDevMode(), false);
  mod.setDevMode(true);
  assert.strictEqual(mod.getDevMode(), true);
});
