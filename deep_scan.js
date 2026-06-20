const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deepScan() {
  try {
    // 1. Get ALL records using Raw SQL (This won't crash if an enum is bad)
    const records = await prisma.$queryRaw`SELECT id, status FROM MoveOut`;
    console.log('All Records in DB:', records);
    
    // 2. Fix anything that isn't perfect
    for (const record of records) {
        if (!record.status || record.status === '' || record.status === ' ') {
            console.log(`FIXING BAD RECORD ID: ${record.id}`);
            await prisma.$executeRaw`UPDATE MoveOut SET status = 'PENDING' WHERE id = ${record.id}`;
        }
    }

    console.log('Deep scan and repair finished.');
  } catch (e) {
    console.error('Deep scan error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

deepScan();
