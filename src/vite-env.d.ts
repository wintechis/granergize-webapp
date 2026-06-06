/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEATHER_API_URL: string;
  /** App collection segment on the Pod; default "granergize". Tier-4 e2e sets
   * "granergize-e2e" so browser tests never touch real data (see solidUtils). */
  readonly VITE_POD_APP_DIR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
