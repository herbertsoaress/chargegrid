# Modelo de previsão de demanda e preço dinâmico

**Papel da IA no ChargeGrid Intelligence (playbook GoodWe):** "previsão de demanda da rede e tarifação dinâmica".
É um **modelo estatístico calibrado com dados reais do grupo** (a mesma técnica de mínimos quadrados do relatório de Estatística da Sprint 3). Não é IA generativa. O assistente com Gemini é outra peça, uma interface de conversa.

Código: `backend/app/services/forecast.py` (modelo) e `backend/app/services/pricing.py` (preço). Testes: `backend/tests/test_forecast_pricing.py`.

---

## 1. Dados usados

| Dado | Origem | Para quê |
|---|---|---|
| `data_sessao`, `energia_total_entregue` | `backend/data/fase1-base_de_dados-final.csv` (base preparada na Sprint 04: 343 registros de **um veículo**, EV100, de 2018-06-07 a 2021-06-30) | índice de demanda por dia da semana |
| `tempo_carga_horas`, `potencia_media`, `categoria_potencia` | mesmo CSV | perfil por classe de potência e reta energia × tempo |
| Curva `P1(t) = 5 + 20·sen(π·t/24)` | relatório de Cálculo Integral | formato da demanda dentro do dia |
| Sessões ativas | banco (Supabase) | correção pela carga real |
| Limite contratado 200 kW e prédio 120 kW | **cenário de referência** (`SITE_CONTRACTED_KW`, `SITE_BASE_LOAD_KW`) | capacidade para carros = 80 kW |
| Ocupação de um dia útil ao meio-dia = 0,80 | **suposição** (`PEAK_OCCUPANCY_REF`) | escala do modelo |

**Regra de projeto:** o CSV é de um único veículo que opera em ≈ 30 kW. Por isso usamos só o **formato** dos dados (padrão semanal), nunca o tamanho. O tamanho do local vem do cenário de referência, declarado como suposição.
O CSV não tem hora do dia: a distribuição dentro do dia vem da curva P1.

## 2. Fórmulas

1. **Índice do dia da semana** `I_w`, para segunda a domingo:

   `I_w = (energia total dos registros desse dia da semana ÷ nº de dias do calendário desse dia da semana) ÷ (energia total ÷ nº total de dias)`

   Conta também os dias **sem** recarga (que não aparecem no CSV). Sem isso o fim de semana pareceria 40% mais fraco, quando na verdade é cerca de 70% mais fraco.
   Resultado (modelo v1): seg 1,16 · ter 1,18 · qua 1,22 · qui 1,27 · sex 1,43 · **sáb 0,38 · dom 0,36**. `I_ref` = média de seg a sex = 1,25.

2. **Formato horário** `g(h) = P1(h) ÷ 25` (1,0 ao meio-dia; 0,2 à meia-noite).

3. **Ocupação prevista** (fração da capacidade para carros, 0 a 1):

   `O(w, h) = mínimo(1; O_ref × (I_w ÷ I_ref) × g(h))`

4. **Correção pela carga real** (no momento de abrir a sessão):

   `O_usada = máximo(O prevista; carga atual dos carros ÷ 80 kW)`
   Sessões abertas há mais de `SESSION_TTL_MINUTES` (abandonadas) não contam.

5. **Preço do kWh:** `R$/kWh = 1,10 + 0,90 × O_usada`, sempre entre **R$ 1,10 e R$ 2,00**. É travado quando a sessão começa, e o comprovante diz de onde veio.
   - Faixa: `O < 0,45` fora de ponta · `0,45 ≤ O < 0,70` intermediária · `O ≥ 0,70` ponta.
   - **Alerta de saturação prevista:** quando `O ≥ 0,90` em alguma hora do dia.

6. **Reserva:** se o modelo falhar, o preço usa a curva horária (`origem = reserva`). O app também tem uma cópia do cálculo (`goodwe-grid-smart/src/lib/pricing.ts`) para funcionar sem servidor.

### Exemplos (cenário de referência)

