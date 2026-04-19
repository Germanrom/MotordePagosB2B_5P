from sqlalchemy import Column, String, Float
from src.infrastructure.database.db_config import Base

class OrdenTable(Base):
    __tablename__ = "ordenes"

    id = Column(String, primary_key=True, index=True)
    monto = Column(Float)
    moneda = Column(String)
    concepto = Column(String)
    estado = Column(String)
    punto_de_cobro_id = Column(String)
