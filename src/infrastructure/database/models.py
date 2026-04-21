from sqlalchemy import Column, Integer, String, Float
from src.infrastructure.database.db_config import Base, engine

class Vendedor(Base):
    __tablename__ = "vendedores"
    
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, default="Comercio Generico")
    mp_access_token = Column(String)  
    mp_refresh_token = Column(String) 

class Orden(Base):
    __tablename__ = "ordenes"
    
    id = Column(Integer, primary_key=True, index=True)
    monto = Column(Float)
    moneda = Column(String, default="ARS")
    concepto = Column(String, index=True)
    estado = Column(String, default="PENDIENTE")
    punto_de_cobro_id = Column(String)

# Sincronizamos con Supabase (Crea las tablas si no existen)
Base.metadata.create_all(bind=engine)
