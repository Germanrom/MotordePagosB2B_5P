import os
import requests
from fastapi import FastAPI, Depends, HTTPException, Request
from sqlalchemy import Column, Integer, String, Float
from sqlalchemy.orm import Session

# Importaciones de tu infraestructura
from src.infrastructure.database.db_config import engine, get_db, Base
from src.infrastructure.mercadopago.adaptador import generar_link_de_pago

# 1. INICIALIZAMOS FASTAPI (UNA SOLA VEZ)
app = FastAPI(title="Motor de Pagos API", version="1.0.0")

# --- 2. DEFINICIÓN DE TABLAS EN BASE DE DATOS ---

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

# --- 3. RUTAS DE TU APLICACIÓN ---

@app.get("/callback")
def mercadopago_callback(code: str, db: Session = Depends(get_db)):
    # (Este código queda exactamente igual que antes, no cambia nada)
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
        
    nuevo_vendedor = Vendedor(mp_access_token=tokens["access_token"], mp_refresh_token=tokens["refresh_token"])
    db.add(nuevo_vendedor)
    db.commit()
    db.refresh(nuevo_vendedor)
    return {"status": "success", "mensaje": "✅ ¡Cuenta vinculada!", "vendedor_id_interno": nuevo_vendedor.id}

@app.post("/ordenes")
def crear_orden(monto: float, concepto: str, vendedor_id: int, moneda: str = "ARS", db: Session = Depends(get_db)):
    vendedor = db.query(Vendedor).filter(Vendedor.id == vendedor_id).first()
    if not vendedor:
        raise HTTPException(status_code=404, detail="Vendedor no encontrado")

    # 1. PRIMERO guardamos la orden para obtener su ID (Nace PENDIENTE)
    nueva_orden = Orden(
        monto=monto, concepto=concepto, punto_de_cobro_id=str(vendedor_id), moneda=moneda, estado="PENDIENTE"
    )
    db.add(nueva_orden)
    db.commit()
    db.refresh(nueva_orden) 

    # 2. SEGUNDO generamos el link pasándole el ID de la orden
    link = generar_link_de_pago(
        monto=monto, concepto=concepto, access_token=vendedor.mp_access_token, 
        orden_id=nueva_orden.id, vendedor_id=vendedor_id
    )
    
    return {"status": "success", "link_de_pago": link, "orden_id": nueva_orden.id}

# --- EL TELÉFONO ROJO (WEBHOOK) ---
@app.post("/webhook")
async def recibir_webhook(request: Request, vendedor_id: int, db: Session = Depends(get_db)):
    body = await request.json()

    # 1. MP nos avisa que se creó un pago
    if body.get("action") == "payment.created" or body.get("type") == "payment":
        payment_id = body.get("data", {}).get("id")

        vendedor = db.query(Vendedor).filter(Vendedor.id == vendedor_id).first()
        if vendedor and payment_id:
            
            # 2. Vamos a MP a verificar que sea real y ver si está aprobado
            url = f"https://api.mercadopago.com/v1/payments/{payment_id}"
            headers = {"Authorization": f"Bearer {vendedor.mp_access_token}"}
            respuesta_mp = requests.get(url, headers=headers).json()

            if respuesta_mp.get("status") == "approved":
                # 3. Extraemos el DNI de la orden que le pasamos al crear el link
                orden_id = int(respuesta_mp.get("external_reference"))

                # 4. ¡MAGIA! Buscamos la orden y le cambiamos el estado
                orden = db.query(Orden).filter(Orden.id == orden_id).first()
                if orden and orden.estado == "PENDIENTE":
                    orden.estado = "PAGADA"
                    db.commit()
                    print(f"🎉 ¡DINERO RECIBIDO! Orden {orden.id} cobrada exitosamente.")

    # MP solo necesita que le respondamos un "OK 200" para saber que atendimos el teléfono
    return {"status": "ok"}