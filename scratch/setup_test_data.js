const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setup() {
    try {
        // 1. Find an occupied unit with an active lease and no Move-Out
        const unit = await prisma.unit.findFirst({
            where: { 
                status: 'OCCUPIED',
                leases: { some: { status: 'ACTIVE' } },
                moveOuts: { none: {} }
            },
            include: { leases: { where: { status: 'ACTIVE' } } }
        });

        if (!unit) {
            console.log('No suitable occupied unit found to test the full flow.');
            return;
        }

        const currentLease = unit.leases[0];
        console.log('Targeting Unit:', unit.unitNumber);

        // 2. Create Move-Out Record
        const moveOut = await prisma.moveOut.create({
            data: {
                unitId: unit.id,
                leaseId: currentLease.id,
                status: 'PENDING',
                targetDate: new Date(Date.now() + 86400000 * 5)
            }
        });

        // 3. Create Future Tenant (User)
        const futureTenant = await prisma.user.create({
            data: {
                name: 'DUMMY TEST TENANT',
                email: 'dummy' + Date.now() + '@test.com',
                phone: '1234567890',
                role: 'TENANT'
            }
        });

        // 4. Create Reserved Lease
        const futureLease = await prisma.lease.create({
            data: {
                unitId: unit.id,
                tenantId: futureTenant.id,
                status: 'RESERVED',
                startDate: new Date(Date.now() + 86400000 * 10),
                endDate: new Date(Date.now() + 86400000 * 375),
                monthlyRent: 1500,
                securityDeposit: 1500
            }
        });

        // 5. Create Move-In Record (Mandatory for Dashboard Visibility)
        const moveIn = await prisma.moveIn.create({
            data: {
                unitId: unit.id,
                leaseId: futureLease.id,
                status: 'BLOCKED_IN_PREPARATION', // Since current tenant is still there
                targetDate: futureLease.startDate,
                missingItems: ['Rent', 'Deposit', 'Insurance']
            }
        });

        console.log(`SUCCESS!`);
        console.log(`- Move-Out created for current unit: ${unit.unitNumber}`);
        console.log(`- Future Tenant created: ${futureTenant.name}`);
        console.log(`- Move-In Record created (Status: BLOCKED_IN_PREPARATION)`);
        console.log(`\nNext Steps:`);
        console.log(`1. Go to Move-Out Dashboard and find Unit ${unit.unitNumber}`);
        console.log(`2. Complete the Move-Out Inspection and create a "Blocking" ticket.`);
        console.log(`3. Go to Move-In Dashboard and see Unit ${unit.unitNumber} in the Blocked column!`);

    } catch (e) {
        console.error('Error during setup:', e);
    } finally {
        await prisma.$disconnect();
    }
}

setup();
