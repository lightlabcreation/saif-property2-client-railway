const prisma = require('./config/prisma');

async function syncReadFlags() {
    try {
        console.log("🛠️  Syncing Read flags in database...");
        const result = await prisma.message.updateMany({
            where: {
                isRead: true,
                isReadByAdmin: false
            },
            data: {
                isReadByAdmin: true
            }
        });
        console.log(`✅ Fixed ${result.count} messages where read status was out of sync.`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

syncReadFlags();
