# ChargeGrid | Etapa 5 da proposta: IA no preço e protocolos abertos

Complemento à **Proposta de Evolução Técnica** (13/09/2026). Documento para alinhamento com o Scrum Master.
Equipe ChargeGrid · EV Challenge FIAP 2026 | GoodWe Brasil · trilha ChargeGrid Intelligence

## Por que uma Etapa 5

O playbook oficial do desafio, lido depois da proposta, pede para a trilha ChargeGrid Intelligence:
- **IA como motor lógico da solução** (previsão de demanda e tarifação dinâmica), e não como recurso de interface;
- **protocolos abertos** (OCPP e MODBUS) como base de integração com o equipamento.

Nenhum dos dois estava no roadmap original (Etapas 0 a 4). Registrar como etapa nova deixa claro que o escopo cresceu para atender ao playbook, sem alterar o que já foi combinado.

## Objetivo

Trocar o preço fixo por horário por um preço calculado por um modelo de previsão de demanda, e trocar o "controlador simulado" por um carregador virtual que fala OCPP 1.6J de verdade, lido por um medidor MODBUS, de modo que o equipamento físico possa ser conectado depois sem mudar o sistema.

## Entregáveis

| # | Entregável | Critério de conclusão |
|---|---|---|
| 5.1 | Modelo de previsão calibrado com o histórico do grupo (CSV da Sprint 04) e preço dinâmico entre R$ 1,10 e R$ 2,00 | Preço travado na sessão com origem e ocupação; tela de IA com previsão do dia; métricas honestas documentadas |
| 5.2 | Servidor OCPP 1.6J (CSMS) validado pelo esquema oficial, com log de todas as mensagens | Uma sessão completa (Authorize, StartTransaction, MeterValues, StopTransaction) visível na tela Logs OCPP |
| 5.3 | Carregadores virtuais que falam OCPP | Recarga conduzida pelo carregador, com energia medida por ele |
| 5.4 | Medidor MODBUS TCP simulado e leitor | Balanceamento usando a leitura do medidor; selo "Simulado" |
| 5.5 | Camada de pagamentos com provedor trocável | Provedor sandbox atual e recusa/pendência tratadas; troca por provedor real sem mexer no resto |
| 5.6 | Login real (motorista e operador) | Console e app exigem autenticação; contas de operador definidas pelo administrador |
| 5.7 | Documentação: fluxo de dados, modelo, matriz de aderência, roteiro | Pasta `docs/` do repositório |
| 5.8 | Tarifa por tempo de uso e por potência do modo, com ociosidade e teto por kWh *(ideia do próprio grupo, não pedida pelo playbook nem pela proposta original)* | Valor da sessão detalhado (energia/tempo/ociosidade) no comprovante; `docs/TARIFA_TEMPO_E_OCIOSIDADE.md` |
| 5.9 | Pontuação de fidelidade do motorista (consumo + regularidade semanal), só visual *(idem, ideia do grupo)* | Cartão de pontos e faixa no Perfil do app; `docs/PONTUACAO_FIDELIDADE.md` |
| 5.10 | Energy Autopilot: agendamento de recarga por horário de saída, olhando preço e solar previstos *(ideia do grupo — o pilar "controle de demanda" do playbook, levado a serio)* | Plano por blocos de 15 min com meta garantida/pico evitado; `GET /sessions/{id}/schedule`; `docs/ENERGY_AUTOPILOT.md` |
| 5.11 | Correção das descrições dos modos de recarga (Econômico/Sustentável/Garantido passam a fazer de verdade o que já prometiam) | Mesmo texto da tela, agora comportamento real por trás |

## Estado

Os itens 5.1 a 5.11 estão **implementados e testados** (testes automáticos do backend e do frontend, e uma recarga completa verificada de ponta a ponta contra o Supabase). Falta publicar (Vercel e Render).

Os itens 5.8 a 5.11 foram adicionados **depois** da aprovação inicial da Etapa 5: não vêm do playbook da
GoodWe nem da proposta original, são ideias comerciais do próprio grupo para reforçar a camada de
tarifação, retenção de cliente e controle de demanda. Por isso ficam destacados aqui, para o Scrum
Master decidir se entram no escopo da banca.

## Riscos e controles

| Risco | Controle |
|---|---|
| Parecer que há equipamento físico | Tudo que é virtual aparece como "simulado" na interface e na API; o protocolo é real, o equipamento não |
| IA apresentada como mais do que é | Documentado como modelo estatístico calibrado com dados de **um veículo**; erro diário e limites descritos em `docs/MODELO_PREVISAO.md` |
| Suposições de cenário parecerem dados reais | 200 kW contratados, 120 kW de prédio e ocupação de 0,80 são declarados como suposição e ajustáveis por variável de ambiente |
| Mapa de registradores MODBUS e ficha do carregador desconhecidos | Marcados como "assumidos" até haver o manual do equipamento da FIAP |
| Dependência de credenciais da GoodWe | Segue como na proposta: adaptador simulado com a mesma interface; troca quando o acesso for liberado |
| Energy Autopilot parecer usar a mensagem OCPP de agendamento (`SetChargingProfile`) | Não usa: o backend controla o carregador virtual diretamente. Documentado como próximo passo em `docs/ENERGY_AUTOPILOT.md` |
| "Economia" do Energy Autopilot parecer desconto no preço por kWh | O preço por kWh é travado no início e não muda; a economia vem só da ociosidade evitada (real) — detalhado em `docs/ENERGY_AUTOPILOT.md` |

## Decisão solicitada ao Scrum Master

1. Aprovar a Etapa 5 como parte do escopo da próxima banca.
2. Confirmar que **carregador e medidor virtuais**, declarados como simulados, atendem ao pilar "protocolos abertos" enquanto não houver equipamento físico.
3. Indicar o responsável pelo contato com FIAP/GoodWe para as validações da Etapa 0 (credenciais, ficha técnica do carregador, mapa de registradores do medidor).
4. Aprovar (ou não) os itens 5.8 a 5.11 (tarifa por tempo/potência, pontuação de fidelidade e o
   Energy Autopilot) como parte do escopo apresentado à banca, já que são ideias do grupo e não
   pedidos externos.
