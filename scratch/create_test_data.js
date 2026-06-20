const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTestData() {
    console.log('--- Creating Test Data for Workflow Verification ---');

    try {
        // 1. Get a property to use
        const property = await prisma.property.findFirst();
        if (!property) {
            console.error('No property found. Please create a property first.');
            return;
        }

        // 2. Scenario 1: Unit Ready but Requirements Missing
        // Should appear in "Blocked - Missing Requirements"
        const unit1 = await prisma.unit.create({
            data: {
                propertyId: property.id,
                unitNumber: 'TEST-BLOCKED',
                name: 'TEST-BLOCKED',
                status: 'Vacant',
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
                unit_ready_completed: true, // Unit is physically ready
            }
        });

        const tenant1 = await prisma.user.create({
            data: {
                email: 'tenant.blocked.' + Date.now() + '@test.com',
                name: 'Test Tenant Blocked',
                role: 'TENANT',
                type: 'INDIVIDUAL'
            }
        });

        const lease1 = await prisma.lease.create({
            data: {
                unitId: unit1.id,
                tenantId: tenant1.id,
                startDate: new Date(),
                endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                status: 'Active',
                monthlyRent: 1500,
                securityDeposit: 1500,
            }
        });

        // Initialize Move-In for Unit 1
        await prisma.moveIn.create({
            data: {
                unitId: unit1.id,
                leaseId: lease1.id,
                status: 'REQUIREMENTS_PENDING',
                targetDate: new Date(),
                missingItems: ['Rent', 'Deposit', 'Insurance'] // Requirements missing
            }
        });
        console.log('✅ Created Scenario 1: Unit Ready, Requirements Missing (TEST-BLOCKED)');


        // 3. Scenario 2: Unit Ready and Requirements Met
        // Should appear in "Ready for Move-In Inspection"
        const unit2 = await prisma.unit.create({
            data: {
                propertyId: property.id,
                unitNumber: 'TEST-READY',
                name: 'TEST-READY',
                status: 'Vacant',
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
                unit_ready_completed: true,
            }
        });

        const tenant2 = await prisma.user.create({
            data: {
                email: 'tenant.ready.' + Date.now() + '@test.com',
                name: 'Test Tenant Ready',
                role: 'TENANT',
                type: 'INDIVIDUAL'
            }
        });

        const lease2 = await prisma.lease.create({
            data: {
                unitId: unit2.id,
                tenantId: tenant2.id,
                startDate: new Date(),
                endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                status: 'Active',
                monthlyRent: 2000,
                securityDeposit: 2000,
            }
        });

        // Create paid invoices for Unit 2
        await prisma.invoice.create({
            data: {
                invoiceNo: 'INV-TEST-RENT-' + Date.now(),
                tenantId: tenant2.id,
                unitId: unit2.id,
                leaseId: lease2.id,
                amount: 2000,
                rent: 2000,
                serviceFees: 0,
                balanceDue: 0,
                paidAmount: 2000,
                status: 'paid',
                category: 'RENT',
                month: 'May 2026',
                dueDate: new Date()
            }
        });

        await prisma.invoice.create({
            data: {
                invoiceNo: 'INV-TEST-DEP-' + Date.now(),
                tenantId: tenant2.id,
                unitId: unit2.id,
                leaseId: lease2.id,
                amount: 2000,
                rent: 0,
                serviceFees: 2000,
                balanceDue: 0,
                paidAmount: 2000,
                status: 'paid',
                category: 'SECURITY_DEPOSIT',
                month: 'May 2026',
                dueDate: new Date()
            }
        });

        // Create active insurance
        await prisma.insurance.create({
            data: {
                userId: tenant2.id,
                leaseId: lease2.id,
                policyNumber: 'TEST-POL-123',
                provider: 'Test Insurance',
                status: 'ACTIVE',
                startDate: new Date(),
                endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            }
        });

        // Initialize Move-In for Unit 2
        await prisma.moveIn.create({
            data: {
                unitId: unit2.id,
                leaseId: lease2.id,
                status: 'READY_FOR_MOVE_IN',
                targetDate: new Date(),
                missingItems: [] // No missing items
            }
        });
        console.log('✅ Created Scenario 2: Unit Ready, Requirements Met (TEST-READY)');


        // 4. Scenario 3: Expired Lease, No New Tenant
        // Should NOT appear in Move-In Dashboard
        const unit3 = await prisma.unit.create({
            data: {
                propertyId: property.id,
                unitNumber: 'TEST-EXPIRED',
                name: 'TEST-EXPIRED',
                status: 'Vacant',
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
            }
        });

        await prisma.lease.create({
            data: {
                unitId: unit3.id,
                tenantId: tenant1.id, // Reuse tenant 1
                startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
                endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Expired yesterday
                status: 'Expired',
                monthlyRent: 1200,
                securityDeposit: 1200,
            }
        });
        // We do NOT create a Move-In record here.
        console.log('✅ Created Scenario 3: Expired Lease, No New Tenant (TEST-EXPIRED)');

        console.log('\n--- Data Creation Complete ---');
        console.log('Please refresh your Move-In Dashboard to see the results.');

    } catch (error) {
        console.error('Error creating test data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

createTestData();
