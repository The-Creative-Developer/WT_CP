/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when it differs from the SPA's (e.g. https://api.example.com). Leave unset in development. */
  readonly VITE_API_URL?: string;
}
