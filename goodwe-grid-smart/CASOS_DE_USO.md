# Casos de Uso — GoodWe ChargeGrid Intelligence

Casos de uso derivados diretamente do comportamento implementado no código (`LiveDataProvider` e as
telas do Dashboard e do App Mobile). Dashboard e App Mobile compartilham o mesmo estado em tempo real
(um único `LiveDataProvider` em `pages/Index.tsx`) — uma ação disparada no App Mobile (iniciar/encerrar
sessão) é refletida imediatamente no Dashboard, e vice-versa.

**Modo com backend:** se `VITE_API_URL` estiver definida, o app e o console exigem **login** (UC-16), o preço
vem do **modelo de previsão** (UC-17), as sessões são gravadas no backend (SQLite ou Supabase) e, com
os simuladores ligados, a recarga é conduzida por **carregadores virtuais que falam OCPP** (UC-18). As
observações "Com backend" abaixo descrevem essa diferença; sem backend o comportamento é o descrito no fluxo
principal (simulação local em memória, sem login).

O cenário é **um único local comercial** (FIAP Paulista, 8 carregadores).

---

## Dashboard (Operador)

### UC-01 — Visualizar Painel Geral
- **Ator:** Operador da rede de carregadores
- **Pré-condição:** Dashboard carregado (`LiveDataProvider` montado); aba "Painel Geral" ativa (padrão)
- **Fluxo principal:**
  1. Operador acessa a tela principal (`/`), na visão "Ambos" ou "Dashboard".
  2. `DashboardOverview` exibe os KPIs (energia hoje, sessões ativas, faturamento hoje, capacidade da
     rede), o gráfico de potência distribuída em tempo real (janela de 20 min), o gráfico de demanda de
     potência (24h), a receita semanal, a tabela de sessões em andamento e o bloco de próximas
     liberações.
  3. A cada 2 segundos os dados são recalculados pelo `LiveDataProvider` e a tela atualiza sozinha, sem
     ação do operador.
- **Com backend (operador logado):** "Energia hoje" e "Faturamento hoje" vêm do banco (`GET /billing/summary`,
  sessões encerradas hoje), marcados "banco"; sem login ou sem API ficam marcados "simulado". Os gráficos de
  demanda 24h e receita semanal são exemplos ilustrativos fixos.
- **Fluxo alternativo:** Se não há nenhum carregador em `charging`/`finishing`, a tabela de sessões em
  andamento fica vazia; se nenhuma estação libera em menos de 10 minutos, o bloco "Próximas liberações"
  exibe a mensagem "Nenhuma estação prevista para liberar nos próximos 10 minutos."
- **Resultado esperado:** O operador tem uma visão consolidada e sempre atualizada da operação, sem
  precisar atualizar a página manualmente.

### UC-02 — Monitorar Balanceamento de carga
- **Ator:** Operador
- **Pré-condição:** Aba "Balanceamento" selecionada
- **Fluxo principal:**
  1. `DashboardLoadManagement` mostra o algoritmo de Balanceamento Dinâmico (DLB) com a participação de
     cada carregador ativo na demanda total, o painel "Energy Engine" com a potência atual/máxima de
     cada carregador e seu modo, o Simulador de Infraestrutura (sliders) e o gráfico de Dynamic Load
     Balancing (carga total x carga EV x limite contratado).
  2. Quando `networkLoadPct` ultrapassa 85%, um alerta "Peak Shaving recomendado" aparece no topo.
- **Fluxo alternativo:** Se a demanda está acima do limite recomendado, o botão "Aplicar Peak Shaving
  Automático" fica disponível (ver UC-09); caso contrário, o botão não é exibido.
- **Resultado esperado:** O operador identifica risco de ultrapassagem do limite contratado e tem uma
  ação direta para mitigá-lo.

### UC-03 — Gerenciar Estações e carregadores
- **Ator:** Operador
- **Pré-condição:** Aba "Estações" selecionada
- **Fluxo principal:**
  1. `DashboardChargers` lista os 8 carregadores em cards, ordenados por relevância de status
     (carregando → preparando → finalizando → disponível → falha).
  2. Operador filtra por "Todos", "Disponível", "Carregando" ou "Falha".
  3. Operador clica em "Ver detalhes" em um card para expandir tarifa, custo da sessão atual e potência
     máxima.
