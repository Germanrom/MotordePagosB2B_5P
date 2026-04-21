from fastapi import FastAPI
from src.infrastructure.database.db_config import engine, Base

# Importamos las rutas desde su nueva carpeta
from routes.api_routes import router as api_router

# 1. INICIALIZAMOS FASTAPI
app = FastAPI(title="Motor de Pagos API", version="2.0.0")

# 2. SINCRONIZAMOS LA BASE DE DATOS
Base.metadata.create_all(bind=engine)

# 3. CONECTAMOS LAS RUTAS (Le decimos a FastAPI que use las puertas que creamos)
app.include_router(api_router)