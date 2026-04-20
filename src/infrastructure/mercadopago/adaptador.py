import mercadopago

# Nota: Ya no necesitamos os ni load_dotenv acá porque el token 
# ahora viene directo desde la base de datos a través de la función.

def generar_link_de_pago(monto: float, concepto: str, access_token: str) -> str:
    """
    Se conecta con Mercado Pago, crea la preferencia y devuelve el link de cobro real.
    Ahora es Multi-Tenant: usa el access_token del vendedor correspondiente.
    """
    # 1. Inicializamos Mercado Pago ADENTRO de la función con el token del cliente
    sdk = mercadopago.SDK(access_token)
    
    preference_data = {
        "items": [
            {
                "title": concepto,
                "quantity": 1,
                "unit_price": float(monto)
            }
        ]
    }

    # 2. Hacemos la petición a Mercado Pago
    preference_response = sdk.preference().create(preference_data)
    
    # 3. Extraemos el link de pago
    link_de_pago = preference_response["response"]["init_point"]
    
    # 4. Lo imprimimos en la terminal de Render (Logs) para control nuestro
    print(f"✅ Link generado exitosamente: {link_de_pago}")
    
    # --- MAGIA DEL QR (Desactivada para producción en la nube) ---
    # import qrcode
    # imagen_qr = qrcode.make(link_de_pago)
    # imagen_qr.show()

    # 5. Devolvemos el link para que llegue a main.py
    return link_de_pago