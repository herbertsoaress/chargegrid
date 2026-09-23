from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "troque-esta-chave-em-producao"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "development" | "production". Em production o backend NAO cria tabelas sozinho
    # (o schema vem da migration do Supabase) e recusa subir com SECRET_KEY padrao.
    app_env: str = "development"

    # SQLite local por padrao; para o Supabase use a connection string do Postgres.
    database_url: str = "sqlite:///./chargegrid.db"

    secret_key: str = DEFAULT_SECRET_KEY
    access_token_expire_minutes: int = 1440

    # Origens permitidas no CORS, separadas por virgula.
    frontend_origins: str = "http://localhost:5173,http://localhost:8080"

    # Contas de demonstracao (operador/motorista). Desligue ambas em ambiente publico.
    seed_demo_data: bool = True
    allow_demo_login: bool = True

    # E-mails (separados por virgula) que viram "operador" ao se cadastrar.
    # Qualquer outro cadastro vira "motorista".
    operator_emails: str = ""

    # Sessao aberta ha mais que isso (minutos) e encerrada automaticamente ao tentar
    # reservar o mesmo carregador (evita carregador preso por sessao abandonada).
    session_ttl_minutes: int = 120

    # Provedor de pagamento (services/payments.py). "sandbox" = aprovacao simulada, sem cobranca real.
    payment_provider: str = "sandbox"

    # ---- OCPP 1.6J (protocolo aberto dos carregadores): o backend e o CSMS (sistema central) ----
    # Endpoint WebSocket: /ocpp/{codigo-do-carregador}, ex.: ws://localhost:8000/ocpp/CG-001
    ocpp_enabled: bool = True
    # Senha compartilhada (HTTP Basic: usuario = codigo do carregador). Vazio = sem senha (so em desenvolvimento).
    ocpp_shared_token: str = ""
    ocpp_heartbeat_interval: int = 30  # segundos, informado ao carregador no BootNotification
    ocpp_message_retention_days: int = 7  # mensagens OCPP mais antigas sao apagadas na subida
    # Carregadores VIRTUAIS (hardware simulado): sobem junto com o backend e falam OCPP de verdade.
    ocpp_simulator: bool = False
    ocpp_simulator_url: str = "ws://127.0.0.1:8000"  # onde o proprio backend esta escutando
    ocpp_simulator_speedup: float = 60.0  # 60 = cada segundo real vale 1 minuto de recarga
    ocpp_simulator_meter_interval_s: float = 2.0  # segundos reais entre MeterValues
    ocpp_simulator_poll_s: float = 1.0  # a cada quanto o carregador virtual olha o banco (sessao nova, fim...)

    # ---- MODBUS TCP: medidor de energia do local (SIMULADO) ----
    modbus_simulator: bool = False
    modbus_host: str = "127.0.0.1"
    modbus_port: int = 5020
    modbus_unit_id: int = 1

    # Cenario de referencia do local (declarado como SUPOSICAO na documentacao): potencia contratada
    # com a distribuidora e carga base do predio sem os carros. O que sobra e a capacidade para EVs.
    site_contracted_kw: float = 200.0
    site_base_load_kw: float = 120.0
    # Capacidade de pico da usina solar do local (kW), meio-dia. SIMULADA (nao ha telemetria real
    # de inversor solar disponivel). Fonte unica para o balanceamento e para o agendamento de
    # recarga (services/solar.py) -- ver docs/ENERGY_AUTOPILOT.md.
    solar_capacity_kw: float = 18.0

    # Modelo de previsao de demanda / preco dinamico (services/forecast.py e pricing.py).
    # Ocupacao da capacidade para carros num dia util ao meio-dia (0 a 1). E uma SUPOSICAO de cenario:
    # o CSV de um unico veiculo calibra o padrao semanal, nao o tamanho do local.
    peak_occupancy_ref: float = 0.80
    # Ocupacao prevista a partir da qual o painel avisa "saturacao prevista".
    saturation_threshold: float = 0.90
    # CSV de historico usado no treino (relativo a pasta backend/ se nao for absoluto).
    forecast_csv_path: str = "data/fase1-base_de_dados-final.csv"

    # ---- Tarifacao por tempo de uso e por potencia (extensao aprovada pelo grupo, fora do playbook e
    # da proposta original -- ver docs/ETAPA_5_PROPOSTA.md). Tudo TRAVADO na abertura da sessao: mudar
    # estas variaveis so afeta sessoes novas. ----
    # R$ por minuto de recarga. O "tempo de recarga" e a energia entregue dividida pela potencia
    # nominal do modo (a mesma conta que a tela do app usa pra estimar o tempo), nao o relogio de
    # parede -- assim nao depende de SIM_TIME_SCALE nem do acelerador do carregador virtual.
    time_rate_per_minute: float = 0.03
    # Acrescimo no preco do kWh por modo (potencia maior = mais caro). "rapido" usa 100% da potencia
    # do carregador; os outros usam menos (ver services/simulator.py: MODE_FACTOR).
    mode_surcharge_economico: float = 0.00
    mode_surcharge_sustentavel: float = 0.05
    mode_surcharge_garantido: float = 0.10
    mode_surcharge_rapido: float = 0.15
    # Taxa por minuto parado com a bateria cheia (depois da carencia): desestimula deixar o carro
    # ocupando a vaga sem carregar. So conta em ambiente com telemetria de SoC (OCPP ou app local).
    idle_rate_per_minute: float = 0.10
    idle_grace_minutes: float = 10.0
    # Teto do preco medio por kWh entregue (energia + tempo + ociosidade, dividido pelos kWh): protege
    # o cliente de uma sessao muito lenta ou muito parada custar um preco por kWh sem limite.
    price_cap_per_kwh: float = 2.20

    # Fuso usado para "hora do dia" (tarifa dinamica, curvas de potencia, "hoje").
    app_timezone: str = "America/Sao_Paulo"

    # Fator de aceleracao da simulacao de energia (1 = tempo real).
    sim_time_scale: float = 1.0

    # GoodWe OpenAPI (opcional). Sem estas variaveis o adaptador simulado e usado.
    goodwe_app_id: str = ""
    goodwe_app_secret: str = ""
    goodwe_base_url: str = "https://us.semsportal.com"

    # Assistente com IA generativa (Gemini). Sem GEMINI_API_KEY o assistente responde por
    # regras (ver app/routers/ai_assistant.py). A chave fica SO aqui no backend.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    # Tokens de "raciocinio" do modelo. 0 = desligado (respostas rapidas e sem cortar o texto, ja que
    # o raciocinio consome o limite de saida). Use -1 para nao enviar o campo (modelos que nao aceitam 0).
    gemini_thinking_budget: int = 0
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    ai_timeout_seconds: float = 20.0
    # Limite de perguntas por usuario por minuto que podem ir para a IA (protege a cota/custo).
    ai_rate_limit_per_minute: int = 20

    @property
    def ev_capacity_kw(self) -> float:
        """Potencia disponivel para carregar carros (contratada - carga base do predio)."""
        return max(0.0, self.site_contracted_kw - self.site_base_load_kw)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def operator_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.operator_emails.split(",") if e.strip()}

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def sqlalchemy_url(self) -> str:
        """Normaliza a URL colada do painel do Supabase (postgres:// ou postgresql://)."""
        url = self.database_url.strip()
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg2://" + url[len("postgresql://") :]
        return url


settings = Settings()
