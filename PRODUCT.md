# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Solo developers, DevOps engineers, and operators running independent web services who need straightforward, transparent HTTP/HTTPS monitoring without commercial SaaS bloat or lock-in.
- Senior technical evaluators, architects, and engineering leads inspecting a real-world system to assess distributed patterns, decoupled concurrency models, and operational discipline.

## Product Purpose

- Provide reliable, decoupled HTTP/HTTPS uptime monitoring, persistent check history, and a lightweight public status page.
- Act as an uncompromised full-stack engineering showcase demonstrating clean systems architecture: an independent Go polling engine with SSRF hardening, a NestJS REST API, and a shared PostgreSQL schema without unnecessary message broker complexity.

## Positioning

- High-transparency, self-hostable uptime monitoring where polling is decoupled from HTTP request handling.
- Unlike opaque SaaS monitors or bloated enterprise suites, Sentinel runs cleanly within a lightweight Docker Compose footprint while enforcing strict architectural boundaries (dedicated Go poller, IP pinning against SSRF/DNS rebinding, transition-only alerts, and SQL-backed rolling uptime windows).

## Operating Context

- Deployed via Docker Compose on small virtual machines (e.g. AWS EC2 t3.small with Elastic IP and Caddy reverse proxy managing automated TLS).
- Evaluated and used primarily on desktop and laptop displays during operational monitoring, maintenance, or incident response.
- Explored live via a 1-click shared interactive demo (`demo@example.invalid`, 15-minute token, 60-minute automated database reset) and an anonymous public status page (`/status`).

## Capabilities and Constraints

### Capabilities
- HTTP and HTTPS endpoint monitoring with configurable polling frequencies (minimum 60s).
- Hardened Go worker polling engine with bounded concurrency (10 concurrent checks), custom timeouts, redirect revalidation, and socket-level IP pinning to prevent SSRF and DNS rebinding.
- Persistent check execution logs (`check_result` with status code, response time in ms, and error message) and state transition alerts (`alert` records created only on `healthy <-> unhealthy` transitions).
- Rolling-window public status page (`/status`) reporting healthy check ratios and sample coverage over a configured window (default 24h) without exposing target URLs or internal IDs.
- Demo sandbox mode with automated hourly cleanup and quota caps (3 monitors max vs 10 for standard users).

### Constraints
- Alerts are persisted database events only; no outbound email, SMS, or webhook notifications are dispatched.
- The Go worker is the sole polling engine; if the worker process stops, checks cease (the API never checks on the worker's behalf).
- Worker relies on bounded single-instance tick dispatch; it does not yet use distributed locks (`SKIP LOCKED`) across multiple poller replicas.

## Brand Commitments

- **Name:** Sentinel
- **Visual Voice:** Utilitarian, precise, dark-mode focused, technical, and calm under incident pressure. Zero marketing jargon or synthetic fluff.
- **Tone & Terminology:** Honest and grounded in systems reality. Uses exact networking concepts (HTTP status codes, latency in ms, IP pinning, state transitions, sample coverage).

## Evidence on Hand

- **Live Production Service:** `https://sentinel.eliottvelarde.com`
- **Public Status Page:** `https://sentinel.eliottvelarde.com/status`
- **Empirical Benchmarks:** `docs/load-test.md` documenting worker capacity, memory characteristics, and measurement boundaries.
- **Architectural Records:** `interview-notes/` documenting every architectural decision, operational trade-off, and implementation rationale.
- **Automated Test Coverage:** Jest unit/e2e suites in API, Go loop and race tests in worker, Vitest in frontend.

## Product Principles

- **Operational Transparency:** Display exact status codes, response times, and sampling windows; never mask network realities behind synthetic scores or vague status icons.
- **Architectural Honesty:** Reflect real backend state faithfully. Never simulate capabilities (like external push alerts or guaranteed SLAs) that the system does not enforce.
- **Immediate Operator Clarity:** An operator arriving during an incident must assess target health, error messages, and latency trends within three seconds of opening the dashboard.
- **Containment & Resilience:** Prevent cascading failures; all poller checks are bounded, SSRF-filtered, and decoupled from API availability.

## Accessibility & Inclusion

- WCAG 2.2 AA compliant operator interface with high-contrast status tokens (healthy, down, degraded, pending).
- All status states convey meaning through explicit text labels and structured icons, never color alone.
- Full keyboard navigation and visible focus rings across monitor tables, action dialogs, and creation flows.
