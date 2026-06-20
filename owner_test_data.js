const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- Cleaning Up Data for Role Test ---');
    
    // Clear all previous test data
    await prisma.transaction.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.invoice.deleteMany({});
    await prisma.lease.deleteMany({});
    await prisma.maintenanceTask.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.bedroom.deleteMany({});
    await prisma.unit.deleteMany({});
    
    // Delete only tenants, keep Admin/Owner
    await prisma.user.deleteMany({ where: { role: 'TENANT' } });
    
    // Delete all current properties to start fresh for owner mapping
    await prisma.property.deleteMany({});

    console.log('--- Data Cleaned ---');

    // 1. Get the Owner from seed
    const owner = await prisma.user.findUnique({ where: { email: 'owner@property.com' } });
    if (!owner) {
        console.error('Owner not found! Please run npx prisma db seed first.');
        return;
    }

    // 2. Create Property ONLY for the OWNER
    const ownerProperty = await prisma.property.create({
        data: {
            name: 'Luxury Owner Estate',
            address: '777 Wealth Lane',
            status: 'Active',
            owners: { connect: { id: owner.id } } // This connects the property to the owner
        }
    });

    // 3. Create Property NOT owned by this owner (Admin Only)
    const adminProperty = await prisma.property.create({
        data: {
            name: 'System Admin Building',
            address: '101 Admin Road',
            status: 'Active'
            // No owner connected here
        }
    });

    // 4. Create Tenants
    const tenant1 = await prisma.user.create({
        data: { email: 'owner.tenant@example.com', firstName: 'OwnerSide', lastName: 'Tenant', role: 'TENANT', type: 'INDIVIDUAL' }
    });
    const tenant2 = await prisma.user.create({
        data: { email: 'admin.tenant@example.com', firstName: 'AdminOnly', lastName: 'Tenant', role: 'TENANT', type: 'COMPANY', companyName: 'Admin Corp' }
    });

    // 5. Create Units & Leases for OWNER PROPERTY
    const ownerUnit = await prisma.unit.create({
        data: { name: 'Owner Unit 1', unitNumber: 'OW-01', propertyId: ownerProperty.id, status: 'Occupied', rentAmount: 5000 }
    });
    await prisma.lease.create({
        data: {
            unitId: ownerUnit.id,
            tenantId: tenant1.id,
            startDate: new Date(),
            endDate: new Date(new Date().setMonth(new Date().getMonth() + 6)),
            status: 'Active',
            monthlyRent: 5000
        }
    });

    // 6. Create Units & Leases for ADMIN ONLY PROPERTY
    const adminUnit = await prisma.unit.create({
        data: { name: 'Admin Unit X', unitNumber: 'AD-99', propertyId: adminProperty.id, status: 'Occupied', rentAmount: 1500 }
    });
    await prisma.lease.create({
        data: {
            unitId: adminUnit.id,
            tenantId: tenant2.id,
            startDate: new Date(),
            endDate: new Date(new Date().setDate(new Date().getDate() + 15)),
            status: 'Active',
            monthlyRent: 1500
        }
    });

    console.log('--- OWNER DUMMY DATA READY ---');
    console.log('1. Owner (owner@property.com) owns: "Luxury Owner Estate" (Unit OW-01)');
    console.log('2. Admin has access to both, including: "System Admin Building" (Unit AD-99)');
    console.log('\n--- VERIFICATION STEPS ---');
    console.log('Log in as Admin: You should see 2 buildings in Rent Roll.');
    console.log('Log in as Owner: You should see ONLY 1 building ("Luxury Owner Estate") in Rent Roll.');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
