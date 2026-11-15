/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when it differs from the SPA's (e.g. https://api.example.com). Leave unset in development. */
  readonly VITE_API_URL?: string;
  /** Comma-separated STUN server URLs for calls. Defaults to a public Google STUN server. */
  readonly VITE_STUN_URLS?: string;
}
