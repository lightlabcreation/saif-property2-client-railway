const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const lease = await prisma.lease.findFirst({
        where: { unit: { name: 'tst' } },
        orderBy: { createdAt: 'desc' }
    });

    if (!lease) {
        console.log('No lease found for unit tst');
        return;
    }

    const insurance = await prisma.insurance.create({
        data: {
            leaseId: lease.id,
            userId: lease.tenantId,
            unitId: lease.unitId,
            policyNumber: 'DUMMY-INS-002',
            provider: 'Dummy Insurance Co',
            startDate: new Date(),
            endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            status: 'ACTIVE',
            coverageType: 'Liability',
            notes: 'Created via automated script'
        }
    });

    console.log('✅ Dummy Insurance Created:', insurance);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
