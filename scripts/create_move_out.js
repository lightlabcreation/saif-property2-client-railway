const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const unitId = 87;
    const leaseId = 92;

    // 2. Create MoveOut record
    const moveOut = await prisma.moveOut.create({
        data: {
            unitId: unitId,
            leaseId: leaseId,
            targetDate: new Date('2026-05-31'),
            status: 'INSPECTION_IN_PROGRESS'
        }
    });

    // 3. Update Unit status
    await prisma.unit.update({
        where: { id: unitId },
        data: { status: 'MOVE_OUT_IN_PROGRESS' }
    });

    console.log(`SUCCESS: Move-Out created for TEST-99. Check the 'Inspection In Progress' column!`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
