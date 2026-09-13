# API CORS Specification

## Purpose

Allow the browser SPA (served from a different origin in production) to call the
sentinel REST API by adding CORS support to sentinel-api. This is the ONLY backend
change in the `web-frontend` change: no routers, services, schemas, migrations, or
worker code are touched. Origins are explicit and env-configured; the safe default
grants no cross-origin access.

## Requirements

### Requirement: Configurable allowed origins

The system MUST expose a `CORS_ORIGINS` setting in `app/core/config.py` holding a
comma-separated list of allowed origins, with an empty string as the default. The
system MUST NOT ship with any pre-configured allowed origin.

#### Scenario: Empty default

- GIVEN no `CORS_ORIGINS` value in the environment
- WHEN the application starts
- THEN the configured origins list is empty
- AND no cross-origin browser request is permitted

#### Scenario: Comma-separated parsing

- GIVEN `CORS_ORIGINS=https://ui.example.com, http://localhost:5173`
- WHEN the origins list is computed
- THEN both origins are allowed, surrounding whitespace is stripped, and empty
  entries are ignored

### Requirement: CORS middleware on the API app

The system MUST register `CORSMiddleware` on the FastAPI application in
`app/main.py` with `allow_origins` taken from the configured origins list,
`allow_credentials=True`, and permissive methods and headers. Because credentials
are allowed, the middleware MUST NOT be configured with a wildcard (`*`) origin.

#### Scenario: Configured origin receives CORS header

- GIVEN `CORS_ORIGINS` contains `https://ui.example.com`
- WHEN a browser preflight (`OPTIONS`) or actual request arrives with
  `Origin: https://ui.example.com`
- THEN the response includes `Access-Control-Allow-Origin: https://ui.example.com`
- AND `Access-Control-Allow-Credentials` permits credentialed requests

#### Scenario: Unconfigured origin is rejected

- GIVEN `CORS_ORIGINS=https://ui.example.com`
- WHEN a request arrives with `Origin: https://evil.example.com`
- THEN the response does not include `Access-Control-Allow-Origin` for that origin

#### Scenario: Preflight is handled by middleware

- GIVEN a configured origin
- WHEN the browser sends an `OPTIONS` preflight for an authenticated endpoint
- THEN the middleware answers the preflight without requiring an Authorization
  header and advertises the allowed methods and headers

### Requirement: Regression-tested CORS behavior (strict TDD)

The CORS behavior MUST be covered by an API-level test written RED first
(ASGITransport + AsyncClient) that asserts `Access-Control-Allow-Origin` is present
for a configured origin. The test suite MUST keep asserting that an empty
`CORS_ORIGINS` blocks cross-origin responses.

#### Scenario: RED-first test asserts the header

- GIVEN the test suite runs before the middleware exists
- WHEN the CORS test asserts `Access-Control-Allow-Origin` for a configured origin
- THEN the assertion fails (RED) and passes only after the middleware is added

#### Scenario: Suite stays green and additive

- WHEN the full backend suite runs (`pytest`, ruff, pyright)
- THEN all existing tests still pass and the only production change is the CORS
  setting and middleware registration

### Requirement: Operational documentation

The system MUST document `CORS_ORIGINS` in `sentinel-api/.env.example` so operators
can enable the SPA origin in production. Setting `CORS_ORIGINS=""` MUST be a valid
way to disable cross-origin access at any time.

#### Scenario: Operator enables the SPA origin

- GIVEN `.env.example` documents `CORS_ORIGINS`
- WHEN an operator sets their SPA origin and restarts the API
- THEN the SPA origin can make credentialed cross-origin requests