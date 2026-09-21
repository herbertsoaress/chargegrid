import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { useLiveData } from "@/components/dashboard/LiveDataProvider";

// Troca o app e o dashboard reais (Leaflet, graficos) por sondas leves que so leem o estado.
let mobile: ReturnType<typeof useLiveData>;
vi.mock("@/components/mobile/MobileApp", () => ({
  MobileApp: () => {
    mobile = useLiveData(); // sem provider acima, isto lanca erro
    return <div data-testid="mobile">app</div>;
  },
}));
vi.mock("@/components/dashboard/WebDashboard", () => ({
  WebDashboard: () => {
    const { activeSessions } = useLiveData();
    return <div data-testid="dashboard">{activeSessions.length} sessoes ativas</div>;
  },
}));

import Index from "@/pages/Index";

describe("tela principal (Index)", () => {
  it("app e dashboard usam o MESMO estado: uma recarga iniciada no app aparece no dashboard", () => {
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("dashboard").textContent).toBe("0 sessoes ativas");

    act(() =>
      mobile.startSession("CG-002", {
        userName: "João S.",
        vehicle: "BYD Dolphin",
        targetPct: 80,
        departureTime: "18:30",
        priority: "rapido",
      }),
    );

    expect(screen.getByTestId("dashboard").textContent).toBe("1 sessoes ativas");
  });

  it("o toggle Ambos / App / Dashboard mostra e esconde cada interface", () => {
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mobile")).toBeTruthy();
    expect(screen.getByTestId("dashboard")).toBeTruthy();

    act(() => screen.getByRole("button", { name: "Dashboard" }).click());
    expect(screen.queryByTestId("mobile")).toBeNull();
    expect(screen.getByTestId("dashboard")).toBeTruthy();

    act(() => screen.getByRole("button", { name: "App" }).click());
    expect(screen.getByTestId("mobile")).toBeTruthy();
    expect(screen.queryByTestId("dashboard")).toBeNull();
  });
});
