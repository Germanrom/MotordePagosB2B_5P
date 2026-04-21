import os
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Request, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from sqlalchemy.orm import Session

from src.infrastructure.database.db_config import get_db
from controllers.pagos_ctrl import vincular_vendedor_ctrl, crear_orden_ctrl, procesar_pago_webhook_ctrl, enviar_email_ctrl

router = APIRouter()

# --- CONFIGURACIÓN DEL GUARDIA DE SEGURIDAD (API KEY) ---
# Le decimos que busque la llave en el encabezado de la petición bajo el nombre "X-API-Key"
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

def verificar_api_key(api_key: str = Security(api_key_header)):
    llave_correcta = os.getenv("MI_API_KEY_MAESTRA")
    if api_key != llave_correcta:
        # Si la llave no coincide, lo echamos con un Error 401
        raise HTTPException(status_code=401, detail="Acceso denegado: API Key incorrecta")
    return api_key

# --- RUTAS ---

# PÚBLICA: Mercado Pago redirige al usuario acá (no podemos pedirle API Key al usuario común)
@router.get("/callback")
def mercadopago_callback(code: str, db: Session = Depends(get_db)):
    return vincular_vendedor_ctrl(code, db)

# PRIVADA: Solo nuestro Frontend o sistemas autorizados pueden pedir links de cobro
# Agregamos Depends(verificar_api_key) para protegerla
@router.post("/ordenes", dependencies=[Depends(verificar_api_key)])
def crear_orden(monto: float, concepto: str, vendedor_id: int, moneda: str = "ARS", db: Session = Depends(get_db)):
    return crear_orden_ctrl(monto, concepto, vendedor_id, moneda, db)

# PÚBLICA (Pero validada por MP): Mercado Pago nos avisa por acá cuando alguien paga
@router.post("/webhook")
async def recibir_webhook(request: Request, vendedor_id: int, db: Session = Depends(get_db)):
    body = await request.json()
    return procesar_pago_webhook_ctrl(body, vendedor_id, db)

# Molde de datos que esperamos recibir del Frontend
class DatosEmail(BaseModel):
    email_destino: str
    concepto: str
    monto: float
    link_pago: str

# Ruta protegida con tu API Key
@router.post("/enviar-email", dependencies=[Depends(verificar_api_key)])
def enviar_email_ruta(datos: DatosEmail):
    return enviar_email_ctrl(
        email_destino=datos.email_destino,
        concepto=datos.concepto,
        monto=datos.monto,
        link_pago=datos.link_pago
    )