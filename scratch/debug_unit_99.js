const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const units = await prisma.unit.findMany({
            where: { 
                OR: [
                    { name: { contains: '99' } },
                    { unitNumber: { contains: '99' } }
                ]
            },
            include: { 
                leases: { include: { tenant: true } },
                moveIns: true
            }
        });
        console.log(JSON.stringify(units, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
