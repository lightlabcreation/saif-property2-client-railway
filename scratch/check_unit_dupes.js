const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const units = await prisma.unit.findMany({
        where: { unitNumber: '93-401' },
        select: { id: true, unitNumber: true, status: true, availability_status: true, unit_status: true, reserved_flag: true }
    });
    console.log(JSON.stringify(units, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
