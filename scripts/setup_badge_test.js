const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const property = await prisma.property.findFirst();
    if (!property) return console.error("No property found.");

    // 1. Create Unit
    const unit = await prisma.unit.create({
        data: {
            name: "TEST-100",
            unitNumber: "TEST-100",
            propertyId: property.id,
            status: 'OCCUPIED'
        }
    });

    // 2. Create Tenant
    const tenant = await prisma.user.create({
        data: {
            name: "Badge Tester",
            email: `tester-${Date.now()}@example.com`,
            role: 'TENANT'
        }
    });

    // 3. Create Lease
    const lease = await prisma.lease.create({
        data: {
            unitId: unit.id,
            tenantId: tenant.id,
            startDate: new Date('2024-01-01'),
            endDate: new Date('2025-01-01'),
            monthlyRent: 1200,
            status: 'Active'
        }
    });

    // 4. Create MoveOut
    await prisma.moveOut.create({
        data: {
            unitId: unit.id,
            leaseId: lease.id,
            targetDate: new Date('2026-06-15'),
            status: 'INSPECTION_IN_PROGRESS'
        }
    });

    // 5. Update Unit
    await prisma.unit.update({
        where: { id: unit.id },
        data: { status: 'MOVE_OUT_IN_PROGRESS' }
    });

    console.log(`SUCCESS: Unit TEST-100 is ready in the 'Inspection In Progress' column!`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
