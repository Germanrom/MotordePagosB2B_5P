import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({});

async function main() {
  const apiKeyMaestra = process.env.MI_API_KEY_MAESTRA?.replace(/"/g, '') || 'super_secreto_motor_pagos_2026_5P';

  const newClient = await prisma.client.create({
    data: {
      client_id: 'ENUAR',
      api_key: apiKeyMaestra, // Usamos tu clave actual para no romper tus pruebas
      callback_url: 'https://centroenuar.com/functions/v1/mp-vincular-callback',
      redirect_uri: 'https://centroenuar.com/admin/settings',
      webhook_secret: 'mi_secreto_hmac_123', // Este es un secreto de prueba para las firmas
    },
  });

  console.log('✅ Cliente "centroenuar" insertado con éxito:');
  console.log(newClient);
}

main()
  .catch((e) => {
    console.error('❌ Error insertando cliente:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