- **Fluxo alternativo:** Um filtro sem nenhum carregador correspondente resulta em uma grade vazia.
- **Resultado esperado:** O operador enxerga e filtra o parque de carregadores com status atualizado em
  tempo real.

### UC-04 — Visualizar Logs OCPP
- **Ator:** Operador / Engenheiro de operações
- **Pré-condição:** Aba "Logs OCPP" selecionada
- **Fluxo principal:**
  1. `DashboardLogs` exibe indicadores (conexões OCPP 1.6J, mensagens/min, uptime do CSMS) e um terminal
     simulado com mensagens (`BootNotification`, `StartTransaction`, `LoadBalancing`,
     `StatusNotification`, `Heartbeat`, `Authorize`, `StopTransaction`, etc.).
  2. Novas linhas são adicionadas automaticamente a cada tick (probabilidade de 70%) e o terminal rola
     para o final sozinho.
- **Fluxo alternativo:** Nenhum — o terminal sempre parte de um conjunto inicial de logs (`initialLogs`)
  e cresce a partir daí.
- **Com backend:** o terminal mostra as **mensagens OCPP reais** gravadas no banco (`ocpp_messages`), com
  direção (carregador → central ou o contrário), nome e resumo do conteúdo, e o indicador de quantos
  carregadores estão conectados (virtuais ou externos). Sem mensagens, a tela orienta a ligar o simulador
  (`OCPP_SIMULATOR=true`) ou conectar um carregador em `ws://…/ocpp/CG-001`.
- **Resultado esperado:** Trilha de auditoria operacional, no formato de mensagens OCPP, disponível para
  inspeção contínua.

### UC-05 — Consultar IA & Previsão
- **Ator:** Operador
- **Pré-condição:** Aba "IA & Previsão" selecionada
- **Fluxo principal:**
  1. `DashboardInsights` mostra a previsão de demanda (kW) para os próximos 60 minutos (linha pontilhada)
     sobreposta à demanda real, e 4 cards de insight (peak shaving, otimização de receita, tendência de
     uso, janela de manutenção).
  2. "Ver análise completa" abre um diálogo com a tabela de tarifas por período (ponta/fora de
     ponta/noturno) e a receita estimada por período.
  3. "Ver relatório" abre um diálogo com o gráfico de uso por dia da semana.
  4. "Agendar manutenção" abre um formulário (carregador, data, técnico, observação); ao confirmar, um
     toast de sucesso é exibido e o diálogo fecha.
- **Fluxo alternativo:** Se o formulário de manutenção é enviado com campos vazios, o toast usa valores
  padrão ("Carregador", "data a definir", "técnico a definir").
- **Com backend:** a tela passa a mostrar o modelo de previsão real (ver UC-17).
- **Resultado esperado:** O operador consulta previsões de IA e registra decisões operacionais (mesmo
  sem persistência real em banco de dados).

### UC-06 — Usar Simulador "E Se...?"
- **Ator:** Operador / Time comercial
- **Pré-condição:** Aba "Simulador" selecionada
- **Fluxo principal:**
  1. `DashboardSimulator` expõe 5 sliders: número de carregadores, consumo base do prédio, limite
     contratado, veículos simultâneos e geração solar.
  2. A cada alteração, o pico de demanda "sem ChargeGrid" e "com ChargeGrid" é recalculado
     instantaneamente, junto da redução de pico, economia mensal estimada, payback do investimento
     (R$ 15.000) e o gráfico de ROI acumulado em 24 meses (com marcação do ponto de retorno).
- **Fluxo alternativo:** Se o pico sem ChargeGrid não ultrapassa o limite contratado, o selo muda de
  "⚠️ Ultrapassagem contratual" para "Dentro do limite"; se a economia mensal é zero ou negativa, o
  payback exibe "—" (infinito).
- **Resultado esperado:** O usuário visualiza, em tempo real, o impacto financeiro e técnico de adotar o
  ChargeGrid sob diferentes cenários de infraestrutura.