| Momento | Ocupação | Preço |
|---|---|---|
| Sexta, 12h | 0,91 | R$ 1,92 |
| Segunda, 12h | 0,74 | R$ 1,77 |
| Segunda, 3h | 0,41 | R$ 1,47 |
| Segunda, 21h | 0,34 | R$ 1,40 |
| Sábado, 12h | 0,24 | R$ 1,32 |

## 3. Resultados da calibração (modelo v1, treino em 343 registros)

| Métrica | Valor | Leitura |
|---|---|---|
| Regressão tempo × energia (relatório da Sprint 3) | inclinação 30,36 · intercepto −26,88 · **R² 0,7357** | reproduzida exatamente |
| Uma reta por classe de potência | **R² 0,8777** | melhora a estimativa de energia por sessão |
| Classe baixa | 122 registros · ≈ 9,4 kW · 3,8 h · `E = 16,71·t − 17,82` (R² 0,71) | |
| Classe média | 221 registros · ≈ 30,4 kW · 6,6 h · `E = 27,68·t + 14,50` (R² 0,76) | |
| Teste fora da amostra (treino até 22/06/2020, teste até 30/06/2021) | correlação da forma semanal **0,88** | o padrão semanal se repete |
| Erro diário médio | 66,1 kWh (modelo) contra 68,5 kWh (média constante) | ganho de apenas 3% |

## 4. Limites (dizer com clareza na apresentação)

- **Não prevê o consumo de um dia específico:** o erro diário melhora pouco porque o histórico é de um só veículo e varia muito. Ele captura bem o **padrão da semana**, e isso basta para o preço, que usa a ocupação relativa.
- Histórico de **um veículo**: serve de calibração, não de retrato de uma rede inteira.
- Sem hora do dia no CSV: a forma horária vem da curva P1 (do relatório), não dos dados.
- A reta energia × tempo tem intercepto negativo: abaixo de ≈ 0,9 h ela daria energia negativa (o sistema não usa a reta para isso).
- Ocupação de referência e capacidade são **suposições de cenário**.

## 5. Como usar e retreinar

- **Ver o modelo:** tela **IA & Previsão** (versão, fonte, nº de registros, previsão do dia, preço por hora), ou `GET /ai/forecast` (público) e `GET /ai/model` (operador, com métricas).
- **Retreinar:** botão **Retreinar modelo** (operador) ou `POST /ai/retrain`. Cada treino grava uma nova versão em `forecast_models`. Para usar dados novos, substitua `backend/data/fase1-base_de_dados-final.csv` (mesmas colunas) e retreine.
- **Exportar a tabela de preços:** botão `tarifas_horarias.csv` ou `GET /ai/tariffs.csv`. É o preço de venda calculado pelo modelo (dia útil, sábado e domingo), **não** a tarifa da concessionária.
- **Ajustar o cenário:** variáveis `SITE_CONTRACTED_KW`, `SITE_BASE_LOAD_KW`, `PEAK_OCCUPANCY_REF` e `SATURATION_THRESHOLD` no `backend/.env`.

## 6. Faixa de preço e mercado (2026)

R$ 1,10 a R$ 2,00 por kWh fica dentro do que o mercado brasileiro pratica: AC em redes públicas ≈ R$ 0,80 a 1,50 (pontos médios ≈ R$ 1,05 a 1,25), AC em shoppings e hotéis ≈ R$ 1,50 a 2,20 e DC rápido ≈ R$ 1,80 a 2,10. O piso mantém margem sobre o custo da energia (≈ R$ 0,80 a 1,00/kWh; a tarifa residencial B1 da Enel SP era R$ 0,789 após o reajuste de julho de 2026).
Fontes: blogs do setor (conferir antes de citar): Elektro Charge (tabela de redes, abril/2026), guiadeeconomiapessoal.com.br (julho/2026), calculadoraenergia.com.br e Enel SP. **Recomendação:** confirmar 2 ou 3 preços reais (aplicativos Tupinambá e PlugShare) perto do local da demonstração e citar esses.
