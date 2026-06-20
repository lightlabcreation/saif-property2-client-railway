const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedFull() {
  try {
    console.log('Starting comprehensive seeding...');

    // 1. Get or Create Property
    let property = await prisma.property.findFirst();
    if (!property) {
      property = await prisma.property.create({
        data: {
          name: 'Dummy Heights',
          address: '123 Fake St',
          city: 'Toronto',
          province: 'ON'
        }
      });
    }

    // 2. Create Units
    const unitNumbers = ['101A', '102B', '203C'];
    const units = [];
    for (const num of unitNumbers) {
      const unit = await prisma.unit.upsert({
        where: { id: -1 }, // Just create new ones
        update: {},
        create: {
          name: `Unit ${num}`,
          unitNumber: num,
          propertyId: property.id,
          status: 'Occupied',
          availability_status: 'Occupied',
          unit_type: 'COMPLETED',
          current_stage: 'UNIT_READY'
        }
      });
      units.push(unit);
    }

    // 3. Create Tenants (Users)
    const tenants = [];
    for (let i = 1; i <= 3; i++) {
      const tenant = await prisma.user.create({
        data: {
          email: `tenant${Date.now()}${i}@example.com`,
          name: `Dummy Tenant ${i}`,
          role: 'TENANT',
          phone: `55500000${i}`
        }
      });
      tenants.push(tenant);
    }

    // 4. Create Leases
    const leases = [];
    for (let i = 0; i < 3; i++) {
      const lease = await prisma.lease.create({
        data: {
          unitId: units[i].id,
          tenantId: tenants[i].id,
          status: 'Active',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2026-12-31'),
          monthlyRent: 1500
        }
      });
      leases.push(lease);
    }

    // 5. Create Move-Outs
    const today = new Date();
    const offsets = [-10, 2, 20]; // Overdue, Soon, Future
    const statuses = ['PENDING', 'PENDING', 'PENDING'];

    for (let i = 0; i < 3; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + offsets[i]);

      await prisma.moveOut.create({
        data: {
          leaseId: leases[i].id,
          unitId: units[i].id,
          status: statuses[i],
          targetDate: targetDate
        }
      });
      console.log(`Created Move-Out: Unit ${units[i].unitNumber}, Date: ${targetDate.toDateString()}`);
    }

    console.log('Full seeding complete!');

  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedFull();
