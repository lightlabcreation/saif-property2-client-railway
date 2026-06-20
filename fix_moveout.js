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
      
      // Find inspections for this lease
      const inspections = await prisma.inspection.findMany({
        where: { leaseId: moveOut.leaseId },
        include: { template: true },
        orderBy: { createdAt: 'desc' }
      });

      const visual = inspections.find(i => i.template.type === 'VISUAL' || i.template.name.toLowerCase().includes('visual'));
      const final = inspections.find(i => i.template.type === 'MOVE_OUT' || i.template.name.toLowerCase().includes('test'));

      await prisma.moveOut.update({
        where: { id: moveOut.id },
        data: {
          status: 'INSPECTION_IN_PROGRESS',
          visualInspectionId: visual ? visual.id : undefined,
          finalInspectionId: final ? final.id : undefined
        }
      });
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
