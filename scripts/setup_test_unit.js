const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // 1. Get a property
    const property = await prisma.property.findFirst();
    if (!property) {
        console.error("No property found. Please create a property first.");
        return;
    }

    // 2. Create Unit
    const unit = await prisma.unit.create({
        data: {
            name: "TEST-99",
            unitNumber: "TEST-99",
            propertyId: property.id,
            status: 'OCCUPIED'
        }
    });

    // 3. Create Tenant (User with role TENANT)
    const tenant = await prisma.user.create({
        data: {
            name: "Manual Tester",
            email: `tester-${Date.now()}@example.com`,
            role: 'TENANT'
        }
    });

    // 4. Create Active Lease
    const lease = await prisma.lease.create({
        data: {
            unitId: unit.id,
            tenantId: tenant.id,
            startDate: new Date('2024-01-01'),
            endDate: new Date('2025-01-01'),
            monthlyRent: 1000,
            status: 'Active'
        }
    });

    console.log(`SUCCESS: Unit ${unit.name} created with Active Lease for ${tenant.name}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
