# Energy Autopilot: agendamento de recarga por horário de saída

**Extensão aprovada pelo grupo**, além do playbook da GoodWe e da Proposta de Evolução Técnica
original (ver [`ETAPA_5_PROPOSTA.md`](ETAPA_5_PROPOSTA.md), itens 5.10 e 5.11). É a peça que faz o
sistema **decidir como carregar**, não só cobrar certo por isso — o pilar "controle de demanda" do
playbook, levado a sério.

Código: `backend/app/services/scheduler.py` (o motor) e `backend/app/services/solar.py` (a curva
solar). Endpoint: `GET /sessions/{id}/schedule`. Testes: `backend/tests/test_scheduler.py` e os
testes de potência variável em `backend/tests/test_virtual_charger.py`.

## 1. O que muda

Antes desta extensão, cada modo de recarga usava uma **fração fixa de potência** a sessão inteira.
As descrições da tela já prometiam mais do que isso ("Econômico: carrega quando a demanda é
menor", "Sustentável: prioriza energia solar", "Garantido: garante % no horário informado") — só
que **nada olhava a meta de bateria nem o horário de saída** para decidir a potência. Esta extensão
faz essas três descrições passarem a ser verdade.

Cada modo agora é uma **política** sobre o mesmo motor de agendamento (só quando a sessão informa
horário de saída; sem isso, continua na potência fixa de antes):

| Modo | O que faz |
|---|---|
| **Rápido** | Sem agenda: potência máxima do carregador o tempo todo (igual a antes). |
| **Econômico** | Carrega nos blocos de **menor ocupação prevista** (mais baratos). Nunca usa um bloco de pico previsto — mesmo que isso signifique não bater a meta. |
| **Sustentável** | Carrega nos blocos com **sobra de energia solar** prevista. Também nunca usa um bloco de pico. |
| **Garantido** | Tenta os blocos mais baratos primeiro; se isso **não bastar** para chegar à meta no horário, usa também os blocos de pico que precisar — a "rede de segurança" que dá nome ao modo. |

## 2. Como funciona

1. O tempo entre agora e o horário de saída é dividido em **blocos de 15 minutos** (no máximo 12h
   à frente, para não planejar um dia inteiro por engano).
2. Para cada bloco, o sistema já sabe: a ocupação prevista da rede (o mesmo modelo do preço — ver
   [`MODELO_PREVISAO.md`](MODELO_PREVISAO.md)) e a geração solar prevista ([`services/solar.py`](../backend/app/services/solar.py),
   simulada, mesma curva usada no Balanceamento).
3. Calcula a energia que falta (`meta% − nível atual%`, na capacidade da bateria) e quantos blocos
   seriam necessários para entregá-la **na potência do próprio modo** (a mesma fração fixa de
   antes desta extensão — Garantido 85%, Sustentável 75%, Econômico 55% da potência do carregador),
   não na potência crua do carregador. Isso mantém o ritmo de cada modo consistente o tempo todo,
   inclusive nos blocos de pico que o Garantido usa como rede de segurança — só o **horário**
   escolhido muda por bloco, nunca a velocidade.
4. Escolhe os blocos conforme a política do modo (tabela acima).
5. Devolve um resumo: meta garantida ou não, se algum pico foi evitado, quanta energia caiu em
   blocos com sol, e — só para o Garantido — quanto se economiza em ociosidade por não terminar
   cedo demais e ficar parado (ver seção 4).

### Exemplo (o mesmo do pedido do grupo)

Chegada às 14h, bateria em 32%, meta 85%, saída às 18h30, carregador de 22 kW, modo Garantido
(85% da potência = 18,7 kW). Com um pico previsto das 16h às 17h:

- Energia necessária: (85−32)% × 60 kWh ≈ 31,8 kWh → 7 blocos de 15 min a 18,7 kW (4,675 kWh cada).
- Como sobra tempo fora do horário de pico, o **Garantido evita o pico por completo** e ainda
  cumpre a meta — resultado conferido rodando o motor de verdade (não é só a conta no papel).
- Se o horário de saída fosse bem mais apertado (por exemplo, só até as 16h), o Garantido usaria
  parte do horário de pico para não perder o prazo — e o Econômico, no mesmo aperto, ficaria só com
  os blocos baratos e avisaria honestamente que não vai bater a meta.

## 3. O relógio do plano (por que a demonstração não precisa esperar 4h30)

Para demonstrar um plano das 14h às 18h30 seria preciso esperar 4h30 de verdade. Por isso o plano
usa o **mesmo acelerador da simulação** (`OCPP_SIMULATOR_SPEEDUP`, padrão 60×): o relógio do plano
anda 60 vezes mais rápido que o relógio real a partir do momento em que a energia é liberada. Um
plano de 4h30 "de plano" passa em cerca de 4,5 minutos reais. Num carregador físico de verdade
(`OCPP_SIMULATOR_SPEEDUP=1`), o relógio do plano é o próprio relógio real, e o plano corre nas horas
certas.

O carregador virtual (real ou não) **acompanha o plano de verdade**: a cada instante, ele entrega a
potência que o bloco atual manda — a energia é somada aos poucos, não vem de uma fórmula fechada
como no modo Rápido (que sempre usa a mesma potência). Isso significa que, ao vivo, dá para ver a
potência subir e descer conforme o plano decide.

## 4. Honestidade sobre "quanto se economiza"

O preço por kWh da sessão é **travado no início** (ver [`TARIFA_TEMPO_E_OCIOSIDADE.md`](TARIFA_TEMPO_E_OCIOSIDADE.md))
e não muda durante a sessão — então, ao contrário do que se poderia imaginar, **carregar num
horário mais barato não reduz o preço por kWh que o motorista paga nesta sessão** (ele já foi
fixado). Por isso o "economizado" que o Energy Autopilot mostra vem de onde realmente afeta a
conta:

- **Ociosidade evitada** (Garantido): se o carro carregasse tudo de uma vez, terminaria muito antes
  da saída e ficaria parado, acumulando a taxa de ociosidade (depois da carência) até o motorista
  voltar. O Garantido evita isso pausando (ou usando menos blocos) e terminando perto do horário —
  esse valor É cobrado a menos de verdade, e aparece como `idle_savings_rs`.
- **Pico evitado**: um benefício do **operador** (protege o limite contratado do local), não uma
  redução na conta do motorista — mostrado como selo, não como R$.
- **% de energia solar**: informativo (mostra que parte da recarga caiu num horário de sol
  previsto), também não muda o preço.

Se um dia o preço por kWh passar a variar POR BLOCO dentro da mesma sessão (hoje não varia), o
"economizado" também passaria a valer para a energia — não é o caso hoje, e o app não afirma isso.

## 5. Limites (dizer com clareza)

- A geração solar é **simulada** (curva `18 × sen(π×hora/24)`, pico ao meio-dia) — não há
  telemetria real de inversor solar disponível. A mesma curva alimenta o Balanceamento e o
  agendamento, para as duas telas nunca mostrarem números de solar que não batem entre si.
- O "kWh de sol aproveitado" conta o bloco inteiro como solar quando há qualquer geração prevista
  naquele horário — não é uma medição real de quanto da energia veio do sol.
- Só funciona em sessões conduzidas por OCPP (carregador real ou virtual) com horário de saída
  informado; sem isso, o modo cai na potência fixa de antes.
- Não está no playbook da GoodWe nem na proposta original: é uma extensão comercial do grupo,
  pensada para cumprir de verdade o que os nomes dos modos já prometiam.
- A mensagem OCPP `SetChargingProfile` (o jeito "oficial" do protocolo de mandar um cronograma de
  potência a um carregador) **não foi implementada**: o backend decide e aplica a potência
  diretamente no carregador virtual que ele mesmo controla. Um carregador físico de terceiros
  precisaria dessa mensagem para obedecer ao plano — fica como próximo passo.
