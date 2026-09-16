import { Badge } from "@/components/ui/badge";

/**
 * Selo obrigatorio em qualquer painel alimentado pelo adaptador GoodWe, para
 * nunca deixar ambiguo o que e dado real e o que e simulado (risco listado na
 * Proposta de Evolucao Tecnica, secao "Exposicao de dados operacionais").
 */
export function SimBadge({ origem }: { origem: "simulado" | "real" }) {
  if (origem === "real") {
    return <Badge variant="success">GoodWe real</Badge>;
  }
  return <Badge variant="warning">Dados simulados</Badge>;
}
