const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const ins = await prisma.insurance.findMany({ where: { leaseId: 34 } });
        console.log('Insurances for Lease 34:', JSON.stringify(ins, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
