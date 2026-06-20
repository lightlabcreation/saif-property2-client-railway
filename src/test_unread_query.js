const prisma = require('./config/prisma');

async function testUnreadQuery() {
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
        console.log(`Query result: ${count}`);
        
        const unread = await prisma.message.findMany({
            where: {
                direction: 'INBOUND',
                isReadByAdmin: false
            },
            include: { sender: { include: { leases: true, residentLease: true } } }
        });
        
        unread.forEach(m => {
            console.log(`Msg ${m.id} from ${m.senderId}: Role=${m.sender.role}, Leases=${m.sender.leases.length}, ActiveLeases=${m.sender.leases.filter(l => l.status === 'Active').length}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

testUnreadQuery();
