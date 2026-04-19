from fastapi import FastAPI, Depends
from sqlalchemy import Column, Integer, String, Float
from sqlalchemy.orm import Session
from src.infrastructure.database.db_config import engine, get_db, Base
from src.infrastructure.mercadopago.adaptador import generar_link_de_pago

# 1. Definimos la estructura de la tabla para Supabase
class Orden(Base):
    __tablename__ = "ordenes"
    
    # Podés agregarle más columnas en el futuro si lo necesitás
    id = Column(Integer, primary_key=True, index=True)
    concepto = Column(String, index=True)
    monto = Column(Float)
    punto_de_cobro = Column(String)

# 2. Le decimos a SQLAlchemy que cree la tabla en la nube si no existe
Base.metadata.create_all(bind=engine)

# 3. Inicializamos la aplicación FastAPI
app = FastAPI(title="Motor de Pagos API", version="1.0.0")

@app.post("/ordenes")
def crear_orden(monto: float, concepto: str, punto_de_cobro: str, db: Session = Depends(get_db)):
    
    # PASO A: Generamos el link de pago real comunicándonos con Mercado Pago
    link = generar_link_de_pago(monto=monto, concepto=concepto)
    
    # PASO B: Guardamos la orden en nuestra base de datos en Supabase
    nueva_orden = Orden(monto=monto, concepto=concepto, punto_de_cobro=punto_de_cobro)
    db.add(nueva_orden)
    db.commit()
    db.refresh(nueva_orden) # Refrescamos para obtener el ID que le asignó Supabase

    # PASO C: Devolvemos la respuesta final al usuario (Swagger/Frontend)
    return {
        "status": "success",
        "mensaje": "✅ ¡ÉXITO TOTAL! Orden guardada en la nube.",
        "detalle": {
            "id": nueva_orden.id,
            "concepto": nueva_orden.concepto,
            "monto": nueva_orden.monto,
            "punto_de_cobro": nueva_orden.punto_de_cobro
        },
        "link_de_pago": link
    }