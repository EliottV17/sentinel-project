/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_USER_EMAIL?: string;
  readonly VITE_DEMO_USER_PASSWORD?: string;
  readonly VITE_STATUS_STALE_AFTER_MINUTES?: string;
  readonly VITE_STATUS_DEGRADED_THRESHOLD_PERCENT?: string;
}
