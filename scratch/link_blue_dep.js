const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const unit = await prisma.unit.findFirst({
            where: { unitNumber: 'BLUE-DEP-6' },
            include: { leases: { where: { status: 'RESERVED' } } }
        });

        if (unit && unit.leases[0]) {
            await prisma.moveIn.upsert({
                where: { leaseId: unit.leases[0].id },
                update: { 
                    status: 'BLOCKED_IN_PREPARATION',
                    unitId: unit.id
                },
                create: {
                    unitId: unit.id,
                    leaseId: unit.leases[0].id,
                    status: 'BLOCKED_IN_PREPARATION',
                    targetDate: unit.leases[0].startDate,
                    missingItems: ['Rent', 'Deposit', 'Insurance']
                }
            });
            console.log('Link Successful for BLUE-DEP-6');
        } else {
            console.log('Unit or Reserved Lease not found for BLUE-DEP-6');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
