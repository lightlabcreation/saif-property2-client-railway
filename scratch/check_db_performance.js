const prisma = require('../src/config/prisma');

async function checkDbPerformance() {
    try {
        console.log("Starting DB performance test...");
        const t0 = Date.now();
        
        const countHistory = await prisma.unitHistory.count();
        console.log(`UnitHistory count: ${countHistory} (took ${Date.now() - t0}ms)`);
        
        const t1 = Date.now();
        const countMoveOuts = await prisma.moveOut.count();
        console.log(`MoveOut count: ${countMoveOuts} (took ${Date.now() - t1}ms)`);
        
        const t2 = Date.now();
        // Try creating a unit history record without transaction
        const newRecord = await prisma.unitHistory.create({
            data: {
                unitId: 4,
                userId: 123,
                action: 'TEST_PERFORMANCE',
                newStatus: 'TEST',
                timestamp: new Date()
            }
        });
        console.log(`Created test history record ID: ${newRecord.id} (took ${Date.now() - t2}ms)`);

        // Clean up
        const t3 = Date.now();
        await prisma.unitHistory.delete({
            where: { id: newRecord.id }
        });
        console.log(`Cleaned up test record (took ${Date.now() - t3}ms)`);

    } catch (e) {
        console.error("DB performance test failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

checkDbPerformance();
