import { HttpHandler } from "msw";

// Default handlers: none. Each test file registers the routes it needs with
// `server.use(...)`; unhandled requests fail loudly via setup.ts.
export const handlers: HttpHandler[] = [];
