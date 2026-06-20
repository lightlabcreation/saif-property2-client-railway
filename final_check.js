const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    // 1. Check all MoveOut records
    const records = await prisma.moveOut.findMany();
    console.log('Total MoveOut records:', records.length);
    
    // 2. Identify the ones with invalid status
    const validStatuses = ['PENDING', 'CONFIRMED', 'VISUAL_INSPECTION_SCHEDULED', 'FINAL_INSPECTION_SCHEDULED', 'INSPECTION_IN_PROGRESS', 'INSPECTIONS_COMPLETED', 'COMPLETED', 'CANCELLED'];
    
    for (const record of records) {
        if (!validStatuses.includes(record.status)) {
            console.log(`INVALID STATUS FOUND! ID: ${record.id}, Status: "${record.status}"`);
            
            // Fix it immediately
            await prisma.moveOut.update({
                where: { id: record.id },
                data: { status: 'PENDING' }
            });
            console.log(`ID ${record.id} fixed to PENDING`);
        }
    }

    console.log('Final check complete.');
  } catch (e) {
    console.error('Check error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
