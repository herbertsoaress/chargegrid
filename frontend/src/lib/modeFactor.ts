import type { SessionMode } from "./types";

// Espelha MODE_FACTOR do backend (app/routers/sessions.py), usado apenas para
// a estimativa de kWh/custo exibida ao vivo antes do fechamento da sessao.
export const MODE_FACTOR: Record<SessionMode, number> = {
  rapido: 1.0,
  economico: 0.55,
  sustentavel: 0.75,
};
