# Roteiro de apresentação e demonstração

Entregável **"Visão de Produto Real: para quem serve? qual problema regulatório ou operacional resolve hoje?"**.
Tempo sugerido: 8 a 10 minutos. Os números e afirmações abaixo foram conferidos no projeto; onde há ressalva, ela está escrita.

---

## Parte A: apresentação (≈ 4 min)

### 1. O problema (30 s)
Eletropostos comerciais hoje entregam **kWh e nada mais**. Falta uma camada que **orquestre a potência**, **registre cada ciclo de recarga**, **cobre um preço que acompanhe a demanda** e **converse com o equipamento por protocolos abertos**. Sem isso, o local não controla o pico de demanda (que custa caro), não sabe quanto cada recarga rendeu e fica preso a um fabricante.

### 2. Para quem serve (30 s)
Estabelecimentos com carregadores abertos ao público ou a clientes (varejo, shoppings, estacionamentos, campus) e o **operador** que gerencia a rede. O motorista usa o app para achar carregador, ver o preço e pagar; o operador vê a rede, o preço, o faturamento e os alertas. **Escopo desta entrega:** um local comercial (FIAP Paulista, 8 carregadores).

### 3. Por que agora: o argumento regulatório (30 s)
O playbook da GoodWe aponta a **REN ANEEL nº 1.000/2021**: a exploração comercial da recarga é livre (o preço pode ser negociado, o que torna a **tarifação dinâmica** legítima) e há a exigência de comunicação prévia e **padrões abertos** (o que justifica **OCPP**). *Ressalva: conferir no texto oficial antes de citar artigos.*

### 4. A solução em 4 pilares (1 min)
1. **Controle de demanda:** balanceamento de carga com limite contratado, alerta de saturação prevista e o **Energy Autopilot** — cada sessão com horário de saída ganha um plano de potência que garante a meta, evita o pico previsto e aproveita a energia solar da usina do local.
2. **Protocolos abertos:** servidor OCPP 1.6J e leitura de medidor por MODBUS TCP.
3. **Tarifação e pagamento:** preço do kWh calculado pelo modelo, travado na sessão, com comprovante que explica o motivo.
4. **IA aplicada:** modelo de previsão de demanda calibrado com dados reais do grupo, que alimenta o preço; assistente conversacional (Gemini) como interface.

### 5. Arquitetura híbrida: o que é real, simulado e futuro (1 min)
Mostrar o diagrama de [`FLUXO_DE_DADOS.md`](FLUXO_DE_DADOS.md). Mensagem-chave:
> "O **protocolo é real** (OCPP e MODBUS, validados). O **equipamento é virtual** e está marcado como simulado em toda a interface. Quando o carregador da FIAP for conectado, muda o endereço, não o sistema."

### 6. A IA como motor (1 min)
- O preço = **R$ 1,10 + R$ 0,90 × ocupação prevista**, sempre entre R$ 1,10 e R$ 2,00, dentro da faixa de mercado.
- O modelo aprende o **padrão semanal** com 343 registros reais: fim de semana ≈ 70% abaixo dos dias úteis.
- Honestidade: o histórico é de **um veículo**, então o modelo acerta o padrão da semana (correlação 0,88 fora da amostra), mas **não** o consumo de um dia exato. O nível de ocupação e a capacidade de 80 kW são **suposições de cenário**, declaradas.

---

## Parte B: demonstração ao vivo ou gravada (≈ 5 min)

### Antes de começar (checklist)
- [ ] Backend no ar (`http://localhost:8000/health` com `"engine": "postgresql"`, `ocpp.simulator: true`, `ocpp.connected: 8`).
- [ ] Frontend no ar (`http://localhost:8080`), janela em tela cheia e zoom em 100%.
- [ ] Abas abertas: o app, o Supabase (Table Editor) e, se quiser, `http://localhost:8000/docs`.
- [ ] Não mostrar `backend/.env` nem a página *Database Settings* do Supabase (senha do banco).
- [ ] Contas de demonstração: `operador@chargegrid.demo` e `motorista@chargegrid.demo`, senha `chargegrid123` (ou o botão "Entrar como demonstração").
- [ ] Se for demonstrar num dia útil, o preço mostra mais variação (aos domingos a faixa é estreita).
- [ ] Testar uma vez antes de gravar: o Render "dorme" e o Supabase gratuito pode pausar por inatividade.

### Passo a passo (o que clicar e o que dizer)

