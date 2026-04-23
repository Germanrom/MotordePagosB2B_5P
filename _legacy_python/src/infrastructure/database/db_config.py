import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Abrimos la caja fuerte
load_dotenv()

# 2. Buscamos la URL de Supabase
DATABASE_URL = os.getenv("DATABASE_URL")

# 3. Conectamos el motor (A Postgres no le hace falta el "check_same_thread" de SQLite)
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()