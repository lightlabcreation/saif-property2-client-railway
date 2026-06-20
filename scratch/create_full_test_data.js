const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createFullTestData() {
    console.log('--- Creating Comprehensive Test Data ---');
    const ts = Date.now();

    try {
        const property = await prisma.property.findFirst();
        if (!property) {
            console.error('No property found.');
            return;
        }

        // --- 1. MOVE-IN DASHBOARD SCENARIOS ---

        // Scenario 1: Blocked by Requirements (Money missing)
        const unit1 = await prisma.unit.create({
            data: {
                propertyId: property.id,
                unitNumber: 'TEST-BLOCKED-' + ts,
                name: 'TEST-BLOCKED-' + ts,
                status: 'Vacant',
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
                unit_ready_completed: true,
                bedrooms: 2
            }
        });

        const tenant1 = await prisma.user.create({
            data: {
                email: `blocked.${ts}@test.com`,
                name: 'Tenant Blocked ' + ts,
                role: 'TENANT',
                type: 'INDIVIDUAL'
            }
        });

        const lease1 = await prisma.lease.create({
            data: {
                unitId: unit1.id,
                tenantId: tenant1.id,
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                status: 'Active',
                monthlyRent: 1500,
                securityDeposit: 1500,
            }
        });

        await prisma.moveIn.create({
            data: {
                unitId: unit1.id,
                leaseId: lease1.id,
                status: 'REQUIREMENTS_PENDING',
                targetDate: new Date(),
                missingItems: ['Rent', 'Deposit']
            }
        });

        // Scenario 2: Ready for Inspection (Money Paid + Rooms for Wizard)
        const unit2 = await prisma.unit.create({
            data: {
                propertyId: property.id,
                unitNumber: 'TEST-READY-' + ts,
                name: 'TEST-READY-' + ts,
                status: 'Vacant',
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
                unit_ready_completed: true,
                bedrooms: 3
            }
        });

        // Add rooms to TEST-READY so the Room Navigator works in the Wizard
        const rooms = ['Entrance', 'Kitchen', 'Living Room', 'Bedroom 1', 'Bathroom'];
        for (let i = 0; i < rooms.length; i++) {
            await prisma.bedroom.create({
                data: {
                    unitId: unit2.id,
                    bedroomNumber: `Room-${i+1}`,
                    roomNumber: i + 1,
                    status: 'Vacant'
                }
            });
        }

        const tenant2 = await prisma.user.create({
            data: {
                email: `ready.${ts}@test.com`,
                name: 'Tenant Ready ' + ts,
                role: 'TENANT',
                type: 'INDIVIDUAL'
            }
        });

        const lease2 = await prisma.lease.create({
            data: {
                unitId: unit2.id,
                tenantId: tenant2.id,
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                status: 'Active',
                monthlyRent: 2000,
                securityDeposit: 2000,
            }
        });

        // Create paid invoices
        await prisma.invoice.create({
            data: {
                invoiceNo: 'INV-R-' + ts,
                tenantId: tenant2.id,
                unitId: unit2.id,
                leaseId: lease2.id,
                amount: 2000,
                rent: 2000,
                paidAmount: 2000,
                status: 'paid',
                category: 'RENT',
                month: 'May 2026',
                dueDate: new Date()
            }
        });

        await prisma.invoice.create({
            data: {
                invoiceNo: 'INV-D-' + ts,
                tenantId: tenant2.id,
                unitId: unit2.id,
                leaseId: lease2.id,
                amount: 2000,
                rent: 0,
                serviceFees: 2000,
                paidAmount: 2000,
                status: 'paid',
                category: 'SECURITY_DEPOSIT',
                month: 'May 2026',
                dueDate: new Date()
            }
        });

        // Insurance
        await prisma.insurance.create({
            data: {
                userId: tenant2.id,
                leaseId: lease2.id,
                policyNumber: 'POL-' + ts,
                provider: 'Test Insure',
                status: 'ACTIVE',
                startDate: new Date(),
                endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            }
        });

        await prisma.moveIn.create({
            data: {
                unitId: unit2.id,
                leaseId: lease2.id,
                status: 'READY_FOR_MOVE_IN',
                targetDate: new Date(),
                missingItems: []
            }
        });

        // --- 2. MOVE-OUT DASHBOARD SCENARIOS ---

        // Create 2 Move-Outs for May
        for (let i = 1; i <= 2; i++) {
            const uOut = await prisma.unit.create({
                data: {
                    propertyId: property.id,
                    unitNumber: `TEST-OUT-${i}-${ts}`,
                    name: `TEST-OUT-${i}-${ts}`,
                    status: 'Occupied'
                }
            });

            const tOut = await prisma.user.create({
                data: {
                    email: `out${i}.${ts}@test.com`,
                    name: `Tenant Out ${i} ${ts}`,
                    role: 'TENANT'
                }
            });

            const lOut = await prisma.lease.create({
                data: {
                    unitId: uOut.id,
                    tenantId: tOut.id,
                    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
                    endDate: new Date(2026, 4, 15 + i), // May 16, May 17 2026
                    status: 'Active'
                }
            });

            await prisma.moveOut.create({
                data: {
                    unitId: uOut.id,
                    leaseId: lOut.id,
                    status: 'PENDING',
                    targetDate: lOut.endDate
                }
            });
        }

        console.log('✅ TEST-BLOCKED: Created (Move-In Col 3)');
        console.log('✅ TEST-READY: Created with 5 Rooms (Move-In Col 4 + Wizard Navigator)');
        console.log('✅ TEST-OUT: 2 Move-Outs created for May (Move-Out Dashboard)');
        console.log('\nAll dummy data is ready.');

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

createFullTestData();
