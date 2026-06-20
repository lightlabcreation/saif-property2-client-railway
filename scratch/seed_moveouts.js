const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedMoveOuts() {
  try {
    console.log('Seeding dummy Move-Out data...');

    // 1. Get active leases that don't have a move-out record yet
    const activeLeases = await prisma.lease.findMany({
      where: {
        status: 'Active',
        moveOut: null
      },
      include: { unit: true, tenant: true },
      take: 5
    });

    if (activeLeases.length === 0) {
      console.log('No active leases found without move-outs. Trying to find any active lease...');
      const anyActive = await prisma.lease.findMany({
        where: { status: 'Active' },
        include: { unit: true },
        take: 3
      });
      
      if (anyActive.length === 0) {
        console.log('No active leases at all. Please create a lease first.');
        return;
      }
      
      // If they already have move-outs, we'll just log them
      console.log('Found active leases but they might already have move-out workflows.');
    }

    const today = new Date();
    
    for (const lease of activeLeases) {
      // Create a move-out record for each lease
      // Vary the target dates: some overdue, some upcoming
      const daysOffset = Math.floor(Math.random() * 20) - 5; // -5 to +15 days
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysOffset);

      const moveOut = await prisma.moveOut.create({
        data: {
          leaseId: lease.id,
          unitId: lease.unitId,
          bedroomId: lease.bedroomId,
          status: 'PENDING',
          targetDate: targetDate,
        }
      });

      console.log(`Created Move-Out for Unit ${lease.unit.unitNumber}, Tenant ${lease.tenant.name}, Target: ${targetDate.toDateString()}`);
    }

    console.log('Seeding complete.');

  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedMoveOuts();
