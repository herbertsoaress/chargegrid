from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./chargegrid.db"
    secret_key: str = "troque-esta-chave-em-producao"
    access_token_expire_minutes: int = 1440
    goodwe_app_id: str = ""
    goodwe_app_secret: str = ""
    goodwe_base_url: str = "https://us.semsportal.com"
    frontend_origin: str = "http://localhost:5173"

    class Config:
        env_file = ".env"


settings = Settings()
