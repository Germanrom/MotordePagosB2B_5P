# 1. Elegimos una computadora base oficial y liviana con Python 3.11
FROM python:3.11-slim

# 2. Le decimos a la computadora dónde vamos a trabajar adentro
WORKDIR /app

# 3. Copiamos nuestra lista de compras y la instalamos
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copiamos todo el resto de nuestro código (el .dockerignore protege los secretos)
COPY . .

# 5. Exponemos el puerto 8000 para que el servidor pueda "escuchar"
EXPOSE 8000

# 6. El comando de encendido automático (igual al que usabas en la terminal)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]