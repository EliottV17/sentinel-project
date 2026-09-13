import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/mocks/server";
import type { components } from "../../lib/api/schema";
import { useMonitors } from "./useMonitors";
import { DeleteButton } from "./DeleteButton";

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

let deleteStatus = 200;
let deleteCalls = 0;
let listAfterDelete: MonitorRead[] = [monitor()];

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

function Harness({ monitors }: { monitors: MonitorRead[] }) {
  const query = useMonitors();
  const rows = query.data ?? monitors;
  return (
    <ul>
      {rows.map((m) => (
        <li key={m.id} data-testid={`row-${m.id}`}>
          {m.name}
          <DeleteButton monitorId={m.id} monitorName={m.name} />
        </li>
      ))}
    </ul>
  );
}

function renderHarness(monitors: MonitorRead[] = [monitor()]): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <Harness monitors={monitors} />
    </QueryClientProvider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  deleteStatus = 200;
  deleteCalls = 0;
  listAfterDelete = [monitor()];
  server.use(
    http.get("*/api/v1/monitors/", () => HttpResponse.json(listAfterDelete)),
    http.delete("*/api/v1/monitors/1", () => {
      deleteCalls++;
      if (deleteStatus !== 200) {
        return HttpResponse.json(
          { detail: "Monitor not found" },
          { status: deleteStatus },
        );
      }
      listAfterDelete = [];
      return HttpResponse.json({ detail: "deleted" });
    }),
  );
});

describe("DeleteButton", () => {
  it("asks for confirmation on the first click and only deletes on the second", async () => {
    renderHarness([monitor()]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText("Confirm delete?")).toBeInTheDocument();
    expect(deleteCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteCalls).toBe(1));
  });

  it("cancels without deleting", async () => {
    renderHarness([monitor()]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText("Confirm delete?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Confirm delete?")).not.toBeInTheDocument();
    expect(deleteCalls).toBe(0);
  });

  it("never uses a native confirm dialog", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderHarness([monitor()]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("removes the row via invalidation after a successful delete", async () => {
    renderHarness([monitor()]);
    await settle();
    expect(screen.getByTestId("row-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(screen.queryByTestId("row-1")).not.toBeInTheDocument(),
    );
  });

  it("shows 'not found — refreshing' on a 404 and still invalidates", async () => {
    deleteStatus = 404;
    renderHarness([monitor()]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText(/Monitor not found — refreshing list/i),
    ).toBeInTheDocument();
    expect(deleteCalls).toBe(1);
  });
});