import os
from dotenv import load_dotenv
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session

# Importamos todas nuestras piezas
from src.infrastructure.database.db_config import engine, get_db, Base
from src.infrastructure.database.repository import PostgresRepository
from src.infrastructure.mercadopago.adaptador import MercadoPagoAdaptador
from src.application.servicios import ServicioDePagos

# 1. ¡Abrimos la caja fuerte invisible (.env)!
load_dotenv()

# 2. Preparamos la base de datos
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Motor de Pagos con Mercado Pago")

@app.post("/ordenes")
async def crear_nueva_orden(monto: float, concepto: str, punto_de_cobro: str, db: Session = Depends(get_db)):
    # 3. Armamos las piezas
    repo = PostgresRepository(db)
    
    # 4. Buscamos el token en la caja fuerte y creamos el adaptador de Mercado Pago
    token = os.getenv("MP_ACCESS_TOKEN")
    proveedor_mp = MercadoPagoAdaptador(token)
    
    # 5. Le pasamos ambas herramientas a nuestro Director
    servicio = ServicioDePagos(repo, proveedor_mp)
    
    # 6. Ejecutamos la acción
    orden = await servicio.crear_orden(monto, concepto, punto_de_cobro)
    
    return {"mensaje": "¡Orden guardada y enviada a Mercado Pago!", "orden": orden}