import 'dotenv/config';
import prisma from '../src/config/prisma';

async function main() {
  const duplicates = await prisma.$queryRaw<Array<{ client_id: string; external_id: string; count: bigint; order_ids: string[] }>>`
    SELECT "client_id", "external_id", COUNT(*) AS count, ARRAY_AGG("id" ORDER BY "createdAt") AS order_ids
    FROM "Order"
    GROUP BY "client_id", "external_id"
    HAVING COUNT(*) > 1
    ORDER BY "client_id", "external_id"
  `;
  const accountCounts = await prisma.vendor.groupBy({ by: ['client_id'], _count: { _all: true } });
  const crossTenantOrders = await prisma.$queryRaw<Array<{ order_id: string; order_client_id: string; vendor_id: number; vendor_client_id: string }>>`
    SELECT orders."id" AS order_id, orders."client_id" AS order_client_id,
           orders."vendor_id", vendors."client_id" AS vendor_client_id
    FROM "Order" AS orders
    JOIN "Vendor" AS vendors ON vendors."id" = orders."vendor_id"
    WHERE orders."client_id" <> vendors."client_id"
    ORDER BY orders."id"
  `;

  console.log(JSON.stringify({
    note: 'Review and resolve every listed conflict manually before applying the tenant and external_id constraints. This report does not modify data.',
    duplicate_order_references: duplicates.map((row) => ({ ...row, count: Number(row.count) })),
    orders_linked_to_another_tenant_account: crossTenantOrders,
    tenants_with_multiple_legacy_accounts: accountCounts.filter((row) => row._count._all > 1).map((row) => ({ client_id: row.client_id, vendor_count: row._count._all })),
  }, null, 2));
}

main().catch((error) => {
  console.error('Could not inspect migration conflicts:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
