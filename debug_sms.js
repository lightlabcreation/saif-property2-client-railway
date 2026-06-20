const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const inboundCount = await prisma.message.count({
      where: { direction: 'INBOUND' }
    });
    console.log(`Total Inbound Messages: ${inboundCount}`);

    const lastInbound = await prisma.message.findFirst({
      where: { direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { name: true, phone: true } },
        receiver: { select: { name: true } }
      }
    });

    if (lastInbound) {
      console.log('Last Inbound Message:', JSON.stringify(lastInbound, null, 2));
    } else {
      console.log('No inbound messages found.');
    }

    const sampleUsers = await prisma.user.findMany({
      take: 5,
      select: { id: true, name: true, phone: true, role: true }
    });
    console.log('Sample Users and Phones:', JSON.stringify(sampleUsers, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
