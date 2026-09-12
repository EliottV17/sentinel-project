import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { useMonitors } from "./useMonitors";
import { CreateMonitorForm } from "./CreateMonitorForm";
import { server } from "../../test/mocks/server";
import type { components } from "../../lib/api/schema";

type MonitorRead = components["schemas"]["MonitorRead"];

function monitor(overrides: Partial<MonitorRead> = {}): MonitorRead {
  return {
    name: "api",
    target: "https://api.example.com",
    check_type: "http",
    check_config: { expected_status: 200, timeout: 10, method: "GET" },
    frequency: 60,
    id: 1,
    state: "Active",
    last_state: "healthy",
    last_checked_at: "2025-01-15T10:00:00",
    consecutive_failures: 0,
    created_at: "2025-01-15T09:00:00",
    user_id: 1,
    ...overrides,
  };
}

let getMonitorsCalls = 0;
let postBodies: unknown[] = [];
let postStatus = 201;
let postDetail: unknown = null;
let listAfterCreate: MonitorRead[] = [];

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 4_000),
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
      },
    },
  });
}

function Harness() {
  const query = useMonitors();
  return (
    <div>
      <ul>
        {(query.data ?? []).map((m) => (
          <li key={m.id}>{m.name}</li>
        ))}
      </ul>
      <CreateMonitorForm />
    </div>
  );
}

function renderHarness() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
}

function fillAndSubmit(values: { name?: string; target?: string; frequency?: string }): void {
  if (values.name !== undefined) {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: values.name } });
  }
  if (values.target !== undefined) {
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: values.target } });
  }
  if (values.frequency !== undefined) {
    fireEvent.change(screen.getByLabelText("Frequency (seconds)"), {
      target: { value: values.frequency },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /create monitor/i }));
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  getMonitorsCalls = 0;
  postBodies = [];
  postStatus = 201;
  postDetail = null;
  listAfterCreate = [];
  server.use(
    http.get("*/api/v1/monitors/", () => {
      getMonitorsCalls++;
      if (listAfterCreate.length > 0) {
        return HttpResponse.json(listAfterCreate);
      }
      return HttpResponse.json([monitor()]);
    }),
    http.post("*/api/v1/monitors/", async ({ request }) => {
      postBodies.push(await request.json());
      if (postStatus !== 201) {
        return HttpResponse.json({ detail: postDetail }, { status: postStatus });
      }
      const created = monitor({
        id: 2,
        name: "second",
        target: "https://second.example.com",
      });
      listAfterCreate = [monitor(), created];
      return HttpResponse.json(created, { status: 201 });
    }),
  );
});

describe("CreateMonitorForm", () => {
  it("defaults frequency to 60", () => {
    renderHarness();
    expect(screen.getByLabelText("Frequency (seconds)")).toHaveValue(60);
  });

  it("rejects an empty name without posting", async () => {
    renderHarness();
    fillAndSubmit({ name: "", target: "https://ok.example.com" });
    await settle();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(postBodies).toHaveLength(0);
  });

  it("rejects a non-URL target without posting", async () => {
    renderHarness();
    fillAndSubmit({ name: "x", target: "not-a-url" });
    await settle();
    expect(screen.getByText("Target must be a valid URL")).toBeInTheDocument();
    expect(postBodies).toHaveLength(0);
  });

  it("rejects frequency below 10 without posting", async () => {
    renderHarness();
    fillAndSubmit({ name: "x", target: "https://ok.example.com", frequency: "5" });
    await settle();
    expect(screen.getByText("Frequency must be at least 10 seconds")).toBeInTheDocument();
    expect(postBodies).toHaveLength(0);
  });

  it("posts the locked http check and refetches the list immediately", async () => {
    renderHarness();
    await settle();
    const getCallsAfterMount = getMonitorsCalls;

    fillAndSubmit({ name: "second", target: "https://second.example.com" });
    const row = await screen.findByText("second", {}, { timeout: 3000 });
    expect(row).toBeInTheDocument();

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({
      name: "second",
      target: "https://second.example.com",
      frequency: 60,
      check_type: "http",
      check_config: { expected_status: 200, timeout: 10, method: "GET" },
    });
    // ['monitors'] was invalidated → an immediate refetch happened.
    expect(getMonitorsCalls).toBe(getCallsAfterMount + 1);
  });

  it("maps a 400 [{loc,msg}] detail list onto the offending field", async () => {
    postStatus = 400;
    postDetail = [
      { loc: ["body", "frequency"], msg: "value must be greater than or equal to 10" },
    ];
    renderHarness();
    fillAndSubmit({ name: "x", target: "https://ok.example.com" });
    await settle();
    expect(
      await screen.findByText("value must be greater than or equal to 10"),
    ).toBeInTheDocument();
  });

  it("maps a string detail to a form-level message", async () => {
    postStatus = 400;
    postDetail = "Target already exists";
    renderHarness();
    fillAndSubmit({ name: "x", target: "https://ok.example.com" });
    await settle();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Target already exists",
    );
  });
});