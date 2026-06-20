const prisma = require('./config/prisma');

async function simulateMultipleSMS() {
    try {
        console.log("📨 Simulating 2 incoming SMS messages from Property Owner (ID: 2)...");
        
        await prisma.message.create({
            data: {
                content: "🔥 Test Message 1: Are you there?",
                senderId: 2,
                receiverId: 1,
                isRead: false,
                isReadByAdmin: false,
                direction: 'INBOUND',
                sentVia: 'sms'
            }
        });

        await prisma.message.create({
            data: {
                content: "🔥 Test Message 2: Please let me know!",
                senderId: 2,
                receiverId: 1,
                isRead: false,
                isReadByAdmin: false,
                direction: 'INBOUND',
                sentVia: 'sms'
            }
        });

        console.log(`✅ 2 Simulation messages created. Check your dashboard!`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

simulateMultipleSMS();
