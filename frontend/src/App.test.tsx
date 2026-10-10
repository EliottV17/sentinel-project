import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routes } from "./App";
import { tokenStore } from "./app/api/token";

describe("application routes", () => {
  it("exposes registration without authentication", async () => {
    tokenStore.clear();
    const router = createMemoryRouter(routes, { initialEntries: ["/register"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Register for Sentinel" })).toBeInTheDocument();
  });
});
