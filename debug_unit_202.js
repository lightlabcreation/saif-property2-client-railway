const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();

async function debug() {
    try {
        console.log('--- Unit 202 Debugging ---');
        const unit = await prisma.unit.findFirst({
            where: { unitNumber: '202' },
            include: { 
                bedroomsList: true,
                leases: { include: { tenant: true } }
            }
        });

        if (!unit) {
            console.log('Unit 202 not found');
            return;
        }

        console.log(`Unit ID: ${unit.id}, Status: ${unit.status}, Rental Mode: ${unit.rentalMode}`);
        console.log('Bedrooms in unit:');
        unit.bedroomsList.forEach(b => {
            console.log(`- ID: ${b.id}, Number: ${b.bedroomNumber}, Status: ${b.status}`);
        });

        const bedroomIds = unit.bedroomsList.map(b => b.id);

        const users = await prisma.user.findMany({
            where: { bedroomId: { in: bedroomIds } },
            select: { id: true, name: true, bedroomId: true }
        });
        console.log('Users linked to these bedrooms:', JSON.stringify(users, null, 2));

        const leases = await prisma.lease.findMany({
            where: { 
                bedroomId: { in: bedroomIds },
                status: { in: ['Active', 'DRAFT'] }
            },
            include: { tenant: { select: { name: true } } }
        });
        console.log('Active/Draft leases linked to these bedrooms:', JSON.stringify(leases.map(l => ({
            id: l.id,
            status: l.status,
            bedroomId: l.bedroomId,
            tenant: l.tenant?.name
        })), null, 2));

    } catch (e) {
        console.error('Error during debug:', e);
    } finally {
        await prisma.$disconnect();
    }
}

debug();
