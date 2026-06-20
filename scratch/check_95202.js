const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check95202() {
    try {
        console.log('--- Checking Unit 95-202 ---');
        const unit = await prisma.unit.findFirst({
            where: { unitNumber: '95-202' },
            include: { leases: { where: { status: 'Active' } } }
        });
        console.log('Unit 95-202:', JSON.stringify(unit, null, 2));
    } catch (error) {
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

check95202();
