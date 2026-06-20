const prisma = require('../src/config/prisma');

async function testDashboard() {
    try {
        console.log('Testing move-out dashboard query...');
        const moveOuts = await prisma.moveOut.findMany({
            include: {
                unit: true,
                lease: { include: { tenant: true } },
                manager: { select: { id: true, name: true } }
            },
            orderBy: { targetDate: 'asc' }
        });

        console.log(`Found ${moveOuts.length} move-outs.`);
        if (moveOuts.length > 0) {
            console.log('First Move-Out Sample:', JSON.stringify(moveOuts[0], null, 2));
        }

    } catch (error) {
        console.error('Dashboard query failed:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

testDashboard();
