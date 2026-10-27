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
  it("names the monitor in confirmation and only deletes after the second action", async () => {
    const name = "Production payments API monitor";
    renderHarness([monitor({ name })]);
    await settle();

    const trigger = screen.getByRole("button", { name: `Delete ${name}` });
    expect(trigger).toHaveClass("text-danger", "hover:bg-surface", "min-h-11");
    // The row already identifies the monitor. Keep its full name for assistive
    // technology and confirmation without repeating it on a narrow action.
    expect(trigger.textContent).toBe("Delete");
    fireEvent.click(trigger);
    expect(screen.getByText(`Delete monitor ${name}?`)).toBeInTheDocument();
    expect(deleteCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: `Confirm delete ${name}` }));
    await waitFor(() => expect(deleteCalls).toBe(1));
  });

  it("moves focus to safe cancel when opened and restores the trigger on cancel", async () => {
    renderHarness([monitor()]);
    await settle();
    const trigger = screen.getByRole("button", { name: "Delete api" });
    trigger.focus();

    fireEvent.click(trigger);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.click(cancel);
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and restores focus without deleting", async () => {
    renderHarness([monitor()]);
    await settle();
    const trigger = screen.getByRole("button", { name: "Delete api" });
    trigger.focus();

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText("Delete monitor api?")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(deleteCalls).toBe(0);
  });

  it("prevents duplicate confirmation while pending and ignores Escape until settlement", async () => {
    renderHarness([monitor()]);
    await settle();
    server.use(
      http.delete("*/api/v1/monitors/1", async () => {
        deleteCalls++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json({ detail: "deleted" });
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete api" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete api" }));
    const confirm = screen.getByRole("button", { name: "Confirm delete api" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(screen.getByText("Delete monitor api?")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText("Delete monitor api?")).not.toBeInTheDocument());
  });

  it("keeps an error confirmation usable and permits retry", async () => {
    deleteStatus = 500;
    renderHarness([monitor()]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Delete api" }));
    const confirm = screen.getByRole("button", { name: "Confirm delete api" });
    confirm.focus();
    fireEvent.click(confirm);
    expect(await screen.findByText("Could not delete the monitor — try again")).toBeInTheDocument();
    expect(confirm).toHaveFocus();
    expect(screen.getByText("Delete monitor api?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete api" })).toBeEnabled();

    deleteStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete api" }));
    await waitFor(() => expect(deleteCalls).toBe(2));
  });

  it("cancels without deleting", async () => {
    renderHarness([monitor()]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText("Delete monitor api?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete monitor api?")).not.toBeInTheDocument();
    expect(deleteCalls).toBe(0);
  });

  it("never uses a native confirm dialog", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderHarness([monitor()]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete api" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("removes the row via invalidation after a successful delete", async () => {
    renderHarness([monitor()]);
    await settle();
    expect(screen.getByTestId("row-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete api" }));

    await waitFor(() =>
      expect(screen.queryByTestId("row-1")).not.toBeInTheDocument(),
    );
  });

  it("shows 'not found — refreshing' on a 404 and still invalidates", async () => {
    deleteStatus = 404;
    renderHarness([monitor()]);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete api" }));

    expect(
      await screen.findByText(/Monitor not found — refreshing list/i),
    ).toBeInTheDocument();
    expect(deleteCalls).toBe(1);
  });
});