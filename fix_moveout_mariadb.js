const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  try {
    // Find MoveOut for 86-203
    const moveOut = await prisma.moveOut.findFirst({
      where: {
        unit: { unitNumber: '86-203' },
        status: { notIn: ['COMPLETED', 'CANCELLED'] }
      }
    });

    if (moveOut) {
      console.log('Found MoveOut:', moveOut.id);
      
      // Correct syntax for MariaDB/MySQL
      await prisma.$executeRaw`UPDATE MoveOut SET status = 'INSPECTION_IN_PROGRESS', visualInspectionId = 3, finalInspectionId = 3 WHERE id = ${moveOut.id}`;
      
      console.log('Updated MoveOut status to INSPECTION_IN_PROGRESS');
    } else {
      console.log('MoveOut not found for 86-203');
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

fix();
