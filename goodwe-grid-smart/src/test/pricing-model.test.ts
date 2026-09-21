import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKDAY_INDEX,
  EV_CAPACITY_KW,
  PRICE_MAX,
  PRICE_MIN,
  bandFor,
  hourlyForecast,
  localForecast,
  occupancyAt,
  priceFromOccupancy,
  summarize,
  weekdayFromDate,
} from "@/lib/pricing";
import { apiForecastToView, priceNote } from "@/lib/backend/mappers";
import type { ApiForecast } from "@/lib/backend/types";

const MON = 0;
const FRI = 4;
const SAT = 5;
const SUN = 6;
const priceAt = (weekday: number, hour: number) => hourlyForecast(DEFAULT_WEEKDAY_INDEX, weekday)[hour].price;

describe("modelo local de preco (espelho do backend)", () => {
  it("usa a mesma faixa de mercado e a mesma capacidade para carros", () => {
    expect(PRICE_MIN).toBe(1.1);
    expect(PRICE_MAX).toBe(2.0);
    expect(EV_CAPACITY_KW).toBe(80); // 200 kW contratados - 120 kW do predio
    expect(priceFromOccupancy(0)).toBe(1.1);
    expect(priceFromOccupancy(0.5)).toBe(1.55);
    expect(priceFromOccupancy(1)).toBe(2.0);
    expect(priceFromOccupancy(-1)).toBe(1.1);
    expect(priceFromOccupancy(7)).toBe(2.0);
  });

  it("reproduz os exemplos calculados no backend (mesmas contas)", () => {
    expect(priceAt(FRI, 12)).toBeCloseTo(1.92, 2);
    expect(priceAt(MON, 12)).toBeCloseTo(1.77, 2);
    expect(priceAt(SAT, 12)).toBeCloseTo(1.32, 2);
    expect(priceAt(MON, 3)).toBeCloseTo(1.47, 2);
    expect(priceAt(MON, 21)).toBeCloseTo(1.4, 2);
  });

  it("ocupacao: meio-dia de dia util = O_ref e fim de semana bem abaixo", () => {
    expect(occupancyAt(DEFAULT_WEEKDAY_INDEX, null, 12)).toBeCloseTo(0.8, 5);
    expect(occupancyAt(DEFAULT_WEEKDAY_INDEX, SAT, 12)).toBeLessThan(0.4 * occupancyAt(DEFAULT_WEEKDAY_INDEX, FRI, 12));
    for (let w = 0; w < 7; w++) {
      for (let h = 0; h < 24; h++) {
        const o = occupancyAt(DEFAULT_WEEKDAY_INDEX, w, h);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });

  it("faixas e resumo: sexta satura, domingo nao", () => {
    expect(bandFor(0.3)).toBe("fora de ponta");
    expect(bandFor(0.5)).toBe("intermediaria");
    expect(bandFor(0.9)).toBe("ponta");
    const friday = summarize(hourlyForecast(DEFAULT_WEEKDAY_INDEX, FRI));
    expect(friday.saturationAlert).toBe(true);
    expect(friday.saturationHours).toContain(12);
    expect([11, 12]).toContain(friday.peakHour);
    const sunday = summarize(hourlyForecast(DEFAULT_WEEKDAY_INDEX, SUN));
    expect(sunday.saturationAlert).toBe(false);
    expect(sunday.maxPrice).toBeLessThan(friday.maxPrice);
    expect([0, 21]).toContain(friday.quietestStart);
    for (const p of hourlyForecast(DEFAULT_WEEKDAY_INDEX, FRI)) {
      expect(p.price).toBeGreaterThanOrEqual(1.1);
      expect(p.price).toBeLessThanOrEqual(2.0);
    }
  });

  it("dia da semana do JS (domingo = 0) vira segunda = 0", () => {
    expect(weekdayFromDate(new Date(2026, 8, 18, 12))).toBe(FRI); // 18/09/2026 e sexta
    expect(weekdayFromDate(new Date(2026, 8, 20, 12))).toBe(SUN);
    expect(weekdayFromDate(new Date(2026, 8, 21, 12))).toBe(MON);
  });

  it("localForecast corrige o preco com a carga real e marca a origem 'local'", () => {
    const friNoon = new Date(2026, 8, 18, 12, 0);
    const idle = localForecast(friNoon, 0);
    expect(idle.origin).toBe("local");
    expect(idle.weekdayName).toBe("sexta");
    expect(idle.points).toHaveLength(24);
    expect(idle.now.price).toBeGreaterThan(1.85);
    const busy = localForecast(new Date(2026, 8, 20, 3, 0), EV_CAPACITY_KW); // domingo 3h, rede cheia
    expect(busy.now.occupancyUsed).toBe(1);
    expect(busy.now.price).toBe(2.0);
    expect(busy.now.occupancyPredicted).toBeLessThan(0.2);
  });
});

describe("mapeadores da previsao", () => {
  it("priceNote explica a origem do preco e ignora sessoes antigas", () => {
    expect(priceNote("modelo", 0.63)).toContain("ocupação prevista 63%");
    expect(priceNote("modelo_tempo_real", 1)).toContain("carga real");
    expect(priceNote("reserva", null)).toContain("reserva");
    expect(priceNote("curva", 0.5)).toBeUndefined();
    expect(priceNote(undefined, undefined)).toBeUndefined();
  });

  it("apiForecastToView converte o payload do backend", () => {
    const api: ApiForecast = {
      modelo: { version: 3, source: "csv", trained_at: "2026-09-20T10:00:00Z", rows: 343 },
      weekday: 4,
      weekday_name: "sexta",
      generated_at: "2026-09-18T15:00:00Z",
      points: [{ hour: 0, occupancy: 0.2, ev_load_kw: 16, total_demand_kw: 136, price_per_kwh: 1.28, band: "fora de ponta" }],
      summary: {
        peak_hour: 12, peak_occupancy: 0.91, min_price: 1.28, max_price: 1.92, avg_price: 1.6,
        saturation_hours: [11, 12], saturation_alert: true, quietest_window_start: 0, quietest_window_end: 3,
      },
      now: { occupancy_predicted: 0.5, occupancy_live: 0.7, occupancy_used: 0.7, price_per_kwh: 1.73, band: "ponta", source: "modelo_tempo_real" },
      weekday_index: [1.16, 1.18, 1.22, 1.27, 1.43, 0.38, 0.36],
      capacity_kw: 80, base_load_kw: 120, contracted_kw: 200, peak_occupancy_ref: 0.8, price_min: 1.1, price_max: 2.0,
      note: "nota",
    };
    const view = apiForecastToView(api);
    expect(view.origin).toBe("backend");
    expect(view.modelLabel).toBe("Modelo v3 (CSV, 343 registros)");
    expect(view.points[0]).toMatchObject({ hour: 0, evLoadKw: 16, totalDemandKw: 136, price: 1.28 });
    expect(view.summary).toMatchObject({ peakHour: 12, saturationAlert: true, quietestEnd: 3 });
    expect(view.now).toMatchObject({ occupancyUsed: 0.7, price: 1.73, source: "modelo_tempo_real" });
  });
});
