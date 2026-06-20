const prisma = require('../src/config/prisma');

async function checkLeases() {
    try {
        console.log('Checking leases expiring in June 2026...');
        
        // Define June 2026 range
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
                unit: true,
                tenant: true
            }
        });

        console.log(`Total leases expiring in June 2026: ${juneLeases.length}`);
        
        const activeLeases = juneLeases.filter(l => l.status === 'Active');
        console.log(`Active leases expiring in June 2026: ${activeLeases.length}`);
        
        const otherStatusLeases = juneLeases.filter(l => l.status !== 'Active');
        console.log(`Leases with other statuses expiring in June 2026:`, otherStatusLeases.map(l => ({ id: l.id, status: l.status, unitNumber: l.unit.unitNumber })));

        // Look at moveOut records linked to these leases
        const leasesWithMoveOut = juneLeases.filter(l => l.moveOut !== null);
        console.log(`Leases expiring in June with a MoveOut record: ${leasesWithMoveOut.length}`);

        const leasesWithoutMoveOut = juneLeases.filter(l => l.moveOut === null);
        console.log(`Leases expiring in June WITHOUT a MoveOut record:`, leasesWithoutMoveOut.map(l => ({
            id: l.id,
            status: l.status,
            endDate: l.endDate,
            unitNumber: l.unit.unitNumber,
            tenant: l.tenant?.name
        })));
        
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkLeases();
