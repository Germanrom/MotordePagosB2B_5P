import os
import mercadopago
from dotenv import load_dotenv

# 1. Abrimos la caja fuerte
load_dotenv()

# 2. Inicializamos Mercado Pago con el token
sdk = mercadopago.SDK(os.getenv("MP_ACCESS_TOKEN"))

def generar_link_de_pago(monto: float, concepto: str) -> str:
    """
    Se conecta con Mercado Pago, crea la preferencia y devuelve el link de cobro real.
    """
    preference_data = {
        "items": [
            {
                "title": concepto,
                "quantity": 1,
                "unit_price": float(monto)
            }
        ]
    }

    # Hacemos la petición a Mercado Pago
    preference_response = sdk.preference().create(preference_data)
    
    # Extraemos el link de pago
    link_de_pago = preference_response["response"]["init_point"]
    
    # Lo imprimimos en la terminal de Render (Logs) para control nuestro
    print(f"✅ Link generado exitosamente: {link_de_pago}")
    
    # --- MAGIA DEL QR (Desactivada para producción en la nube) ---
    # import qrcode
    # imagen_qr = qrcode.make(link_de_pago)
    # imagen_qr.show()

    # 3. Devolvemos el link para que llegue al usuario en Swagger
    return link_de_pago