### UC-07 — Consultar Faturamento
- **Ator:** Operador / Financeiro
- **Pré-condição:** Aba "Faturamento" selecionada
- **Fluxo principal:**
  1. `DashboardBilling` mostra KPIs (receita mensal, % de pagamentos via PIX, faturas pendentes), o
     gráfico de receita mensal e a tabela de faturas recentes com cliente, valor, método e status.
  2. Ao final, o split de receita é exibido entre Operador (GoodWe), Proprietário do local e Taxa de
     plataforma.
- **Fluxo alternativo:** Nenhum — os dados desta tela são um conjunto ilustrativo fixo.
- **Resultado esperado:** Visão consolidada de receita e de como ela é repartida entre as partes
  envolvidas no negócio.

### UC-08 — Gerenciar Usuários & Frotas
- **Ator:** Operador / Time comercial
- **Pré-condição:** Aba "Usuários & Frotas" selecionada
- **Fluxo principal:**
  1. `DashboardUsers` mostra KPIs (total de usuários, empresas/frotas, veículos cadastrados) e uma
     tabela com nome, tipo de conta (Individual/Corporativo/Frota), veículo, número de
     sessões, total gasto e status (Ativo/Inativo).
- **Fluxo alternativo:** Nenhum — dados ilustrativos fixos na simulação local.
- **Com backend:** a tabela lista os usuários reais do banco, com veículos, número de sessões e total gasto.
- **Resultado esperado:** Protótipo de tela de gestão de clientes/frotas para validação do fluxo
  comercial.

### UC-09 — Acionar Peak Shaving e observar redução de potência
- **Ator:** Operador
- **Pré-condição:** Rede próxima do limite contratado (`networkLoadPct > 85%`) e ao menos um carregador
  em modo "Econômico" carregando
