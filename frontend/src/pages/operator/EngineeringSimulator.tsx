import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Mesma logica do simulador Raspberry Pi Pico (repo Sprint-3-Controle-Inteligente-de-Sessao-de-Recarga):
// energia_disponivel = geracao - consumo; compara com POTENCIA_MINIMA_RECARGA.
function classify(generationW: number, consumptionW: number, minimumW: number) {
  const available = generationW - consumptionW;
  if (available <= 0) return { status: "RECARGA BLOQUEADA", color: "danger" as const, available };
  if (available < minimumW) return { status: "RECARGA REDUZIDA", color: "warning" as const, available };
  return { status: "RECARGA AUTORIZADA", color: "success" as const, available };
}

const SCENARIOS = [
  { label: "Geracao alta", generation: 4000, consumption: 1500 },
  { label: "Geracao limitada", generation: 1800, consumption: 1500 },
  { label: "Consumo maior que geracao", generation: 1000, consumption: 1800 },
];

export function EngineeringSimulator() {
  const [generation, setGeneration] = useState(4000);
  const [consumption, setConsumption] = useState(1500);
  const [minimum, setMinimum] = useState(1000);

  const result = classify(generation, consumption, minimum);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Simulador</h1>
        <p className="text-sm text-white/50">
          Mesma logica do prototipo Raspberry Pi Pico (Sprint 3): energia disponivel = geracao - consumo
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Parametros do cenario (W)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm text-white/70">
              Geracao
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-white outline-none transition-colors duration-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red/20"
                value={generation}
                onChange={(e) => setGeneration(Number(e.target.value))}
              />
            </label>
            <label className="block text-sm text-white/70">
              Consumo
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-white outline-none transition-colors duration-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red/20"
                value={consumption}
                onChange={(e) => setConsumption(Number(e.target.value))}
              />
            </label>
            <label className="block text-sm text-white/70">
              Potencia minima de recarga (POTENCIA_MINIMA_RECARGA)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-white outline-none transition-colors duration-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red/20"
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              {SCENARIOS.map((s) => (
                <Button
                  key={s.label}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGeneration(s.generation);
                    setConsumption(s.consumption);
                  }}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className="h-6 w-6 rounded-full"
                style={{
                  backgroundColor: result.color === "success" ? "#22c55e" : result.color === "warning" ? "#f59e0b" : "#ef4444",
                  boxShadow: `0 0 16px ${result.color === "success" ? "#22c55e" : result.color === "warning" ? "#f59e0b" : "#ef4444"}`,
                }}
              />
              <Badge variant={result.color} className="text-sm">
                {result.status}
              </Badge>
            </div>
            <p className="text-sm text-white/70">Energia disponivel: {result.available} W</p>
            <p className="font-mono text-xs text-white/40">
              Decimal: {minimum} | Binario: {minimum.toString(2)} | Hexadecimal: 0x{minimum.toString(16)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
