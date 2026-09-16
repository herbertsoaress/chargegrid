import { useEffect, useState } from "react";

import { SimBadge } from "@/components/shared/SimBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { BalancingSnapshot } from "@/lib/types";

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-white/60">
        <span>{label}</span>
        <span>{value.toFixed(1)} kW</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function Balancing() {
  const [snapshot, setSnapshot] = useState<BalancingSnapshot | null>(null);

  useEffect(() => {
    const poll = () => api.billingBalancing().then(setSnapshot).catch(() => undefined);
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Balanceamento - Energy Engine</h1>
          <p className="text-sm text-white/50">Solar + bateria ESS complementam a rede eletrica (limite de importacao)</p>
        </div>
        <SimBadge origem="simulado" />
      </div>

      {snapshot && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Fontes de energia atendendo a demanda</CardTitle>
              <Badge variant={snapshot.within_grid_limit ? "success" : "danger"}>
                {snapshot.within_grid_limit ? "Dentro do limite de importacao" : "Limite de importacao excedido"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <Bar label="Solar" value={snapshot.supplied_by_solar_kw} max={snapshot.total_demand_kw || 1} color="#f4b400" />
              <Bar
                label={`Rede eletrica (limite ${snapshot.grid_import_limit_kw} kW)`}
                value={snapshot.supplied_by_grid_kw}
                max={snapshot.grid_import_limit_kw}
                color="#c0155e"
              />
              <Bar label="Bateria ESS" value={snapshot.supplied_by_battery_kw} max={snapshot.total_demand_kw || 1} color="#2e9e83" />
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Geracao solar</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{snapshot.solar_kw.toFixed(1)} kW</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>SOC da bateria</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{snapshot.battery_soc_percent.toFixed(0)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Consumo do predio</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{snapshot.building_load_kw.toFixed(1)} kW</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Consumo dos carregadores</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{snapshot.ev_load_kw.toFixed(1)} kW</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
