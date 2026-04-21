from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from src.infrastructure.database.db_config import get_db
# Importamos la lógica desde nuestro nuevo controlador
from controllers.pagos_ctrl import vincular_vendedor_ctrl, crear_orden_ctrl, procesar_pago_webhook_ctrl

# Creamos el enrutador
router = APIRouter()

@router.get("/callback")
def mercadopago_callback(code: str, db: Session = Depends(get_db)):
    # Derivamos el trabajo al controlador
    return vincular_vendedor_ctrl(code, db)

@router.post("/ordenes")
def crear_orden(monto: float, concepto: str, vendedor_id: int, moneda: str = "ARS", db: Session = Depends(get_db)):
    # Derivamos el trabajo al controlador
    return crear_orden_ctrl(monto, concepto, vendedor_id, moneda, db)

@router.post("/webhook")
async def recibir_webhook(request: Request, vendedor_id: int, db: Session = Depends(get_db)):
    # Extraemos el body y se lo pasamos al controlador
    body = await request.json()
    return procesar_pago_webhook_ctrl(body, vendedor_id, db)