import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("shows an active check result", () => {
    render(<StatusPill state="Active" lastState="unhealthy" />);
    expect(screen.getByText("Unhealthy")).toBeInTheDocument();
  });

  it("shows persisted paused state instead of presenting its old result as current", () => {
    render(<StatusPill state="Paused" lastState="unhealthy" />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText("Unhealthy")).not.toBeInTheDocument();
  });

  it.each([["healthy", "Healthy"], ["unhealthy", "Unhealthy"]] as const)("keeps paused %s result administrative", (result, label) => {
    render(<StatusPill state="Paused" lastState={result} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it("keeps a paused monitor with no result distinct", () => {
    render(<StatusPill state="Paused" lastState={null} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("keeps active healthy state distinct", () => {
    render(<StatusPill state="Active" lastState="healthy" />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("keeps an active never-checked monitor distinct", () => {
    render(<StatusPill state="Active" lastState={null} />);
    expect(screen.getByText("Never checked")).toBeInTheDocument();
  });
});
