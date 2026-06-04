/// <reference lib="deno.ns" />
// Registers a DOM (happy-dom) on the global scope so React + Testing Library can
// render under `deno test`. Import this FIRST in any hook/component test, before
// React or @testing-library/react, so the globals exist when they initialise.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { document?: unknown }).document) {
  GlobalRegistrator.register();
}
