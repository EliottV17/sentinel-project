/**
 * Client-side mirror of the registered server checkers.
 *
 * Only one checker exists today (`http`); the create form posts
 * `check_config` verbatim from this constant and locks `check_type` to
 * `DEFAULT_CHECK_TYPE`. A future checker is a client-only addition here
 * (there is no checker-discovery endpoint).
 */
export const CHECKER_CONFIG_SCHEMA = {
  http: { expected_status: 200, timeout: 10, method: "GET" },
} as const;

export const DEFAULT_CHECK_TYPE = "http" as const;