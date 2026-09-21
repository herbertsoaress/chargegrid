from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

_is_sqlite = settings.sqlalchemy_url.startswith("sqlite")

if _is_sqlite:
    engine = create_engine(settings.sqlalchemy_url, connect_args={"check_same_thread": False})
else:
    # pool_pre_ping evita erro quando o Supabase/pooler derruba conexoes ociosas.
    engine = create_engine(
        settings.sqlalchemy_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        pool_recycle=1800,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
