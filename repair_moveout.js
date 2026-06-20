const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function repair() {
  try {
    // Find records with invalid or empty status using raw SQL
    // In MariaDB, we can just check for empty string or null
    await prisma.$executeRaw`UPDATE MoveOut SET status = 'PENDING' WHERE status = '' OR status IS NULL`;
    
    console.log('Repaired all records with empty or null status');
    
    // Also check for any status that is not in the enum (just in case)
    const validStatuses = ['PENDING', 'CONFIRMED', 'VISUAL_INSPECTION_SCHEDULED', 'FINAL_INSPECTION_SCHEDULED', 'INSPECTION_IN_PROGRESS', 'INSPECTIONS_COMPLETED', 'COMPLETED', 'CANCELLED'];
    
    const allRecords = await prisma.moveOut.findMany({ select: { id: true, status: true } });
    console.log('Current statuses:', allRecords.map(r => r.status));
    
  } catch (e) {
    console.error('Repair error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

repair();
