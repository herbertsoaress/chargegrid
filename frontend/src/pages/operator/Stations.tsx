import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { Station } from "@/lib/types";

const CHARGER_VARIANT = {
  livre: "success",
  ocupado: "warning",
  manutencao: "danger",
} as const;

export function Stations() {
  const [stations, setStations] = useState<Station[]>([]);

  useEffect(() => {
    api.listStations().then(setStations).catch(() => setStations([]));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Estacoes</h1>
        <p className="text-sm text-white/50">Postos comerciais (ChargeGrid Intelligence) e residenciais (EV ChargeOps)</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {stations.map((station) => (
          <Card key={station.id}>
            <CardHeader>
              <CardTitle className="text-base text-white">{station.name}</CardTitle>
              <Badge variant="outline" className="capitalize">
                {station.type}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-white/50">{station.address}</p>
              <p className="text-xs text-white/50">Limite de importacao: {station.power_limit_kw} kW</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {station.chargers.map((charger) => (
                  <div key={charger.id} className="rounded-lg border border-white/10 p-3">
                    <p className="text-sm font-medium">{charger.code}</p>
                    <p className="text-xs text-white/50">{charger.max_power_kw} kW</p>
                    <Badge variant={CHARGER_VARIANT[charger.status]} className="mt-2 capitalize">
                      {charger.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
