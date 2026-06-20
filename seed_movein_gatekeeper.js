const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log("Seeding dummy Move-In data to test Lease Gatekeeper logic...");

  // Find or create property
  const property = await prisma.property.findFirst() || await prisma.property.create({ 
    data: { 
      name: 'Workflow Test Property', 
      address: '123 Test St' 
    } 
  });

  // 1. Scenario A: UPCOMING (Reserved, No Lease)
  console.log("Creating Scenario A: Reserved Unit with NO Lease...");
  const tenantA = await prisma.user.create({
    data: {
      firstName: 'Reserved',
      lastName: 'Only',
      email: `res${Date.now()}@test.com`,
      role: 'TENANT',
      name: 'Reserved Only'
    }
  });

  const unitA = await prisma.unit.create({
    data: {
      name: 'Unit RESERVE-101',
      unitNumber: 'RESERVE-101',
      propertyId: property.id,
      reserved_by_id: tenantA.id,
      unit_status: 'ACTIVE', 
      ready_for_leasing: true
    }
  });

  await prisma.moveIn.create({
    data: {
      unitId: unitA.id,
      leaseId: null, 
      status: 'PENDING',
      targetDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    }
  });

  // 2. Scenario B: BLOCKED (Signed Lease, Missing Requirements)
  console.log("Creating Scenario B: Signed Lease but missing Rent/Insurance...");
  const tenantB = await prisma.user.create({
    data: {
      firstName: 'Leased',
      lastName: 'MissingReqs',
      email: `lease${Date.now()}@test.com`,
      role: 'TENANT',
      name: 'Leased MissingReqs'
    }
  });

  const unitB = await prisma.unit.create({
    data: {
      name: 'Unit LEASE-202',
      unitNumber: 'LEASE-202',
      propertyId: property.id,
      unit_status: 'ACTIVE',
      ready_for_leasing: true
    }
  });

  const leaseB = await prisma.lease.create({
    data: {
      unitId: unitB.id,
      tenantId: tenantB.id,
      status: 'Active', 
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      securityDeposit: 1000
    }
  });

  await prisma.moveIn.create({
    data: {
      unitId: unitB.id,
      leaseId: leaseB.id,
      status: 'PENDING',
      targetDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      missingItems: ['Rent', 'Insurance', 'Deposit'] 
    }
  });

  console.log("Seeding complete!");
  console.log("Scenario A: Unit RESERVE-101 should be in 'Upcoming Move-Ins'");
  console.log("Scenario B: Unit LEASE-202 should be in 'Blocked Missing Requirements'");
}

run().catch(console.error).finally(() => prisma.$disconnect());
