const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // 1. Find a property
    const property = await prisma.property.findFirst();
    if (!property) {
        console.log('No property found');
        return;
    }

    // 2. Create the Unit
    const unit = await prisma.unit.create({
        data: {
            name: 'UPCOMING-99',
            unitNumber: '99',
            propertyId: property.id,
            status: 'Vacant',
            classification: 'Completed',
            unit_type: 'COMPLETED',
            unit_status: 'INACTIVE', // Keep INACTIVE so it shows in Upcoming, not Requirements
            availability_status: 'Available',
            bedrooms: 1,
            rentAmount: 1200,
            tentative_move_in_date: new Date(new Date().setDate(new Date().getDate() + 10))
        }
    });

    // 3. Create a Lease
    const tenant = await prisma.user.findFirst({ where: { role: 'TENANT' } });
    if (!tenant) {
        console.log('No tenant found for lease');
        return;
    }

    const lease = await prisma.lease.create({
        data: {
            unitId: unit.id,
            tenantId: tenant.id,
            startDate: unit.tentative_move_in_date,
            endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            status: 'Pending',
            monthlyRent: 1200
        }
    });

    // 4. Create the MoveIn record explicitly
    const moveIn = await prisma.moveIn.create({
        data: {
            unitId: unit.id,
            leaseId: lease.id,
            status: 'PENDING',
            targetDate: unit.tentative_move_in_date,
            missingItems: ['Rent', 'Deposit', 'Insurance']
        }
    });

    console.log('✅ Upcoming Unit Created:', { unitName: unit.name, moveInStatus: moveIn.status });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
