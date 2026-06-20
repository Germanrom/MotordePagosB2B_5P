import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// ==========================================
// 🏢 RUTAS DE PRUEBA DE CONCEPTO (PoC) B2B
// ==========================================

// 1. REGISTRO DE VENDEDOR (Onboarding simple B2B)
router.post('/vendedores', async (req, res) => {
  try {
    const { mp_email, mp_access_token } = req.body;

    if (!mp_email || !mp_access_token) {
      return res.status(400).json({ error: "Faltan datos obligatorios (email o token)" });
    }

    // Buscamos tu Cliente (Tenant) principal en la BD para asociarlo
    const primerCliente = await prisma.client.findFirst();
    if (!primerCliente) {
      return res.status(500).json({ error: "No hay ningún Client (Tenant) creado en la base de datos." });
    }

    // Creamos el vendedor impactando en tu tabla Vendor
    const nuevoVendedor = await prisma.vendor.create({
      data: {
        mp_email: mp_email,
        mp_access_token: mp_access_token,
        client_id: primerCliente.id
      }
    });

    console.log(`✅ [PoC] Vendedor creado con ID: ${nuevoVendedor.id}`);
    res.status(201).json({ mensaje: "Vendedor registrado", data: nuevoVendedor });

  } catch (error) {
    console.error("❌ Error creando vendedor:", error);
    res.status(500).json({ error: "Error interno al crear el vendedor." });
  }
});

// 2. DASHBOARD DEL VENDEDOR (Conciliación universal)
router.get('/vendedores/:vendor_id/pagos', async (req, res) => {
  try {
    const vendorId = parseInt(req.params.vendor_id);

    if (isNaN(vendorId)) {
      return res.status(400).json({ error: "El ID del vendedor debe ser un número." });
    }

    // Buscamos todas las órdenes de este vendedor, ordenadas por las más recientes
    const ordenes = await prisma.order.findMany({
      where: { vendor_id: vendorId },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`📊 [PoC] Consultando dashboard del vendedor ${vendorId}`);
    res.status(200).json({ 
      vendor_id: vendorId,
      total_ordenes: ordenes.length,
      data: ordenes 
    });

  } catch (error) {
    console.error("❌ Error consultando dashboard:", error);
    res.status(500).json({ error: "Error interno al consultar órdenes." });
  }
});

export default router;