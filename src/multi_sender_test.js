const prisma = require('./config/prisma');

async function multiSenderSimulation() {
    try {
        // 1. Find two non-admin users
        const users = await prisma.user.findMany({
            where: { role: { in: ['TENANT', 'OWNER'] } },
            take: 2
        });

        if (users.length < 2) {
            console.error("Not enough non-admin users to simulate.");
            return;
        }

        const senderA = users[0];
        const senderB = users[1];

        console.log(`📨 Simulation: Two senders...`);
        console.log(`- Sender A: ${senderA.name} (ID: ${senderA.id})`);
        console.log(`- Sender B: ${senderB.name} (ID: ${senderB.id})`);

        // 2. Clear pre-existing unread for these users to be clean
        await prisma.message.updateMany({
            where: { senderId: { in: [senderA.id, senderB.id] }, direction: 'INBOUND' },
            data: { isRead: true, isReadByAdmin: true }
        });

        // 3. Create unread messages
        await prisma.message.create({
            data: {
                content: `Test from ${senderA.name}`,
                senderId: senderA.id,
                receiverId: 1,
                isRead: false,
                isReadByAdmin: false,
                direction: 'INBOUND',
                sentVia: 'sms'
            }
        });

        await prisma.message.create({
            data: {
                content: `Test from ${senderB.name}`,
                senderId: senderB.id,
                receiverId: 1,
                isRead: false,
                isReadByAdmin: false,
                direction: 'INBOUND',
                sentVia: 'sms'
            }
        });

        console.log(`✅ TEST READY: The header should show "2" unread messages.`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

multiSenderSimulation();
