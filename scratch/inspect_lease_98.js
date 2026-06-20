const prisma = require('../src/config/prisma');

async function inspectLease98() {
    try {
        const lease = await prisma.lease.findUnique({
            where: { id: 98 },
            include: {
                unit: true,
                moveOut: true
            }
        });
        console.log("Lease 98 Details:");
        console.log(JSON.stringify(lease, null, 2));

        // Let's also check all MoveOut records in the DB to see if any point to leaseId 98
        const moveOuts = await prisma.moveOut.findMany({
            where: { leaseId: 98 }
        });
        console.log("MoveOut records pointing to Lease 98:", moveOuts);
        
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

inspectLease98();
