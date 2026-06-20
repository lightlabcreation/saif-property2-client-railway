const prisma = require('./src/config/prisma');

async function seed() {
  console.log('🌱 Seeding NEW demo data...');

  try {
    const timestamp = Date.now();

    // 1. Create a Property
    const property = await prisma.property.create({
      data: {
        name: `A-DEMO BUILDING ${timestamp}`,
        address: '1 Demo St, Demo City, QC H0H 0H0',
        civicNumber: '1',
        street: 'Demo St',
        city: 'Demo City',
        province: 'QC',
        postalCode: 'H0H 0H0',
        status: 'Active'
      }
    });

    // 2. Create Units
    const unit101 = await prisma.unit.create({
      data: {
        name: 'Unit 101',
        unitNumber: '101',
        propertyId: property.id,
        status: 'Occupied',
        rentalMode: 'FULL_UNIT',
        rentAmount: 1500
      }
    });

    const unit202 = await prisma.unit.create({
      data: {
        name: 'Unit 202',
        unitNumber: '202',
        propertyId: property.id,
        status: 'Occupied',
        rentalMode: 'FULL_UNIT',
        rentAmount: 1200
      }
    });

    // 3. Create Tenants
    const john = await prisma.user.create({
      data: {
        name: 'John Demo (ACTIVE)',
        email: `john_${timestamp}@example.com`,
        role: 'TENANT',
        type: 'INDIVIDUAL'
      }
    });

    const jane = await prisma.user.create({
      data: {
        name: 'Jane Demo (ACTIVE)',
        email: `jane_${timestamp}@example.com`,
        role: 'TENANT',
        type: 'INDIVIDUAL'
      }
    });

    const expiredUser = await prisma.user.create({
      data: {
        name: 'Expired Demo User',
        email: `expired_${timestamp}@example.com`,
        role: 'TENANT',
        type: 'INDIVIDUAL'
      }
    });

    // 4. Create Leases
    // Shared Lease 101
    const lease101 = await prisma.lease.create({
      data: {
        unitId: unit101.id,
        tenantId: john.id,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2027-12-31'),
        status: 'Active',
        monthlyRent: 1500,
        residents: {
          connect: [{ id: jane.id }]
        }
      }
    });

    // Lease 202
    const lease202 = await prisma.lease.create({
      data: {
        unitId: unit202.id,
        tenantId: expiredUser.id,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2025-01-01'),
        status: 'Active',
        monthlyRent: 1200
      }
    });

    // 5. Create Insurance
    // Active Insurance for Jane ONLY (Valid until end of 2027)
    await prisma.insurance.create({
      data: {
        userId: jane.id,
        leaseId: lease101.id,
        unitId: unit101.id,
        provider: 'Safe Insurance Co',
        policyNumber: 'ACT-9000',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2027-12-31'),
        status: 'ACTIVE'
      }
    });

    // Expired Insurance for Expired User (Expired in Jan 2026)
    await prisma.insurance.create({
      data: {
        userId: expiredUser.id,
        leaseId: lease202.id,
        unitId: unit202.id,
        provider: 'Old Insurance Ltd',
        policyNumber: 'EXP-1000',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2026-01-01'),
        status: 'EXPIRED'
      }
    });

    console.log('✅ Demo data created successfully!');
    console.log(`Building: A-DEMO BUILDING ${timestamp}`);
    console.log('Unit 101: John & Jane (Jane has policy, shared status should be ACTIVE)');
    console.log('Unit 202: Expired User (Status should be EXPIRED)');
  } catch (err) {
    console.error('❌ Error seeding:', err);
  }
}

seed()
  .catch(e => {
    console.error('❌ Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
