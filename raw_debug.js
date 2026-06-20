const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function rawDebug() {
    console.log('--- RAW REFUND ADJUSTMENT TABLE ---');
    const raw = await prisma.$queryRaw`SELECT requestId, tenantId, unitId, status FROM refundadjustment ORDER BY id DESC LIMIT 50`;
    console.log(JSON.stringify(raw, null, 2));

    console.log('\n--- RAW USER TABLE (SANDRA) ---');
    const users = await prisma.$queryRaw`SELECT id, name FROM user WHERE name LIKE '%Sandra%'`;
    console.log(JSON.stringify(users, null, 2));
}

rawDebug()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
