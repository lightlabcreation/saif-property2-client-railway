const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- Cleaning Up Data ---');
    
    // Delete in reverse order of dependencies to avoid foreign key issues
    await prisma.transaction.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.invoice.deleteMany({});
    await prisma.lease.deleteMany({});
    
    // Reset unit and bedroom occupancy before deleting tenants
    await prisma.bedroom.updateMany({ data: { status: 'Vacant' } });
    await prisma.unit.updateMany({ data: { status: 'Vacant' } });
    
    // Delete Tenants specifically (skip Admins/Owners)
    await prisma.user.deleteMany({
        where: {
            role: 'TENANT'
        }
    });

    console.log('--- Database Cleaned ---');
    console.log('--- Pushing Correct Dummy Data ---');

    // 1. Find or Create a Property
    let property = await prisma.property.findFirst();
    if (!property) {
        property = await prisma.property.create({
            data: {
                name: 'Grand Horizon Towers',
                address: '101 Luxury Blvd, New York',
                status: 'Active'
            }
        });
    }

    // 2. Create Tenants (Individual, Company, Resident)
    const individualTenant = await prisma.user.create({
        data: {
            email: 'john.individual@example.com',
            firstName: 'John',
            lastName: 'Individual',
            role: 'TENANT',
            type: 'INDIVIDUAL'
        }
    });

    const companyTenant = await prisma.user.create({
        data: {
            email: 'info@globalcorp.com',
            companyName: 'Global Tech Corp',
            role: 'TENANT',
            type: 'COMPANY'
        }
    });

    // Resident type often refers to a tenant in a bedroom-wise unit in this system
    const residentTenant = await prisma.user.create({
        data: {
            email: 'jane.resident@example.com',
            firstName: 'Jane',
            lastName: 'Resident',
            role: 'TENANT',
            type: 'RESIDENT'
        }
    });

    // 3. Create Units
    const unit101 = await prisma.unit.create({
        data: {
            name: 'Unit 101',
            unitNumber: '101',
            propertyId: property.id,
            rentalMode: 'FULL_UNIT',
            status: 'Occupied',
            rentAmount: 2500
        }
    });

    const unit202 = await prisma.unit.create({
        data: {
            name: 'Unit 202',
            unitNumber: '202',
            propertyId: property.id,
            rentalMode: 'FULL_UNIT',
            status: 'Occupied',
            rentAmount: 4500
        }
    });

    const unit303 = await prisma.unit.create({
        data: {
            name: 'Unit 303',
            unitNumber: '303',
            propertyId: property.id,
            rentalMode: 'BEDROOM_WISE',
            status: 'Occupied'
        }
    });

    const bedroomA = await prisma.bedroom.create({
        data: {
            unitId: unit303.id,
            bedroomNumber: '303-A',
            roomNumber: 1,
            status: 'Occupied',
            rentAmount: 1200
        }
    });

    const bedroomB = await prisma.bedroom.create({
        data: {
            unitId: unit303.id,
            bedroomNumber: '303-B',
            roomNumber: 2,
            status: 'Vacant',
            rentAmount: 1200
        }
    });

    // 4. Create Leases
    // Lease for Individual (Unit 101)
    await prisma.lease.create({
        data: {
            unitId: unit101.id,
            tenantId: individualTenant.id,
            startDate: new Date(),
            endDate: new Date(new Date().setMonth(new Date().getMonth() + 10)), // 10 months away
            status: 'Active',
            monthlyRent: 2500,
            leaseType: 'FULL_UNIT'
        }
    });

    // Lease for Company (Unit 202)
    await prisma.lease.create({
        data: {
            unitId: unit202.id,
            tenantId: companyTenant.id,
            startDate: new Date(),
            endDate: new Date(new Date().setDate(new Date().getDate() + 25)), // 25 days away (Red Alert)
            status: 'Active',
            monthlyRent: 4500,
            leaseType: 'FULL_UNIT'
        }
    });

    // Lease for Resident (Unit 303 - Bedroom A)
    await prisma.lease.create({
        data: {
            unitId: unit303.id,
            bedroomId: bedroomA.id,
            tenantId: residentTenant.id,
            startDate: new Date(),
            endDate: new Date(new Date().setDate(new Date().getDate() + 75)), // 75 days away (Yellow Alert)
            status: 'Active',
            monthlyRent: 1200,
            leaseType: 'BEDROOM'
        }
    });

    console.log('--- Dummy Data Successfully Pushed ---');
    console.log('1. Individual: John Individual in Unit 101 (Price: 2500)');
    console.log('2. Company: Global Tech Corp in Unit 202 (Price: 4500, Explores in 25 days - RED)');
    console.log('3. Resident: Jane Resident in 303-A (Price: 1200, Expires in 75 days - YELLOW)');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
