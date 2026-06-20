const prisma = require('../src/config/prisma');

async function checkDashboardTotals() {
    try {
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);

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

        console.log(`Total move-outs in dashboard query: ${moveOuts.length}`);

        // Group by status
        const statuses = {};
        for (const mo of moveOuts) {
            statuses[mo.status] = (statuses[mo.status] || 0) + 1;
        }
        console.log("Move-out counts by status in dashboard:", statuses);

        // Group by column (like frontend)
        const upcoming = moveOuts.filter(m => m.status === 'PENDING').length;
        const confirmed = moveOuts.filter(m => m.status === 'CONFIRMED').length;
        const scheduled = moveOuts.filter(m => m.status.includes('SCHEDULED') && !(m.visualInspectionId && m.finalInspectionId) && m.status !== 'COMPLETED' && m.status !== 'CANCELLED').length;
        const inProgress = moveOuts.filter(m => (m.status === 'INSPECTION_IN_PROGRESS' || (m.visualInspectionId && m.finalInspectionId)) && !['COMPLETED', 'CANCELLED', 'INSPECTIONS_COMPLETED', 'PENDING', 'CONFIRMED'].includes(m.status)).length;
        const ready = moveOuts.filter(m => m.status === 'INSPECTIONS_COMPLETED' && m.status !== 'COMPLETED').length;

        console.log("Column totals:");
        console.log("Upcoming Move-Outs:", upcoming);
        console.log("Confirmed Move-Out:", confirmed);
        console.log("Move-Out Inspection Remaining:", scheduled);
        console.log("Inspection In Progress:", inProgress);
        console.log("Ready for Completion:", ready);
        console.log("Sum of displayed columns:", upcoming + confirmed + scheduled + inProgress + ready);

        // Let's count how many have targetDate in June 2026
        const startOfJune = new Date('2026-06-01T00:00:00Z');
        const endOfJune = new Date('2026-06-30T23:59:59Z');
        const juneMoveOuts = moveOuts.filter(m => m.targetDate >= startOfJune && m.targetDate <= endOfJune);
        console.log(`\nMove-outs in dashboard with target date in June: ${juneMoveOuts.length}`);

        const juneUpcoming = juneMoveOuts.filter(m => m.status === 'PENDING').length;
        const juneConfirmed = juneMoveOuts.filter(m => m.status === 'CONFIRMED').length;
        const juneScheduled = juneMoveOuts.filter(m => m.status.includes('SCHEDULED') && !(m.visualInspectionId && m.finalInspectionId) && m.status !== 'COMPLETED' && m.status !== 'CANCELLED').length;
        const juneInProgress = juneMoveOuts.filter(m => (m.status === 'INSPECTION_IN_PROGRESS' || (m.visualInspectionId && m.finalInspectionId)) && !['COMPLETED', 'CANCELLED', 'INSPECTIONS_COMPLETED', 'PENDING', 'CONFIRMED'].includes(m.status)).length;
        const juneReady = juneMoveOuts.filter(m => m.status === 'INSPECTIONS_COMPLETED' && m.status !== 'COMPLETED').length;

        console.log("June Column totals:");
        console.log("Upcoming:", juneUpcoming);
        console.log("Confirmed:", juneConfirmed);
        console.log("Scheduled:", juneScheduled);
        console.log("In Progress:", juneInProgress);
        console.log("Ready:", juneReady);
        console.log("Sum of June displayed columns:", juneUpcoming + juneConfirmed + juneScheduled + juneInProgress + juneReady);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkDashboardTotals();
