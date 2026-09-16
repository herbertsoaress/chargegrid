/** Regressao linear simples (minimos quadrados), mesma tecnica aplicada em
 * `relatorio_final.pdf` (Sprint 3 - Estatistica e Regressao Linear) para
 * tempo_carga_horas -> energia_total_entregue.
 */
export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
}

export function linearRegression(points: { x: number; y: number }[]): RegressionResult {
  const n = points.length;
  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  const num = points.reduce((acc, p) => acc + (p.x - meanX) * (p.y - meanY), 0);
  const den = points.reduce((acc, p) => acc + (p.x - meanX) ** 2, 0);
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  const ssTot = points.reduce((acc, p) => acc + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((acc, p) => acc + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}
