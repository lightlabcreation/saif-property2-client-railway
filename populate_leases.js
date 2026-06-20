const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
        if (!owner) {
            console.log("No owner found.");
            return;
        }

        const properties = await prisma.property.findMany({
            where: { owners: { some: { id: owner.id } } },
            include: { units: { include: { bedroomsList: true, leases: { where: { status: 'Active' } } } } }
        });

        const tenants = await prisma.user.findMany({ where: { role: 'TENANT' } });
        if (tenants.length === 0) {
            console.log("No tenants available to create leases.");
            return;
        }

        let leaseCount = 0;
        for (const p of properties) {
            for (const u of p.units) {
                if (u.rentalMode === 'FULL_UNIT' && u.leases.length === 0) {
                    const tenant = tenants[Math.floor(Math.random() * tenants.length)];
                    await prisma.lease.create({
                        data: {
                            unitId: u.id,
                            tenantId: tenant.id,
                            startDate: new Date('2025-01-01'),
                            endDate: new Date('2026-03-31'),
                            monthlyRent: u.rentAmount || 1200,
                            status: 'Active'
                        }
                    });
                    leaseCount++;
                } else if (u.rentalMode === 'BEDROOM_WISE') {
                    for (const eb of u.bedroomsList) {
                        const existingLease = await prisma.lease.findFirst({
                            where: { bedroomId: eb.id, status: 'Active' }
                        });
                        if (!existingLease) {
                            const tenant = tenants[Math.floor(Math.random() * tenants.length)];
                            await prisma.lease.create({
                                data: {
                                    unitId: u.id,
                                    bedroomId: eb.id,
                                    tenantId: tenant.id,
                                    startDate: new Date('2025-01-01'),
                                    endDate: new Date('2026-03-31'),
                                    monthlyRent: eb.rentAmount || 600,
                                    status: 'Active'
                                }
                            });
                            leaseCount++;
                        }
                    }
                }
            }
        }

        console.log(`Successfully created ${leaseCount} dummy active leases for the owner's properties.`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
