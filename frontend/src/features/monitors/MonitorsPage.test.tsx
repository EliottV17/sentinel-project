import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/mocks/server";
import type { components } from "../../lib/api/schema";
import { MonitorsPage } from "./MonitorsPage";

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

let failing = false;
let monitorsResponse: MonitorRead[] = [monitor()];

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

function renderPage(): void {
  render(
    <MemoryRouter>
      <QueryClientProvider client={makeQueryClient()}>
        <MonitorsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  failing = false;
  monitorsResponse = [monitor()];
  vi.useFakeTimers();
  server.use(
    http.get("*/api/v1/monitors/", () => {
      if (failing) {
        return HttpResponse.json({ detail: "engine unreachable" }, { status: 500 });
      }
      return HttpResponse.json(monitorsResponse);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MonitorsPage", () => {
  it("starts with an Add monitor disclosure closed above the full-width monitor list", async () => {
    renderPage();
    await settle();

    const add = screen.getByRole("button", { name: "Add monitor" });
    expect(screen.getByRole("heading", { level: 1, name: "Monitors" })).toBeInTheDocument();
    expect(add).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.queryByText(/Live overview|Your systems,|Monitor overview|Your watchpoints/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers Add monitor from the empty state without opening the form automatically", async () => {
    monitorsResponse = [];
    renderPage();
    await settle();

    expect(screen.getByText("No monitors yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: "Add monitor" });
    expect(addButtons).toHaveLength(2);
    fireEvent.click(addButtons[1]);
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("shows active health partitions and keeps paused monitors separate", async () => {
    monitorsResponse = [
      monitor({ id: 1, last_state: "healthy" }),
      monitor({ id: 2, last_state: "unhealthy", consecutive_failures: 2 }),
      monitor({ id: 3, last_state: null, last_checked_at: null }),
      monitor({ id: 4, state: "Paused", last_state: "unhealthy", consecutive_failures: 3 }),
    ];
    renderPage();
    await settle();

    expect(screen.getByRole("group", { name: "Monitor counts" })).toHaveTextContent("Total 4");
    expect(screen.getByRole("group", { name: "Monitor counts" })).toHaveTextContent("Healthy 1");
    expect(screen.getByRole("group", { name: "Monitor counts" })).toHaveTextContent("Unhealthy 1");
    expect(screen.getByRole("group", { name: "Monitor counts" })).toHaveTextContent("Pending 1");
    expect(screen.getByText("Paused 1")).toBeInTheDocument();
    const pausedRow = screen.getByText("Paused").closest("li")!;
    expect(within(pausedRow).queryByText(/engine may be down/i)).not.toBeInTheDocument();
    expect(screen.getByText("Last result: Unhealthy")).toBeInTheDocument();
  });

  it("opens inline, focuses Name, and Cancel or Escape restores Add monitor focus", async () => {
    renderPage();
    await settle();
    const add = screen.getByRole("button", { name: "Add monitor" });
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(add).toHaveFocus();
    fireEvent.click(add);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(add).toHaveFocus();
  });

  it("keeps last known data and shows the stale/offline banner in the error state", async () => {
    renderPage();
    await settle();
    expect(screen.getByText("api")).toBeInTheDocument();

    failing = true;
    await advance(25_000); // poll failure + retries land within this window

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The list is never blanked on failure.
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("api").closest("li")).not.toBeNull();
  });

  it("closes and restores focus after successful creation", async () => {
    server.use(http.post("*/api/v1/monitors/", () => HttpResponse.json(monitor({ id: 2, name: "new monitor" }), { status: 201 })));
    renderPage();
    await settle();
    const add = screen.getByRole("button", { name: "Add monitor" });
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "new monitor" } });
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "https://new.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create monitor/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20); await Promise.resolve(); });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });

  it("keeps the form and entered fields open after server failure", async () => {
    server.use(http.post("*/api/v1/monitors/", () => HttpResponse.json({ detail: "Target already exists" }, { status: 400 })));
    renderPage();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add monitor" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "duplicate" } });
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "https://api.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create monitor/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20); await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("Target already exists");
    expect(screen.getByLabelText("Name")).toHaveValue("duplicate");
    expect(screen.getByLabelText("Target")).toHaveValue("https://api.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add monitor" })).toHaveFocus();
  });

  it("keeps the form mounted when the header Add monitor is clicked during creation", async () => {
    let release!: () => void;
    let postCount = 0;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("*/api/v1/monitors/", async () => {
      postCount++;
      await pending;
      return HttpResponse.json(monitor({ id: 2, name: "pending" }), { status: 201 });
    }));
    renderPage();
    await settle();
    const add = screen.getByRole("button", { name: "Add monitor" });
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "https://pending.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create monitor/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve(); });
    expect(postCount).toBe(1);
    expect(add).toBeDisabled();
    fireEvent.click(add);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByLabelText("Name")).toHaveValue("pending");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(postCount).toBe(1);
    await act(async () => release());
    await act(async () => { await vi.advanceTimersByTimeAsync(20); await Promise.resolve(); });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });

  it("keeps empty-state creation open when its Add monitor button is clicked while pending", async () => {
    monitorsResponse = [];
    let release!: () => void;
    let postCount = 0;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("*/api/v1/monitors/", async () => {
      postCount++;
      await pending;
      return HttpResponse.json(monitor({ id: 2, name: "empty pending" }), { status: 201 });
    }));
    renderPage();
    await settle();
    const [headerAdd, emptyAdd] = screen.getAllByRole("button", { name: "Add monitor" });
    fireEvent.click(emptyAdd);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "empty pending" } });
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "https://empty.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /create monitor/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve(); });
    expect(postCount).toBe(1);
    expect(emptyAdd).toBeDisabled();
    fireEvent.click(emptyAdd);
    expect(screen.getByLabelText("Name")).toHaveValue("empty pending");
    expect(postCount).toBe(1);
    await act(async () => release());
    await act(async () => { await vi.advanceTimersByTimeAsync(20); await Promise.resolve(); });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(headerAdd).toHaveFocus();
  });

  it("renders a delete control per row", async () => {
    renderPage();
    await settle();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows clear error alert when API returns 429 or 400", async () => {
    server.use(
      http.get("*/api/v1/monitors/", () => {
        return HttpResponse.json(
          { statusCode: 429, message: "ThrottlerException: Too Many Requests" },
          { status: 429 },
        );
      }),
    );

    renderPage();
    await settle();
    await advance(15_000);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});