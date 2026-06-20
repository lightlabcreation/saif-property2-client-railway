const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const inspections = await prisma.inspection.findMany({
            include: {
                template: true,
                unit: true,
                lease: { include: { tenant: true } },
                inspector: { select: { id: true, name: true } },
                tickets: true
            }
        });
        console.log('Inspections:', JSON.stringify(inspections, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
main();