- **Fluxo principal:**
  1. Operador clica em "Aplicar Peak Shaving Automático" (Balanceamento) ou "Ativar Peak Shaving"
     (IA & Previsão).
  2. `applyPeakShaving()` marca `peakShavingActive = true`, reduz a potência atual dos carregadores em
     modo Econômico para 60% da potência máxima, grava um log `WARN` ("PeakShaving → setChargingProfile
     60%...") e exibe um toast de confirmação.
  3. Após 30 segundos, o efeito é revertido automaticamente e um log `ACK` de restauração é gravado.
- **Fluxo alternativo:** Se o Peak Shaving já está ativo, um novo clique é ignorado (operação
  idempotente); se não há carregador em modo Econômico carregando no momento, o estado interno muda mas
  nenhuma potência visível é alterada.
- **Resultado esperado:** Redução visível e temporária da potência dos carregadores afetados, com o selo
  "Peak Shaving Ativo" exibido enquanto durar a janela de 30 segundos.

---

## App Mobile (Motorista)

### UC-10 — Localizar estação de recarga no mapa
- **Ator:** Motorista
- **Pré-condição:** App mobile na tela "Home" ou "Mapa"
- **Fluxo principal:**
  1. Motorista navega até a aba "Mapa".
  2. `MobileMap` inicializa um mapa Leaflet com tiles do OpenStreetMap (filtro CSS para estilo escuro) e
     plota um pin por carregador, colorido conforme o status (verde = disponível, azul = carregando,
     laranja = preparando, cinza = manutenção).
  3. Motorista pode digitar um termo de busca (nome ou ID) para filtrar os pins visíveis.
  4. Ao clicar em um pin, um card inferior mostra nome, ID, tipo, status, potência/tarifa e a ação
     disponível.
- **Fluxo alternativo:** Busca sem correspondência esconde todos os pins do mapa; se o carregador
  selecionado já está ocupado, o card mostra progresso e ETA da sessão em vez do botão "Reservar agora".
- **Resultado esperado:** O motorista identifica visualmente as estações próximas e o status de cada uma
  antes de se deslocar até elas.

### UC-11 — Ver detalhes de um carregador
- **Ator:** Motorista
- **Pré-condição:** Um carregador foi selecionado na Home ou no Mapa
- **Fluxo principal:**
  1. `MobileChargerDetail` exibe o status atual, a potência máxima e a tarifa por kWh do carregador.
  2. Se o carregador está **disponível**, dois botões (QR Code e RFID) levam à configuração de sessão.
  3. Se está **ocupado**, mostra os dados da sessão em andamento (usuário, veículo, progresso, ETA, modo
     e horário de saída).
  4. Se está **em falha**, mostra um aviso de manutenção em andamento.
- **Fluxo alternativo:** Se nenhum carregador foi explicitamente selecionado, a tela usa o primeiro
  carregador da lista como retorno seguro.
- **Resultado esperado:** O motorista tem informação suficiente para decidir se inicia uma sessão naquele
  carregador.

### UC-12 — Configurar e iniciar sessão de recarga
- **Ator:** Motorista
- **Pré-condição:** Um carregador **disponível** foi selecionado (UC-11)
- **Fluxo principal:**
  1. Em `MobileSessionSetup`, o motorista define o horário de saída, o nível de bateria desejado (slider
     de 20% a 100%) e o modo de recarga (Rápido, Econômico, Sustentável ou Garantido).
  2. A estimativa de tempo, energia (kWh) e custo (R$) é recalculada em tempo real conforme os valores
     mudam.
  3. Ao confirmar, `startSession()` marca o carregador como "preparando", registra o log
     `StartTransaction`, cria a sessão ativa e, após 2 segundos, muda o status para "carregando" com o
     log `StatusNotification`; um toast de sucesso é exibido e o motorista é levado à tela de recarga.
- **Fluxo alternativo:** Se o motorista não alterar nenhum campo, os valores padrão são usados (18:30,
  80%, modo Rápido).
- **Com backend:** a tela mostra a **tarifa do momento** (preço do modelo, com a ocupação prevista) e o
  motorista escolhe o veículo cadastrado. O preço é **travado** no início da sessão. Ver UC-18 para o que
  acontece depois.
- **Resultado esperado:** Uma nova sessão é criada no `LiveDataProvider` e o carregador correspondente
  passa a aparecer como ocupado **tanto no App Mobile quanto no Dashboard**, imediatamente.

### UC-13 — Acompanhar sessão em andamento
- **Ator:** Motorista
- **Pré-condição:** Existe uma sessão ativa para o carregador selecionado (UC-12 concluído)
- **Fluxo principal:**
  1. `MobileCharging` exibe um anel de progresso circular com o percentual atual, além de potência atual,
     kWh entregues, tempo decorrido e custo estimado — todos atualizados a cada 2 segundos pelo
     `LiveDataProvider`.
  2. A previsão de horário de conclusão e o horário de saída informado são exibidos juntos.
- **Fluxo alternativo:** Se não há sessão ativa para o carregador (por exemplo, o motorista navegou
  diretamente para a tela), é exibido o estado vazio "Nenhuma recarga ativa" com orientação para voltar
  e escolher uma estação.
- **Resultado esperado:** O motorista acompanha a evolução da recarga em tempo real, sem precisar sair do
  app.

### UC-14 — Encerrar sessão e ver resumo
- **Ator:** Motorista
- **Pré-condição:** Sessão em andamento (UC-13)
- **Fluxo principal:**
  1. Motorista toca em "Finalizar Recarga".
  2. `endSession()` move a sessão de `activeSessions` para `completedSessions` (com kWh, custo, duração e
     data de conclusão); o carregador correspondente passa para "finalizando" e, pela simulação
     automática, volta a "disponível" pouco depois.
  3. Um toast resume a energia entregue e o custo final; o motorista retorna à tela Home.
- **Fluxo alternativo:** Nenhum — fluxo único de encerramento.
- **Com backend:** o encerramento executa o pagamento **sandbox** (PIX, aprovação simulada), para a sessão
  no servidor e busca o comprovante (`CG-AAAA-NNNNNN`), que passa a aparecer em Faturamento e em
  Logs OCPP → "Comprovantes gravados no banco". Se a API falhar, a sessão é encerrada apenas localmente.
- **Resultado esperado:** A sessão passa a constar no histórico do motorista com os valores acumulados
  até o momento do encerramento.

### UC-15 — Consultar histórico de sessões
- **Ator:** Motorista
- **Pré-condição:** Nenhuma obrigatória — o histórico de exemplo está sempre disponível
- **Fluxo principal:**
  1. `MobileHistory` combina as sessões concluídas durante a sessão atual do navegador
     (`completedSessions`) com um histórico fixo de 6 registros de exemplo.
  2. A tela soma o total de kWh e o custo total do "mês" e lista cada sessão com carregador, data,
     veículo, modo, duração, kWh e custo.
- **Fluxo alternativo:** Se nenhuma sessão foi concluída nesta sessão do navegador, a lista mostra apenas
  o histórico fixo de exemplo.
- **Com backend:** o histórico mostra somente as sessões reais gravadas no banco (com número do
  comprovante), no lugar do histórico fixo de exemplo.
- **Resultado esperado:** O motorista revisa seu consumo e gastos acumulados com recarga.

---

## Casos de uso com backend (login, modelo, OCPP, MODBUS)

### UC-16 — Entrar no app e no console (login)
- **Ator:** Motorista ou Operador
- **Pré-condição:** Backend no ar
- **Fluxo principal:**
  1. O motorista abre o app e vê a tela de login/cadastro (`MobileLogin`). O operador abre o console e vê o
     login do operador (`OperatorLogin`).
  2. Informam e-mail e senha. O backend devolve um token, que fica **só em memória** (recarregar a página
     pede login de novo).
  3. O cadastro cria sempre **motorista**. Um e-mail só vira operador se estiver em `OPERATOR_EMAILS` no
     backend.
- **Fluxo alternativo:** Após 5 senhas erradas em 5 minutos (mesmo e-mail e IP), o backend responde 429 e a
  tela avisa para aguardar. "Entrar como demonstração" só aparece se o backend informar `demo_login`. Um
  motorista não acessa o console do operador (e o contrário também é separado).
- **Resultado esperado:** Cada perfil só enxerga o que é seu; o motorista vê apenas as próprias sessões.

### UC-17 — Consultar o preço e a previsão (modelo de demanda)
- **Ator:** Motorista (preço) e Operador (previsão completa)
- **Pré-condição:** Backend no ar (sem ele, o app usa a cópia local do cálculo)
- **Fluxo principal:**
  1. O motorista vê a tarifa agora em Home/Preços/Configuração: `R$ 1,10 + R$ 0,90 × ocupação prevista`,
     entre R$ 1,10 e R$ 2,00, com a faixa (fora de ponta, intermediária ou ponta).
  2. O operador abre **IA & Previsão**: preço agora, ocupação e preço previstos por hora, alerta de
     saturação (ocupação prevista ≥ 90%), versão e métricas do modelo, e baixa `tarifas_horarias.csv`.
  3. O operador clica em **Retreinar modelo**: o backend treina de novo com o CSV do grupo e grava uma nova
     versão em `forecast_models`.
- **Fluxo alternativo:** Se o modelo falhar, o preço usa a curva horária de reserva e o comprovante indica a
  origem (`reserva`).
- **Resultado esperado:** O preço acompanha a demanda prevista e, se houver carga real maior que a prevista,
  a carga real prevalece. Limites do modelo: `../docs/MODELO_PREVISAO.md`.

### UC-18 — Recarga conduzida por OCPP
- **Ator:** Motorista (app) e carregador virtual (ou físico)
- **Pré-condição:** Motorista logado com veículo cadastrado; backend com `OCPP_SIMULATOR=true`
- **Fluxo principal:**
  1. O motorista escolhe o carregador e inicia (UC-12): o app cria a sessão e confirma o pagamento
     pré-autorizado (sandbox).
  2. O carregador envia `Authorize` (RFID) e `StartTransaction`. O backend só aceita se o pagamento está
     pré-autorizado (regra `S = A·B·C + M`); senão responde `Blocked`.
  3. O carregador envia `MeterValues` (energia, potência, SoC). O app acompanha a tela de recarga (UC-13) com
     esses números.
  4. O motorista finaliza: o pagamento é concluído, o carregador envia `StopTransaction` e o comprovante é gerado.
  5. O operador vê cada mensagem em **Logs OCPP** (UC-04) e a sessão no Faturamento.
  6. No encerramento o backend confere o valor com a **energia e o tempo finais** (uma leitura do medidor
     pode chegar junto com o pagamento, ou o carro pode ficar parado depois de encher). Se mudou, grava o
     evento `amount_adjusted`; no sandbox o pagamento acompanha o valor final, e com provedor real a
     diferença fica só registrada (`to_reconcile`).
- **Fluxo alternativo:** Pagamento recusado devolve erro 402 e a sessão não avança; carregador com falha
  (`StatusNotification` Faulted) passa a "manutenção".
- **Resultado esperado:** Uma sessão completa, rastreável do app ao banco, com o equipamento virtual falando
  o protocolo real.

### UC-19 — Acompanhar o medidor MODBUS
- **Ator:** Operador
- **Pré-condição:** Aba "Balanceamento"; backend com `MODBUS_SIMULATOR=true` (ou medidor real configurado)
- **Fluxo principal:**
  1. O cartão do medidor (`DashboardMeter`) mostra tensão, corrente, potência, frequência e energia lidos por
     MODBUS TCP, com o selo "Simulado".
  2. O balanceamento usa essa potência como carga do prédio (`building_source: modbus`).
- **Fluxo alternativo:** Se o medidor não responde, o balanceamento usa a carga do cenário (`cenario`, 120 kW).
- **Resultado esperado:** O operador vê de onde vem a carga base usada no cálculo dos 80 kW disponíveis.

### UC-20 — Gerenciar veículos no perfil
- **Ator:** Motorista
- **Pré-condição:** Motorista logado
- **Fluxo principal:**
  1. Em Perfil (`MobileProfile`), o motorista adiciona um veículo (placa e modelo) e remove os que
     não usa mais.
  2. O total gasto do motorista aparece no perfil.
- **Fluxo alternativo:** Placa inválida é rejeitada; veículo que já foi usado em uma sessão não pode ser
  removido (409), para preservar o histórico.
- **Resultado esperado:** As sessões saem vinculadas ao veículo escolhido.

### UC-21 — Ver o detalhamento do valor (tempo, potência e ociosidade)
- **Ator:** Motorista e Operador
- **Pré-condição:** Backend no ar (extensão aprovada, fora do playbook — ver `docs/TARIFA_TEMPO_E_OCIOSIDADE.md`)
- **Fluxo principal:**
  1. Na configuração da recarga (UC-12), a estimativa mostra energia, tempo e o custo total, e diz o
     preço do kWh **com o acréscimo do modo** escolhido (Rápido custa mais por kWh que o Econômico).
  2. Durante a recarga por OCPP (UC-18), o custo ao vivo soma energia e tempo de uso.
  3. Se a bateria chega a 100% e o carro continua no carregador além de uma tolerância inicial, a tela
     mostra um aviso de ociosidade e o custo passa a somar essa taxa também.
  4. No comprovante e no Faturamento, o valor aparece aberto em energia, tempo de uso e ociosidade.
  5. Em **IA & Previsão**, um cartão mostra o preço do kWh de cada modo.
- **Fluxo alternativo:** Sessões antigas (de antes desta extensão) continuam mostrando só o valor da
  energia, sem tempo nem ociosidade — não são recalculadas.
- **Resultado esperado:** O cliente entende por que dois modos com a mesma energia podem custar
  valores diferentes, e é desestimulado a deixar o carro parado no carregador depois de carregado.

### UC-22 — Acompanhar a pontuação de fidelidade
- **Ator:** Motorista
- **Pré-condição:** Motorista logado (extensão aprovada, só visual — ver `docs/PONTUACAO_FIDELIDADE.md`)
- **Fluxo principal:**
  1. Em Perfil, um cartão mostra o total de pontos (10 por kWh carregado), a faixa atual
     (Bronze/Prata/Ouro) e quantos pontos faltam para a próxima.
  2. Uma barra mostra o progresso da meta da semana (3 recargas); ao bater a meta, ganha um bônus de 50
     pontos.
  3. O assistente responde perguntas como "quantos pontos eu tenho?".
- **Fluxo alternativo:** Motorista novo, sem sessões encerradas: 0 pontos, faixa Bronze.
- **Resultado esperado:** O motorista tem um motivo a mais para voltar ao mesmo local, sem que isso
  mude o preço que ele paga.
