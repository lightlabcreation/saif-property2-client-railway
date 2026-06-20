const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- SETTING UP DUMMY DATA FOR REFUND VERIFICATION ---');

    // 1. Create/Update Tenant
    const tenant = await prisma.user.upsert({
        where: { email: 'sarah_demo@example.com' },
        update: {},
        create: {
            email: 'sarah_demo@example.com',
            firstName: 'Sarah',
            lastName: 'Demo',
            role: 'TENANT',
            isActive: true
        }
    });
    console.log(`Tenant created/found: Sarah (ID: ${tenant.id})`);

    // 2. Create Units
    const unitA = await prisma.unit.create({
        data: {
            name: '86-UNIT-REPRO-A',
            unitNumber: '86-102',
            propertyId: 6,
            status: 'Vacant',
            unit_status: 'ACTIVE'
        }
    });

    const unitB = await prisma.unit.create({
        data: {
            name: '82-UNIT-REPRO-B',
            unitNumber: '82-402',
            propertyId: 6,
            status: 'Vacant',
            unit_status: 'ACTIVE'
        }
    });
    console.log(`Units created: ${unitA.unitNumber} and ${unitB.unitNumber}`);

    // 3. Create Expired Lease for Unit A (to trigger auto-allocation logic)
    const leaseA = await prisma.lease.create({
        data: {
            tenantId: tenant.id,
            unitId: unitA.id,
            status: 'Expired',
            startDate: new Date('2025-01-01'),
            endDate: new Date('2025-12-31'),
            securityDeposit: 1000
        }
    });

    // 4. Create PAID Security Deposit Invoice for Unit A
    await prisma.invoice.create({
        data: {
            invoiceNo: `INV-${Date.now()}-A`,
            tenantId: tenant.id,
            unitId: unitA.id,
            month: 'January 2026',
            amount: 1000,
            rent: 0,
            paidAmount: 1000,
            balanceDue: 0,
            status: 'paid',
            category: 'SECURITY_DEPOSIT',
            description: 'Security Deposit for Unit 86-102'
        }
    });

    // 5. Create UNPAID Security Deposit Invoice for Unit B (This is the one we want to IGNORE)
    await prisma.invoice.create({
        data: {
            invoiceNo: `INV-${Date.now()}-B`,
            tenantId: tenant.id,
            unitId: unitB.id,
            month: 'January 2026',
            amount: 1100,
            rent: 0,
            paidAmount: 0,
            balanceDue: 1100,
            status: 'unpaid',
            category: 'SECURITY_DEPOSIT',
            description: 'Security Deposit for Unit 82-402'
        }
    });

    console.log('--- SETUP COMPLETE ---');
    console.log('HOW TO TEST:');
    console.log('1. Log in to the dashboard.');
    console.log('2. Go to "Refunds & Adjustments" page.');
    console.log('3. Click "+ Create Refund".');
    console.log('4. Select tenant "Sarah Demo".');
    console.log('5. Select unit "86-102".');
    console.log('--- VERIFICATION ---');
    console.log('EXPECTED (FIXED): The "System Calculation" box should show $1000 available and NO deductions.');
    console.log('BROKEN (OLD): The "System Calculation" box would have shown a $1000 deduction for Unit 82-402.');
    
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
