import mercadopago
from src.domain.interfaces import IProveedorDePagos
from src.domain.models import OrdenDeCobro

class MercadoPagoAdaptador(IProveedorDePagos):
    def __init__(self, access_token: str):
        self.sdk = mercadopago.SDK(access_token)

    async def asignar_orden_a_caja(self, orden: OrdenDeCobro) -> bool:
        # 1. Armamos el paquete exacto como lo exige Mercado Pago
        preference_data = {
            "items": [
                {
                    "title": orden.concepto,
                    "quantity": 1,
                    "unit_price": orden.monto,
                    "currency_id": "ARS" # O la moneda de tu país
                }
            ],
            "external_reference": str(orden.id) # Unimos tu BD con la BD de Mercado Pago
        }
        
        try:
            # 2. 🚀 El momento de la verdad: disparamos el dato a los servidores de MP
            print("⏳ Conectando con Mercado Pago...")
            respuesta = self.sdk.preference().create(preference_data)
            
            # 3. Analizamos qué nos respondió Mercado Pago
            if respuesta["status"] == 201:
                # ¡Nos devolvieron un link de pago real!
                link_de_pago = respuesta["response"]["init_point"]
                print(f"✅ ¡ÉXITO TOTAL! Link de pago generado:")
                print(f"🔗 {link_de_pago}")
                return True
            else:
                print(f"❌ Error de MP: {respuesta}")
                return False
                
        except Exception as e:
            print(f"🚨 Error de conexión: {e}")
            return False
            
    async def consultar_estado_pago(self, referencia_externa: str) -> str:
        return "PENDIENTE"