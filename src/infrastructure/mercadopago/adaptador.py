import mercadopago

def generar_link_de_pago(monto: float, concepto: str, access_token: str, orden_id: int, vendedor_id: int) -> str:
    sdk = mercadopago.SDK(access_token)
    
    preference_data = {
        "items": [
            {
                "title": concepto,
                "quantity": 1,
                "unit_price": float(monto)
            }
        ],
        # El "DNI" de nuestra orden
        "external_reference": str(orden_id), 
        # El teléfono rojo: Le decimos a MP a dónde avisarnos y le pasamos de quién es la venta
        "notification_url": f"https://motor-de-pagos-api.onrender.com/webhook?vendedor_id={vendedor_id}"
    }

    preference_response = sdk.preference().create(preference_data)
    link_de_pago = preference_response["response"]["init_point"]
    
    print(f"✅ Link generado exitosamente: {link_de_pago}")
    return link_de_pago