import { describe, expect, it } from "vitest";
import { apiSessionToCompleted, describeEvent, formatBrl, fromApiMode, parseUtc, toApiMode } from "@/lib/backend/mappers";
import type { ApiSession } from "@/lib/backend/types";

const baseSession: ApiSession = {
  id: 7,
  charger_id: 2,
  charger_code: "CG-002",
  charger_name: "FIAP #2",
  mode: "economico",
  vehicle_label: "BYD Dolphin",
  target_pct: 80,
  departure_time: "18:30",
  status: "finalizada_cabo_liberado",
  started_at: "2026-09-18T17:00:00Z",
  ended_at: "2026-09-18T17:42:30Z",
  energy_kwh: 12.5,
  current_power_kw: 0,
  current_pct: 60,
  price_per_kwh_snapshot: 2.1,
  amount_due: 26.25,
  amount_estimate: 26.25,
  energy_amount: 26.25,
  time_amount: 0,
  idle_amount: 0,
  minutes_charging: 0,
  minutes_idle: 0,
  price_capped: false,
  power_released: true,
  lock_released: true,
};

describe("modos de recarga (app <-> API)", () => {
  it("traduz 'eco' do app para 'economico' da API e de volta", () => {
    expect(toApiMode("eco")).toBe("economico");
    expect(fromApiMode("economico")).toBe("eco");
  });

  it("mantem os modos que tem o mesmo nome, inclusive 'garantido'", () => {
    for (const mode of ["rapido", "sustentavel", "garantido"] as const) {
      expect(fromApiMode(toApiMode(mode))).toBe(mode);
    }
  });
});

describe("parseUtc", () => {
  it("le horario com Z como UTC", () => {
    expect(parseUtc("2026-09-18T17:00:00Z").toISOString()).toBe("2026-09-18T17:00:00.000Z");
  });

  it("assume UTC quando o servidor esquece o Z (evita erro de 3h no Brasil)", () => {
    expect(parseUtc("2026-09-18T17:00:00").toISOString()).toBe("2026-09-18T17:00:00.000Z");
  });

  it("respeita offset explicito", () => {
    expect(parseUtc("2026-09-18T14:00:00-03:00").toISOString()).toBe("2026-09-18T17:00:00.000Z");
  });
});

describe("apiSessionToCompleted", () => {
  it("converte a sessao do banco para o formato do historico do app", () => {
    const completed = apiSessionToCompleted(baseSession);
    expect(completed).toMatchObject({
      sessionId: 7,
      chargerId: "CG-002",
      chargerName: "FIAP #2",
      vehicle: "BYD Dolphin",
      priority: "eco",
      kwh: 12.5,
      cost: 26.25,
      durationMin: 43, // 42min30s arredonda para 43
    });
  });

  it("nao quebra com sessao sem encerramento nem veiculo", () => {
    const completed = apiSessionToCompleted({ ...baseSession, ended_at: null, vehicle_label: null, charger_name: "" });
    expect(completed.durationMin).toBe(0);
    expect(completed.vehicle).toBe("Veículo");
    expect(completed.chargerName).toBe("CG-002");
  });
});

describe("textos", () => {
  it("formata reais no padrao brasileiro", () => {
    expect(formatBrl(2.5)).toBe("R$ 2,50");
  });

  it("descreve eventos como mensagens OCPP e cai no tipo cru quando desconhecido", () => {
    const base = { id: 1, session_id: 1, charger_code: "CG-001", payload_json: {}, created_at: "2026-09-18T17:00:00Z" };
    expect(describeEvent({ ...base, type: "meter_values" })).toBe("MeterValues");
    expect(describeEvent({ ...base, type: "evento_novo" })).toBe("evento_novo");
  });
});
