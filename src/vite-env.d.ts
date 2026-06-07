/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEATHER_API_URL: string;
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
