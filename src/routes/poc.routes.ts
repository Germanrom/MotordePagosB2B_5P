import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// ==========================================
// 🏢 RUTAS DE PRUEBA DE CONCEPTO (PoC) B2B
// ==========================================

// 1. REGISTRO DE VENDEDOR (Onboarding simple B2B)
// 1. REGISTRO DE VENDEDOR (Onboarding simple B2B)
router.post('/vendedores', async (req, res) => {
  try {
    const { mp_email, mp_access_token, mp_refresh_token } = req.body;
    
    // ✨ LÓGICA NUEVA: Leemos la API Key que viene del Index.html
    const apiKey = req.headers['x-api-key'] as string;

    if (!mp_email || !mp_access_token) {
      return res.status(400).json({ error: "Faltan datos obligatorios (email o token)" });
    }
    
    if (!apiKey) {
      return res.status(401).json({ error: "Falta X-API-Key en los headers" });
    }

    // ✨ LÓGICA NUEVA: Buscamos exactamente el Cliente dueño de esa API Key
    const clienteReal = await prisma.client.findFirst({
      where: { api_key: apiKey }
    });

    if (!clienteReal) {
      return res.status(401).json({ error: "API Key inválida. No se encontró tu Cliente en la BD." });
    }

    // Creamos el vendedor atándolo al cliente correcto
    const nuevoVendedor = await prisma.vendor.create({
      data: {
        mp_email: mp_email,
        mp_access_token: mp_access_token,
        mp_refresh_token: mp_refresh_token || null, // Lo guardamos si lo mandan
        client_id: clienteReal.id // Usamos el ID real de tu cliente
      }
    });

    console.log(`✅ [PoC] Vendedor creado con ID: ${nuevoVendedor.id} para el cliente ${clienteReal.client_id}`);
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