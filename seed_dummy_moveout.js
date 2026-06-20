const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log("Looking for a lease without a move-out...");
  const leases = await prisma.lease.findMany({
    where: {
      moveOut: null
    },
    include: { unit: true, tenant: true },
    orderBy: { id: 'desc' }
  });

  let leaseToUse = null;

  if (leases.length === 0) {
    console.log("No lease found without move-out. Creating a dummy unit, tenant, and lease...");
    // create property, building, unit, tenant, lease
    const property = await prisma.property.findFirst() || await prisma.property.create({ data: { name: 'Dummy Property', type: 'MULTI_FAMILY' } });
    const building = await prisma.building.findFirst() || await prisma.building.create({ data: { name: 'Dummy Building', propertyId: property.id } });
    
    const unit = await prisma.unit.create({
      data: {
        unitNumber: 'DUMMY-MO-' + Math.floor(Math.random() * 1000),
        propertyId: property.id,
        buildingId: building.id,
        status: 'OCCUPIED'
      }
    });

    const tenant = await prisma.tenant.create({
      data: {
        firstName: 'Dummy',
        lastName: 'MoveOut',
        email: 'dummy.moveout@example.com',
        phone: '555-0199',
        status: 'ACTIVE'
      }
    });

    leaseToUse = await prisma.lease.create({
      data: {
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2026-01-01'),
        rentAmount: 1200,
        status: 'ACTIVE'
      }
    });
  } else {
    leaseToUse = leases[0];
  }

  console.log(`Found/Created Lease ID: ${leaseToUse.id}`);

  const newMoveOut = await prisma.moveOut.create({
    data: {
      leaseId: leaseToUse.id,
      unitId: leaseToUse.unitId,
      status: 'PENDING',
      targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    }
  });

  console.log(`Created Dummy MoveOut ID: ${newMoveOut.id} for Lease ID: ${leaseToUse.id}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
