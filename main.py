import os
import requests
from fastapi import FastAPI, Depends
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
        "mensaje": "✅ ¡Cuenta de Mercado Pago vinculada perfectamente!",
        "vendedor_id_interno": nuevo_vendedor.id
    }

@app.post("/ordenes")
def crear_orden(monto: float, concepto: str, punto_de_cobro_id: str, moneda: str = "ARS", db: Session = Depends(get_db)):
    # PASO A: Generamos el link de pago real comunicándonos con Mercado Pago
    link = generar_link_de_pago(monto=monto, concepto=concepto)
    
    # PASO B: Guardamos la orden en nuestra base de datos en Supabase con tus campos exactos
    nueva_orden = Orden(
        monto=monto, 
        concepto=concepto, 
        punto_de_cobro_id=punto_de_cobro_id,
        moneda=moneda,
        estado="PENDIENTE" 
    )
    db.add(nueva_orden)
    db.commit()
    db.refresh(nueva_orden) 

    # PASO C: Devolvemos la respuesta final al usuario con todos tus datos
    return {
        "status": "success",
        "mensaje": "✅ ¡ÉXITO TOTAL! Orden guardada en la nube.",
        "detalle": {
            "id": nueva_orden.id,
            "concepto": nueva_orden.concepto,
            "monto": nueva_orden.monto,
            "moneda": nueva_orden.moneda,
            "estado": nueva_orden.estado,
            "punto_de_cobro_id": nueva_orden.punto_de_cobro_id
        },
        "link_de_pago": link
    }