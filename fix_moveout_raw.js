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
      
      // Use raw SQL to bypass Prisma Client enum validation for the fix
      await prisma.$executeRaw`UPDATE "MoveOut" SET status = 'INSPECTION_IN_PROGRESS', "visualInspectionId" = 3, "finalInspectionId" = 3 WHERE id = ${moveOut.id}`;
      
      console.log('Updated MoveOut status to INSPECTION_IN_PROGRESS via Raw SQL');
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