| # | Tela | Ação | Fala |
|---|---|---|---|
| 1 | Console do operador | Entrar como demonstração (ou operador real) | "O console exige login. Contas de operador são definidas pelo administrador." |
| 2 | **IA & Previsão** | Mostrar preço agora, previsão do dia, preço por hora; baixar `tarifas_horarias.csv`; clicar em **Retreinar modelo** | "O preço vem do modelo, não de uma tabela fixa. O CSV é o preço de venda calculado; não é a tarifa da concessionária." |
| 3 | **Balanceamento** | Mostrar o cartão do medidor MODBUS | "Leitura por MODBUS TCP. O medidor é simulado, e está escrito. O balanceamento usa esta leitura." |
| 4 | **Logs OCPP** | Deixar a tela aberta ao lado | "Cada linha é uma mensagem OCPP real, gravada no banco. Os 8 carregadores estão conectados." |
| 5 | App do motorista | Entrar → Home (mostrar a tarifa) → Reservar um carregador → Configurar (meta, horário, modo; ver o bloco "Tarifa agora") → **Iniciar** | "O preço fica travado ao iniciar." |
| 6 | Tela de recarga | Mostrar SoC, kWh e potência subindo | "Estes números vêm do carregador, por OCPP. O app só acompanha." |
| 7 | **Logs OCPP** | Apontar `Authorize.req`, `StartTransaction.conf`, `MeterValues.req` | "RFID, cabo e medidor: tudo pelo protocolo aberto." |
| 8 | App | **Finalizar recarga** | "Pagamento em ambiente de teste (sandbox): nenhuma cobrança real." |
| 9 | **Histórico** e **Faturamento** | Mostrar o comprovante e a nota "Preço do modelo de previsão · ocupação prevista X%" | "Rastreável: sessão, kWh, preço, motivo e valor." |
| 10 | Supabase | Abrir `charging_sessions`, `ocpp_messages`, `forecast_models` | "Tudo persiste no banco. O navegador nunca fala com ele: só o backend." |
| 11 | Assistente IA | Perguntar "Por que o preço está assim agora?" | "Responde com os dados do banco, sem inventar, e diz que o preço vem de um modelo." |
| 12 | Encerramento | Voltar ao diagrama | "Real: API, banco, protocolos, modelo, IA. Simulado: carregador, medidor, pagamento, GoodWe. Futuro: equipamento físico e credenciais." |

---

## Perguntas prováveis e respostas honestas

**"Isso é IA de verdade?"**
É um modelo estatístico calibrado com dados reais (mínimos quadrados, a mesma técnica do relatório da Sprint 3), que prevê a demanda e define o preço. O assistente conversacional usa o Gemini. Não vendemos o modelo de previsão como IA generativa.

**"Por que um veículo só nos dados?"**
É a base preparada na Sprint 04. Ela calibra o padrão da semana, não o tamanho do local; o tamanho é um cenário declarado. O sistema retreina com um clique quando houver mais dados, e as sessões reais passam a alimentar o histórico.

**"O carregador é real?"**
Não: é virtual, e a interface diz isso. O que é real é o protocolo (OCPP 1.6J, validado pelo esquema oficial). O carregador da FIAP, falando OCPP 1.6J, conecta no mesmo endereço.

**"E o pagamento?"**
Sandbox: aprovação simulada. A camada de pagamentos já trata aprovado, pendente e recusado, e trocar por um provedor real é escrever uma classe.

**"E os dados da GoodWe?"**
O adaptador é simulado e marcado como tal. O real depende das credenciais da OpenAPI, que ainda não foram liberadas (Etapa 0 da proposta).

**"O preço pode disparar?"**
Não: fica sempre entre R$ 1,10 e R$ 2,00, e é travado quando a sessão começa (não muda durante a recarga).

**"Segurança e privacidade?"**
Segredos só no backend; token de login só em memória; o motorista vê apenas as próprias sessões; RLS ligado no banco; login com limite de tentativas; o Gemini recebe só um resumo filtrado, sem e-mails, senhas nem números de série.

**"Por que Gemini, se o relatório da Sprint 03 escolheu o GPT-4o-mini?"**
O relatório comparou modelos no notebook do chatbot (LangGraph). No app usamos o Gemini por disponibilidade de chave, com as mesmas regras de segurança testadas (injeção de prompt, escopo, aconselhamento jurídico, financeiro e elétrico). O modelo é configurável por variável de ambiente.

**"Como escala para vários locais?"**
Hoje é um local (o cenário de referência). Estações e carregadores já são tabelas; múltiplos locais exigem parametrizar limite e carga base por estação. Está na lista de próximos passos.

**"O preço muda por modo de recarga? E o que é a pontuação?"**
Duas extensões do próprio grupo, além do que a GoodWe pede (`docs/ETAPA_5_PROPOSTA.md`, itens 5.8 e 5.9).
O valor da sessão soma o preço do kWh (do modelo) mais um acréscimo por modo (potência maior custa mais)
e uma tarifa por tempo de uso; se o carro fica parado depois de carregado, soma uma taxa de ociosidade,
com um teto por kWh entregue (`docs/TARIFA_TEMPO_E_OCIOSIDADE.md`). A pontuação é 10 pontos por kWh
carregado mais um bônus por bater a meta semanal, com faixas Bronze/Prata/Ouro — hoje é só visual, sem
desconto (`docs/PONTUACAO_FIDELIDADE.md`).

**"O Econômico/Sustentável/Garantido de verdade fazem o que dizem?"**
Agora sim (item 5.10 da Etapa 5, `docs/ENERGY_AUTOPILOT.md`). Com horário de saída informado, o
Garantido monta um plano de potência que garante a meta, evitando o horário de pico previsto sempre
que der; se não der, usa o pico mesmo assim para não perder o prazo. Econômico e Sustentável fazem o
mesmo, mas sem essa garantia — preferem não bater a meta a carregar caro. A "economia" que aparece é
real (ociosidade evitada, que É cobrada a menos), não uma promessa de preço por kWh mais baixo — o
preço da sessão já está travado desde o início.

## Próximos passos (para fechar a apresentação)
1. Conectar o carregador físico da FIAP (mesmo protocolo) e usar o mapa de registradores real do medidor.
2. Credenciais da GoodWe OpenAPI para trocar o adaptador simulado pelo real.
3. Provedor de pagamento real em modo teste.
4. Mais dados reais de recarga (e com hora do dia) para calibrar o formato horário.
5. Múltiplos locais e perfis de tarifa por local.
