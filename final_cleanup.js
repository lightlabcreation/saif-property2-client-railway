const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
    console.log("Cleaning up legacy units...");
    
    // 1. Find units that have active leases
    const unitsWithLeases = await prisma.unit.findMany({
        where: {
            leases: {
                some: {
                    status: 'Active'
                }
            }
        }
    });

    console.log(`Found ${unitsWithLeases.length} units with active leases.`);

    for (const unit of unitsWithLeases) {
        await prisma.unit.update({
            where: { id: unit.id },
            data: {
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
                availability_status: 'Occupied' 
            }
        });
    }

    // 2. Activate units that were already "Available" or "Occupied" but wrongly default to INACTIVE
    const liveStatuses = await prisma.unit.findMany({
        where: {
            status: { in: ['Available', 'Occupied'] },
            unit_status: 'INACTIVE'
        }
    });

    console.log(`Found ${liveStatuses.length} units that were already live but marked inactive.`);

    for (const unit of liveStatuses) {
        await prisma.unit.update({
            where: { id: unit.id },
            data: {
                unit_status: 'ACTIVE',
                ready_for_leasing: true,
                availability_status: unit.status === 'Available' ? 'Available' : 'Occupied'
            }
        });
    }

    console.log("SUCCESS: All existing leased/live units are now marked as ACTIVE.");
}

cleanup()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
