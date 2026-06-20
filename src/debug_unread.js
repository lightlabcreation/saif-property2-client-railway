const prisma = require('./config/prisma');

async function debugUnread() {
    try {
        const unread = await prisma.message.findMany({
            where: {
                direction: 'INBOUND',
                isReadByAdmin: false
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true, isActive: true }
                }
            }
        });
        
        if (unread.length === 0) {
            console.log("No unread messages found in database.");
        } else {
            console.log(`Found ${unread.length} unread messages:`);
            unread.forEach(m => {
                console.log(`- From: ${m.sender?.name} (ID: ${m.senderId}, Role: ${m.sender?.role}, Active: ${m.sender?.isActive})`);
                console.log(`  Content: "${m.content}"`);
                console.log(`  ID in DB: ${m.id}`);
            });
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debugUnread();
