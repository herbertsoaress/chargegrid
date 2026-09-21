import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SimBadge } from "@/components/shared/SimBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ChargingSession, PricingPoint } from "@/lib/types";
import { formatCurrency, formatKwh } from "@/lib/utils";

export function Billing() {
  const [comercial, setComercial] = useState<PricingPoint[]>([]);
  const [residencial, setResidencial] = useState<PricingPoint[]>([]);
  const [sessions, setSessions] = useState<ChargingSession[]>([]);

  useEffect(() => {
    api.billingPricing("comercial").then(setComercial).catch(() => setComercial([]));
    api.billingPricing("residencial").then(setResidencial).catch(() => setResidencial([]));
    api.listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  const merged = comercial.map((c, i) => ({
    hour: c.hour,
    comercial: c.price_per_kwh,
    residencial: residencial[i]?.price_per_kwh,
  }));

  const invoices = sessions.filter((s) => s.ended_at).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Faturamento</h1>
        <p className="text-sm text-white/50">Tarifacao dinamica por horario e historico de cobrancas</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preco por kWh ao longo do dia</CardTitle>
          <SimBadge origem="simulado" />
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={merged}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
              <XAxis dataKey="hour" stroke="#ffffff66" fontSize={11} unit="h" />
              <YAxis stroke="#ffffff66" fontSize={11} unit=" R$" />
              <Tooltip contentStyle={{ background: "#0d0d10", border: "none" }} />
              <Legend />
              <Line type="monotone" dataKey="comercial" name="ChargeGrid Intelligence" stroke="#ef4444" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="residencial" name="EV ChargeOps" stroke="#38bdf8" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Faturas emitidas</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-white/40">
                <th className="pb-2 font-medium">Sessao</th>
                <th className="pb-2 font-medium">Energia</th>
                <th className="pb-2 font-medium">Preco/kWh</th>
                <th className="pb-2 font-medium">Total</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-white/40">
                    Nenhuma fatura registrada ainda
                  </td>
                </tr>
              )}
              {invoices.map((s) => (
                <tr key={s.id} className="border-t border-white/10">
                  <td className="py-2">#{s.id}</td>
                  <td className="py-2">{formatKwh(s.energy_kwh)}</td>
                  <td className="py-2">{formatCurrency(s.price_per_kwh_snapshot)}</td>
                  <td className="py-2">{formatCurrency(s.amount_due)}</td>
                  <td className="py-2">
                    <Badge variant={s.payment_finalized ? "success" : "warning"}>
                      {s.payment_finalized ? "Pago" : "Pendente"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
