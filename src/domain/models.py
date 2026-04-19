from pydantic import BaseModel, Field
from enum import Enum
from uuid import UUID, uuid4

class EstadoPago(str, Enum):
    PENDIENTE = "PENDIENTE"
    APROBADO = "APROBADO"
    RECHAZADO = "RECHAZADO"

class OrdenDeCobro(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    monto: float
    moneda: str = "ARS"
    concepto: str
    estado: EstadoPago = EstadoPago.PENDIENTE
    punto_de_cobro_id: str
