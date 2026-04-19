from abc import ABC, abstractmethod
from src.domain.models import OrdenDeCobro

class IProveedorDePagos(ABC):
    
    @abstractmethod
    async def asignar_orden_a_caja(self, orden: OrdenDeCobro) -> bool:
        """
        Inyecta la orden en el proveedor (ej. Mercado Pago) 
        para que aparezca en el QR dinámico.
        """
        pass
        
    @abstractmethod
    async def consultar_estado_pago(self, referencia_externa: str) -> str:
        """
        Consulta si un pago realmente se procesó con éxito.
        """
        pass