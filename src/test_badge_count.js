const prisma = require('./config/prisma');

async function testQuery() {
    try {
        const count = await prisma.message.count({
            where: {
                direction: 'INBOUND',
                isReadByAdmin: false,
                sender: {
                    OR: [
                        { role: 'OWNER' },
                        { 
                            AND: [
                                { role: 'TENANT' },
                                { type: { not: 'RESIDENT' } },
                                { leases: { some: { status: 'Active' } } }
                            ]
                        },
                        {
                            AND: [
                                { type: 'RESIDENT' },
                                { residentLease: { status: 'Active' } }
                            ]
                        }
                    ]
                }
            }
        });
        console.log(`Prisma Count Result: ${count}`);
        
        const unread = await prisma.message.findMany({
            where: {
                direction: 'INBOUND',
                isReadByAdmin: false
            },
            include: { sender: { include: { leases: true } } }
        });
        unread.forEach(m => {
            console.log(`Msg ID: ${m.id} from User ID: ${m.senderId} (Role: ${m.sender?.role}, Leases: ${m.sender?.leases?.length})`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

testQuery();
