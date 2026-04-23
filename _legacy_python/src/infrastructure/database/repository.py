from sqlalchemy.orm import Session
from src.domain.models import OrdenDeCobro
from src.infrastructure.database.models import OrdenTable

class PostgresRepository:
    def __init__(self, db: Session):
        self.db = db

    def guardar(self, orden: OrdenDeCobro):
        db_orden = OrdenTable(
            id=str(orden.id),
            monto=orden.monto,
            moneda=orden.moneda,
            concepto=orden.concepto,
            estado=orden.estado,
            punto_de_cobro_id=orden.punto_de_cobro_id
        )
        self.db.add(db_orden)
        self.db.commit()
        return orden
