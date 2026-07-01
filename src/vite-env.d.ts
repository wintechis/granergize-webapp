/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URI of the linked-wetterdienst wrapper (see linkedWeather.ts). */
  readonly VITE_WETTERDIENST_API_URI: string;
  /** Base URI of the linked-regionalstatistik wrapper (see regionalCube.ts). */
  readonly VITE_REGIONALSTATISTIK_API_URI?: string;
  /** Base URI of the linked-mastr wrapper (see mastrNearby.ts). */
  readonly VITE_MASTR_API_URI?: string;
  /** Base URI of the linked-energieatlas wrapper (see standortEnergieprofil.ts). */
  readonly VITE_ENERGIEATLAS_API_URI?: string;
  /** Base URI of the linked-lod2-by wrapper (see lod2Rooftop.ts). */
  readonly VITE_LOD2_API_URI?: string;
  /** App collection segment on the Pod; default "granergize". Tier-4 e2e sets
   * "granergize-e2e" so browser tests never touch real data (see solidUtils). */
  readonly VITE_POD_APP_DIR?: string;
  /** IRI of the Solid-OIDC Client Identifier Document (public/clientid.jsonld),
   * passed as `clientId` so the provider's consent screen shows the app name +
   * logo. Set only in .env.production; unset in dev → dynamic registration. */
  readonly VITE_OIDC_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short git commit hash of the build, injected by Vite `define` (see vite.config.ts).
 * "unknown" when built outside a git checkout. */
declare const __APP_COMMIT__: string;

/** The app root computed by the R-b inline `<head>` script (index.html) for
 * `BrowserRouter`'s `basename` and `<base href>`. Always ends in "/". Undefined
 * if the script didn't run (e.g. a non-browser render). Exposed both on `window`
 * and as a bare global so `globalThis.__APP_BASE__` typechecks. A top-level
 * `var` in this script-context d.ts becomes a `globalThis` property (a `const`
 * would not), which is what the `globalThis.__APP_BASE__` reads need. */
interface Window {
  __APP_BASE__?: string;
}
// eslint-disable-next-line no-var
declare var __APP_BASE__: string | undefined;
