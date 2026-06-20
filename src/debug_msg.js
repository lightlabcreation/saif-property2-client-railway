const prisma = require('./config/prisma');

async function debugMessage() {
    try {
        const msg = await prisma.message.findUnique({
            where: { id: 15 }
        });
        console.log(JSON.stringify(msg, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debugMessage();
