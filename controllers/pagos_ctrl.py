import os
import requests
from fastapi import HTTPException
from sqlalchemy.orm import Session

# Importamos tus modelos recién mudados
from models.modelos import Vendedor, Orden
# Importamos tu adaptador de MP que ya funcionaba
from src.infrastructure.mercadopago.adaptador import generar_link_de_pago

def vincular_vendedor_ctrl(code: str, db: Session):
    url = "https://api.mercadopago.com/oauth/token"
    datos_para_mp = {
        "client_secret": os.getenv("MP_CLIENT_SECRET"),
        "client_id": os.getenv("MP_CLIENT_ID"),
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": "https://motor-de-pagos-api.onrender.com/callback" 
    }
    
    respuesta = requests.post(url, data=datos_para_mp)
    tokens = respuesta.json()
    
    if "access_token" not in tokens:
        return {"status": "error", "mensaje": "Falló la vinculación", "detalle": tokens}
        
    nuevo_vendedor = Vendedor(
        mp_access_token=tokens["access_token"],
        mp_refresh_token=tokens["refresh_token"]
    )
    db.add(nuevo_vendedor)
    db.commit()
    db.refresh(nuevo_vendedor)
    
    return {
        "status": "success",
        "mensaje": "✅ ¡Cuenta vinculada!",
        "vendedor_id_interno": nuevo_vendedor.id
    }

def crear_orden_ctrl(monto: float, concepto: str, vendedor_id: int, moneda: str, db: Session):
    vendedor = db.query(Vendedor).filter(Vendedor.id == vendedor_id).first()
    if not vendedor:
        raise HTTPException(status_code=404, detail="Vendedor no encontrado")

    nueva_orden = Orden(
        monto=monto, concepto=concepto, punto_de_cobro_id=str(vendedor_id), moneda=moneda, estado="PENDIENTE"
    )
    db.add(nueva_orden)
    db.commit()
    db.refresh(nueva_orden) 

    link = generar_link_de_pago(
        monto=monto, concepto=concepto, access_token=vendedor.mp_access_token, 
        orden_id=nueva_orden.id, vendedor_id=vendedor_id
    )
    
    return {"status": "success", "link_de_pago": link, "orden_id": nueva_orden.id}

def procesar_pago_webhook_ctrl(body: dict, vendedor_id: int, db: Session):
    if body.get("action") == "payment.created" or body.get("type") == "payment":
        payment_id = body.get("data", {}).get("id")

        vendedor = db.query(Vendedor).filter(Vendedor.id == vendedor_id).first()
        if vendedor and payment_id:
            url = f"https://api.mercadopago.com/v1/payments/{payment_id}"
            headers = {"Authorization": f"Bearer {vendedor.mp_access_token}"}
            respuesta_mp = requests.get(url, headers=headers).json()

            if respuesta_mp.get("status") == "approved":
                orden_id = int(respuesta_mp.get("external_reference"))
                orden = db.query(Orden).filter(Orden.id == orden_id).first()
                if orden and orden.estado == "PENDIENTE":
                    orden.estado = "PAGADA"
                    db.commit()
                    print(f"🎉 ¡DINERO RECIBIDO! Orden {orden.id} cobrada exitosamente.")
                    
    return {"status": "ok"}