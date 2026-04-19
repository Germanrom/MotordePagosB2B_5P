
from src.domain.models import OrdenDeCobro
from src.infrastructure.database.repository import PostgresRepository
from src.domain.interfaces import IProveedorDePagos

class ServicioDePagos:
    # Ahora el servicio recibe DOS cosas: la base de datos y el proveedor de pagos (MP)
    def __init__(self, repositorio: PostgresRepository, proveedor_pagos: IProveedorDePagos):
        self.repositorio = repositorio
        self.proveedor_pagos = proveedor_pagos

    # Le agregamos la palabra "async" porque hablar con internet (MP) toma tiempo
    async def crear_orden(self, monto: float, concepto: str, punto_de_cobro: str) -> OrdenDeCobro:
        
        # 1. Armamos la orden
        nueva_orden = OrdenDeCobro(
            monto=monto,
            concepto=concepto,
            punto_de_cobro_id=punto_de_cobro
        )
        
        # 2. La guardamos en nuestra base de datos local
        orden_guardada = self.repositorio.guardar(nueva_orden)
        
        # 3. ¡Magia! Le enviamos la orden a Mercado Pago para el QR
        await self.proveedor_pagos.asignar_orden_a_caja(orden_guardada)
        
        return orden_guardada