const prisma = require('../src/config/prisma');

async function checkMoveouts() {
    try {
        const today = new Date();
        // Or wait, is there a specific date set?
        console.log("Current system time (new Date()):", today.toISOString());
        
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        console.log("30 Days from now:", thirtyDaysFromNow.toISOString());

        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(today.getDate() - 14);
        console.log("14 Days ago:", fourteenDaysAgo.toISOString());

        // Let's count how many leases expire in June 2026
        const startOfJune = new Date('2026-06-01T00:00:00Z');
        const endOfJune = new Date('2026-06-30T23:59:59Z');

        const juneLeases = await prisma.lease.findMany({
            where: {
                endDate: {
                    gte: startOfJune,
                    lte: endOfJune
                }
            },
            include: {
                moveOut: true,
                unit: true
            }
        });

        console.log(`\nJune Leases: ${juneLeases.length}`);
        
        // Let's see moveOut status for each June lease
        for (const l of juneLeases) {
            console.log(`Lease ID: ${l.id}, Unit: ${l.unit.unitNumber}, Status: ${l.status}, End Date: ${l.endDate.toISOString()}, MoveOut: ${l.moveOut ? `ID: ${l.moveOut.id}, Status: ${l.moveOut.status}, Target Date: ${l.moveOut.targetDate.toISOString()}` : 'NONE'}`);
        }

        // Now, let's query the moveOuts that getMoveOutDashboard would find
        const moveOuts = await prisma.moveOut.findMany({
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

        console.log(`\nMoveOuts in dashboard query (targetDate <= ${thirtyDaysFromNow.toISOString()}): ${moveOuts.length}`);
        
        // Let's filter moveOuts where the lease expires in June 2026
        const juneMoveOuts = moveOuts.filter(mo => {
            return mo.lease && mo.lease.endDate >= startOfJune && mo.lease.endDate <= endOfJune;
        });
        console.log(`June expiring leases that are actually returned by the dashboard query: ${juneMoveOuts.length}`);

        // Let's find which June expiring leases are NOT in the dashboard query and why
        const juneLeaseIdsInDashboard = new Set(juneMoveOuts.map(mo => mo.leaseId));
        const missingFromDashboard = juneLeases.filter(l => l.status === 'Active' && !juneLeaseIdsInDashboard.has(l.id));
        console.log(`\nActive June expiring leases missing from dashboard query:`);
        for (const l of missingFromDashboard) {
            console.log(`Lease ID: ${l.id}, Unit: ${l.unit.unitNumber}, EndDate: ${l.endDate.toISOString()}, MoveOut: ${l.moveOut ? `ID: ${l.moveOut.id}, Status: ${l.moveOut.status}, TargetDate: ${l.moveOut.targetDate.toISOString()}` : 'NONE'}`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkMoveouts();
