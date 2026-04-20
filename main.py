import os
import requests # <-- Importante
from fastapi import FastAPI, Depends
from sqlalchemy import Column, Integer, String, Float
from sqlalchemy.orm import Session
from src.infrastructure.database.db_config import engine, get_db, Base
from src.infrastructure.mercadopago.adaptador import generar_link_de_pago

# --- 1. NUEVA TABLA: VENDEDORES ---
class Vendedor(Base):
    __tablename__ = "vendedores"
    
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, default="Comercio Generico")
    mp_access_token = Column(String)  
    mp_refresh_token = Column(String) 

Base.metadata.create_all(bind=engine)

# --- 2. LA RUTA RECEPTORA (OAUTH) ---
@app.get("/callback")
def mercadopago_callback(code: str, db: Session = Depends(get_db)):
    url = "https://api.mercadopago.com/oauth/token"
    datos_para_mp = {
        "client_secret": os.getenv("MP_CLIENT_SECRET"),
        "client_id": os.getenv("MP_CLIENT_ID"),
        "grant_type": "authorization_code",
        "code": code,
        # 👇 Esta URL DEBE coincidir con la que pusiste en Mercado Pago
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

# 1. Definimos la estructura EXACTA de tu tabla en Supabase
class Orden(Base):
    __tablename__ = "ordenes"
    
    id = Column(Integer, primary_key=True, index=True)
    monto = Column(Float)
    moneda = Column(String, default="ARS")       # Por defecto será Pesos Argentinos
    concepto = Column(String, index=True)
    estado = Column(String, default="PENDIENTE") # Nace pendiente hasta que paguen
    punto_de_cobro_id = Column(String)           # Usamos String por si tiene letras (ej: "SUC-01")

# 2. Le decimos a SQLAlchemy que sincronice con la DB
Base.metadata.create_all(bind=engine)

# 3. Inicializamos la aplicación FastAPI
app = FastAPI(title="Motor de Pagos API", version="1.0.0")

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
        estado="PENDIENTE" # Se crea esperando el pago
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