const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

async function main() {
    const email = 'tenant@example.com';
    const password = '123456';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 1. Create Property
    const property = await prisma.property.create({
        data: {
            name: 'Elite demo Properties',
            address: '777 Demo Street, Kingston',
            status: 'Active',
            city: 'Kingston',
            province: 'St. Andrew'
        }
    });

    // 2. Create Unit
    const unit = await prisma.unit.create({
        data: {
            name: 'A-101',
            propertyId: property.id,
            status: 'Occupied',
            bedrooms: 2,
            rentAmount: 1450,
            unitNumber: 'A-101',
            unitType: 'DEMO'
        }
    });

    // 3. Create Demo Tenant
    const user = await prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            name: 'Demo Tenant',
            firstName: 'Demo',
            lastName: 'Tenant',
            role: 'TENANT',
            type: 'INDIVIDUAL',
            phone: '876-111-2222',
            unitId: unit.id
        }
    });

    // 4. Create Active Lease
    const lease = await prisma.lease.create({
        data: {
            tenantId: user.id,
            unitId: unit.id,
            startDate: new Date(),
            endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            monthlyRent: 1450,
            status: 'Active',
            securityDeposit: 1450
        }
    });

    // Link user to lease (back-reference)
    await prisma.user.update({
        where: { id: user.id },
        data: { leaseId: lease.id }
    });

    // Register a vehicle for this demo tenant
    await prisma.vehicle.create({
        data: {
            tenantId: user.id,
            leaseId: lease.id,
            make: 'Honda',
            model: 'Civic',
            color: 'Silver',
            licensePlate: 'DEMO-1234',
            parkingSpace: 'P-123'
        }
    });

    console.log('Demo tenant setup complete');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
