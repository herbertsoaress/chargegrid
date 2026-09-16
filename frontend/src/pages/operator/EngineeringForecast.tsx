import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { linearRegression } from "@/lib/regression";
import type { ChargingSession } from "@/lib/types";

// Coeficientes documentados em relatorio_final.pdf (Sprint 3 - Estatistica e
// Regressao Linear): tempo_carga_horas -> energia_total_entregue.
const REFERENCE_SLOPE = 30.36;
const REFERENCE_INTERCEPT = -26.88;
const REFERENCE_R2 = 0.7357;

export function EngineeringForecast() {
  const [sessions, setSessions] = useState<ChargingSession[]>([]);

  useEffect(() => {
    api.listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  const realPoints = sessions
    .filter((s) => s.ended_at && s.energy_kwh > 0)
    .map((s) => {
      const hours = (new Date(s.ended_at as string).getTime() - new Date(s.started_at).getTime()) / 3_600_000;
      return { x: Math.round(hours * 100) / 100, y: s.energy_kwh };
    });

  const referenceLine = Array.from({ length: 13 }).map((_, x) => ({
    x,
    referencia: Math.max(0, REFERENCE_SLOPE * x + REFERENCE_INTERCEPT),
  }));

  const fitted = realPoints.length >= 2 ? linearRegression(realPoints) : null;
  const chartData = referenceLine.map((point) => ({
    ...point,
    ajuste_atual: fitted ? Math.max(0, fitted.slope * point.x + fitted.intercept) : undefined,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">IA e Previsao</h1>
        <p className="text-sm text-white/50">
          Regressao linear tempo de carga (h) x energia entregue (kWh) - mesma tecnica do relatorio de Estatistica
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modelo de referencia (relatorio Sprint 3) vs. dados reais do banco</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
              <XAxis dataKey="x" stroke="#ffffff66" fontSize={11} unit="h" />
              <YAxis stroke="#ffffff66" fontSize={11} unit=" kWh" />
              <Tooltip contentStyle={{ background: "#0f2440", border: "none" }} />
              <Legend />
              <Line type="monotone" dataKey="referencia" name="Referencia (relatorio)" stroke="#2e9e83" dot={false} strokeDasharray="4 4" />
              {fitted && <Line type="monotone" dataKey="ajuste_atual" name="Ajuste com dados reais" stroke="#c0155e" dot={false} />}
              <Scatter data={realPoints} dataKey="y" name="Sessoes reais" fill="#f4b400" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coeficientes de referencia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-white/70">
            <p>Inclinacao: {REFERENCE_SLOPE} kWh/h</p>
            <p>Intercepto: {REFERENCE_INTERCEPT}</p>
            <p>R²: {REFERENCE_R2}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Coeficientes com dados reais ({realPoints.length} sessoes)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-white/70">
            {fitted ? (
              <>
                <p>Inclinacao: {fitted.slope.toFixed(2)} kWh/h</p>
                <p>Intercepto: {fitted.intercept.toFixed(2)}</p>
                <p>R²: {fitted.r2.toFixed(4)}</p>
              </>
            ) : (
              <p>Aguardando pelo menos 2 sessoes encerradas para recalcular o ajuste.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
