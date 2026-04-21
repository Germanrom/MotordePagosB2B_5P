from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.infrastructure.database.db_config import engine, Base

# Importamos las rutas
from routes.api_routes import router as api_router

# 1. INICIALIZAMOS FASTAPI
app = FastAPI(title="Motor de Pagos API", version="2.0.0")

# --- NUEVO: CONFIGURACIÓN DE CORS (Permisos de frontera) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # El "*" significa que permitimos que CUALQUIER web nos hable
    allow_credentials=True,
    allow_methods=["*"],  # Permite GET, POST, PUT, DELETE
    allow_headers=["*"],  # Permite enviar la API Key secreta
)
# -----------------------------------------------------------

# 2. SINCRONIZAMOS LA BASE DE DATOS
Base.metadata.create_all(bind=engine)

# 3. CONECTAMOS LAS RUTAS
app.include_router(api_router)