const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMoveInIssues() {
    try {
        console.log('--- Checking Unit 95-102 ---');
        const unit95 = await prisma.unit.findFirst({
            where: { unitNumber: '95-102' },
            include: { 
                leases: {
                    where: { status: { in: ['ACTIVE', 'PENDING'] } }
                }
            }
        });
        console.log('Unit 95-102:', JSON.stringify(unit95, null, 2));

        console.log('\n--- Checking Unit 93-202 ---');
        const unit93 = await prisma.unit.findFirst({
            where: { unitNumber: '93-202' },
            include: { 
                leases: {
                    where: { status: { in: ['ACTIVE', 'PENDING'] } }
                }
            }
        });
        console.log('Unit 93-202:', JSON.stringify(unit93, null, 2));

        if (unit93 && unit93.leases.length > 0) {
            const leaseId = unit93.leases[0].id;
            const requirements = await prisma.moveInRequirement.findUnique({
                where: { leaseId }
            });
            console.log('Move-In Requirements for 93-202:', JSON.stringify(requirements, null, 2));
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkMoveInIssues();
