const prisma = require('../src/config/prisma');

async function checkUnits() {
    try {
        const startOfJune = new Date('2026-06-01T00:00:00Z');
        const endOfJune = new Date('2026-06-30T23:59:59Z');

        const activeJuneLeases = await prisma.lease.findMany({
            where: {
                status: 'Active',
                endDate: {
                    gte: startOfJune,
                    lte: endOfJune
                }
            },
            include: {
                unit: true
            }
        });

        const activeJuneUnits = new Set(activeJuneLeases.map(l => l.unit.unitNumber));
        console.log(`Active June Leases Count: ${activeJuneLeases.length}`);
        console.log(`Unique Units with active June expiring leases: ${activeJuneUnits.size}`);
        console.log(`List of these unique units:`, Array.from(activeJuneUnits).sort());

        // Let's check dashboard moveouts
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);

        const dashboardMoveOuts = await prisma.moveOut.findMany({
            where: {
                targetDate: {
                    lte: thirtyDaysFromNow
                },
                status: { not: 'CANCELLED' }
            },
            include: {
                unit: true,
                lease: true
            }
        });

        // June expiring moveouts in the dashboard
        const juneDashboardMoveOuts = dashboardMoveOuts.filter(mo => {
            return mo.lease && mo.lease.endDate >= startOfJune && mo.lease.endDate <= endOfJune;
        });

        const juneDashboardUnits = new Set(juneDashboardMoveOuts.map(mo => mo.unit.unitNumber));
        console.log(`\nJune Dashboard MoveOuts Count: ${juneDashboardMoveOuts.length}`);
        console.log(`Unique Units represented by June expiring MoveOuts in dashboard: ${juneDashboardUnits.size}`);
        console.log(`List of these unique units:`, Array.from(juneDashboardUnits).sort());

        // Check if there are any duplicate active leases on the same units
        const unitLeasesCount = {};
        for (const l of activeJuneLeases) {
            const num = l.unit.unitNumber;
            if (!unitLeasesCount[num]) unitLeasesCount[num] = [];
            unitLeasesCount[num].push(l.id);
        }

        console.log(`\nUnits with multiple active June expiring leases:`);
        for (const [unitNum, leaseIds] of Object.entries(unitLeasesCount)) {
            if (leaseIds.length > 1) {
                console.log(`Unit ${unitNum}: Lease IDs ${leaseIds.join(', ')}`);
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkUnits();
