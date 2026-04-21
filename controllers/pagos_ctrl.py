import sys
import os

# Agregamos la raíz del proyecto al camino de búsqueda de Python
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import mercadopago
import requests

# Ahora lo importamos de forma que no haya duda

    from src.infrastructure.database.models import Vendedor, Orden
    from fastapi import HTTPException
from sqlalchemy.orm import Session
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

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

import mercadopago

def crear_orden_ctrl(monto, concepto, vendedor_id, moneda, db): # <-- Agregamos 'moneda' aquí
    from models import Vendedor, Orden 
    
    vendedor = db.query(Vendedor).filter(Vendedor.id == vendedor_id).first()
    
    if not vendedor:
        raise Exception("Vendedor no encontrado en la base de datos")

    # Guardamos la orden incluyendo la moneda que viene de la ruta
    nueva_orden = Orden(
        monto=monto,
        concepto=concepto,
        vendedor_id=vendedor_id,
        moneda=moneda, # <-- Ahora sí usamos el parámetro
        estado="PENDIENTE" 
    )
    db.add(nueva_orden)
    db.commit()
    db.refresh(nueva_orden)

    sdk = mercadopago.SDK(vendedor.mp_access_token)

    preference_data = {
        "items": [
            {
                "title": concepto,
                "quantity": 1,
                "unit_price": float(monto),
                "currency_id": moneda # Usamos la moneda que llegó (ARS, etc)
            }
        ],
        "external_reference": str(nueva_orden.id),
        "notification_url": f"https://motor-de-pagos-api.onrender.com/webhook?vendedor_id={vendedor_id}",
        "back_urls": {
            "success": "https://tu-sitio-o-agradecimiento.com",
            "failure": "https://tu-sitio-o-error.com",
        },
        "auto_return": "approved",
    }

    respuesta_mp = sdk.preference().create(preference_data)
    
    if "response" not in respuesta_mp:
        raise Exception("Error al crear la preferencia en Mercado Pago")

    link_pago = respuesta_mp["response"]["init_point"]

    return {
        "link_de_pago": link_pago,
        "id_orden": nueva_orden.id
    }

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

def enviar_email_ctrl(email_destino: str, concepto: str, monto: float, link_pago: str):
    remitente = os.getenv("SMTP_EMAIL")
    password = os.getenv("SMTP_PASSWORD")
    
    if not remitente or not password:
        return {"status": "error", "mensaje": "Credenciales de correo no configuradas en el servidor"}

    # 1. Armamos la estructura del correo
    msg = MIMEMultipart()
    msg['From'] = remitente
    msg['To'] = email_destino
    msg['Subject'] = f"Link de Pago seguro - {concepto}"

    # 2. Diseñamos el cuerpo del mensaje (HTML básico para que se vea lindo)
    cuerpo_html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
        <h2 style="color: #009EE3;">Hola! 👋</h2>
        <p>Acá tenés el link de pago seguro solicitado para tu compra de <strong>{concepto}</strong>.</p>
        <p style="font-size: 18px;">Total a pagar: <strong>${monto}</strong></p>
        <br>
        <a href="{link_pago}" style="background-color: #009EE3; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Pagar con Mercado Pago
        </a>
        <br><br>
        <p style="font-size: 12px; color: #888;">Este es un mensaje automático generado por el Motor de Pagos.</p>
      </body>
    </html>
    """
    msg.attach(MIMEText(cuerpo_html, 'html'))

    # 3. Nos conectamos a Gmail y despachamos
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls() # Encriptamos la conexión
        server.login(remitente, password)
        server.send_message(msg)
        server.quit()
        return {"status": "success", "mensaje": "Email enviado con éxito al cliente"}
    except Exception as e:
        print(f"Error enviando correo: {e}")
        return {"status": "error", "mensaje": "Falló el envío del correo"}