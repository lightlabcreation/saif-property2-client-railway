const prisma = require('../src/config/prisma');
const workflowService = require('../src/services/workflow.service');

async function simulate() {
    try {
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(today.getDate() - 14);

        console.log(`Checking for expiring leases without Move-Out...`);
        const expiringLeases = await prisma.lease.findMany({
            where: {
                status: 'Active',
                endDate: {
                    lte: thirtyDaysFromNow,
                    gte: fourteenDaysAgo
                },
                moveOut: null
            }
        });

        console.log(`Found ${expiringLeases.length} expiring leases without Move-Out:`, expiringLeases.map(l => l.id));

        for (const lease of expiringLeases) {
            console.log(`Initializing Move-Out for Lease ID: ${lease.id}`);
            const result = await workflowService.initMoveOutWorkflow(lease.id);
            console.log(`Initialized successfully:`, result);
        }

    } catch (e) {
        console.error("Simulation failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

simulate();
