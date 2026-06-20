const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    try {
        const count = await prisma.moveOut.count();
        console.log('MoveOut count:', count);
        const inspections = await prisma.inspection.count();
        console.log('Inspection count:', inspections);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
main();
