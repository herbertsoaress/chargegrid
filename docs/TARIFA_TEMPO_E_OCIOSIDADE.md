# Tarifa por tempo de uso, por potência e por ociosidade

**Extensão aprovada pelo grupo**, fora do playbook da GoodWe e da Proposta de Evolução Técnica original
(ver [`ETAPA_5_PROPOSTA.md`](ETAPA_5_PROPOSTA.md)). Complementa o preço por kWh do modelo de previsão
(descrito em [`MODELO_PREVISAO.md`](MODELO_PREVISAO.md)): agora, além da energia, a sessão também cobra
pelo **tempo** que o carro ocupa o carregador e pela **potência** do modo escolhido.

Código: `backend/app/services/pricing.py` (`breakdown`, `mode_surcharge_per_kwh`, `tariff_snapshot`) e
`backend/app/config.py`. Testes: `backend/tests/test_tariff_time_power.py`.

## 1. Por que

Hoje, dois modos que gastam a mesma energia custam o mesmo, mesmo que um deles ocupe o carregador o
dobro do tempo (o Econômico usa metade da potência do Rápido). Cobrar pelo tempo corrige isso: quem
ocupa mais tempo paga mais, e quem escolhe mais potência paga um pouco mais por isso.

## 2. Fórmula

```
preço do kWh (energia) = preço do modelo (R$ 1,10 a R$ 2,00) + acréscimo do modo
valor = energia_kWh × preço do kWh
      + minutos de recarga × tarifa por minuto
      + minutos de ociosidade × taxa de ociosidade
valor final = mínimo(valor, energia_kWh × teto por kWh)
```

- **Acréscimo por modo** (potência maior = mais caro): Econômico R$ 0,00 · Sustentável R$ 0,05 ·
  Garantido R$ 0,10 · Rápido R$ 0,15 por kWh.
- **Minutos de recarga** = energia entregue ÷ potência nominal do modo × 60. É a mesma conta que a
  tela usa para estimar o tempo antes de iniciar — **não** é o relógio de parede, para não depender de
  acelerações da simulação (`SIM_TIME_SCALE`, `OCPP_SIMULATOR_SPEEDUP`).
- **Tarifa por minuto de recarga:** R$ 0,03.
- **Ociosidade:** quando a bateria chega a 100% (telemetria OCPP ou do app) e o carro continua
  ocupando a vaga, cada minuto além de uma carência inicial (10 min) soma R$ 0,10. Isso é sim medido
  pelo relógio de parede: é o tempo real que alguém demora para vir buscar o carro.
- **Teto:** o valor final nunca passa de R$ 2,20 por kWh entregue, mesmo somando tempo e ociosidade.
  Protege o cliente de uma sessão muito lenta ou muito parada custar sem limite.

Todas essas tarifas ficam **travadas** na sessão no momento em que ela começa (como já acontecia com o
preço por kWh): mudar as variáveis de ambiente só afeta sessões novas.

### Exemplo (sessão de 10 kWh, preço do modelo R$ 1,50/kWh)

| Modo | Potência | Tempo | Preço do kWh | Energia | Tempo | Total (sem ociosidade) |
|---|---|---|---|---|---|---|
| Econômico | 12,1 kW | 49,59 min | R$ 1,50 | R$ 15,00 | R$ 1,49 | **R$ 16,49** |
| Sustentável | 16,5 kW | 36,36 min | R$ 1,55 | R$ 15,50 | R$ 1,09 | **R$ 16,59** |
| Garantido | 18,7 kW | 32,09 min | R$ 1,60 | R$ 16,00 | R$ 0,96 | **R$ 16,96** |
| Rápido | 22,0 kW | 27,27 min | R$ 1,65 | R$ 16,50 | R$ 0,82 | **R$ 17,32** |

(A linha "Garantido" foi conferida contra o backend rodando de verdade: `minutes_charging = 32.09`,
`amount_estimate = 16.96` para os mesmos números de entrada.)

Com estes valores, o modo mais rápido custa cerca de 5% a mais que o mais lento pela mesma energia —
o acréscimo por potência pesa mais que a economia de tempo. Esses percentuais podem ser reajustados
pelas variáveis de ambiente (ver seção 4).

## 3. Como funciona por dentro

- **Na abertura da sessão** (`POST /sessions`), o backend grava um "retrato" das tarifas do momento
  (acréscimo do modo, tarifa por minuto, taxa e carência de ociosidade, teto) nas colunas
  `mode_surcharge_snapshot`, `time_rate_snapshot`, `idle_rate_snapshot`,
  `idle_grace_minutes_snapshot` e `price_cap_per_kwh_snapshot` de `charging_sessions`.
- **A cada `MeterValues`** (do carregador OCPP ou do controlador simulado do app), se o SoC informado
  chegar a 100% pela primeira vez, o backend grava `full_at` (o instante em que a bateria encheu).
- **Ao consultar a sessão** (`GET /sessions/{id}`) ou ver o comprovante, o valor é recalculado ao vivo
  com `services/pricing.py:breakdown()`, e vem detalhado: `energy_amount`, `time_amount`, `idle_amount`
  e o total (`amount_estimate` durante a sessão, `amount_due` depois de paga/encerrada).
- **No encerramento**, o valor é conferido de novo com a energia e o tempo finais (o mecanismo que já
  existia para acertar a energia — ver `session_ops.py:_settle_final_amount` — agora também acerta
  tempo e ociosidade). No pagamento sandbox, o valor cobrado é atualizado; com um provedor real, a
  diferença fica só registrada (`amount_adjusted`, campo `to_reconcile`).
- **Sessões de antes desta extensão** ficam com essas colunas zeradas, o que o código trata como "sem
  tempo, sem ociosidade, sem teto" — ou seja, continuam cobrando só energia × preço, exatamente como já
  tinham sido cobradas. Um teto de R$ 0,00 nunca é confundido com "zerar o valor" (haveria esse risco
  se o código tratasse 0 como um teto de verdade; por isso ele é tratado como "sem teto").

## 4. Como ajustar

Todas as variáveis ficam em `backend/.env` (nenhuma é obrigatória; os valores acima são o padrão):

| Variável | Padrão |
|---|---|
| `TIME_RATE_PER_MINUTE` | 0,03 |
| `MODE_SURCHARGE_ECONOMICO` / `_SUSTENTAVEL` / `_GARANTIDO` / `_RAPIDO` | 0,00 / 0,05 / 0,10 / 0,15 |
| `IDLE_RATE_PER_MINUTE` | 0,10 |
| `IDLE_GRACE_MINUTES` | 10 |
| `PRICE_CAP_PER_KWH` | 2,20 |

## 5. Limites

- A ociosidade só é detectada em sessões que reportam SoC (telemetria do carregador OCPP ou do
  controlador simulado do app); ela nunca é cobrada por adivinhação.
- O "minuto de recarga" é uma estimativa (energia ÷ potência nominal), não uma medição direta de
  tempo — é a mesma simplificação que a tela de estimativa já usava antes desta extensão.
- Não está prevista no playbook da GoodWe nem na proposta original do grupo: é uma extensão comercial,
  pensada para corrigir a distorção entre os modos de recarga.
