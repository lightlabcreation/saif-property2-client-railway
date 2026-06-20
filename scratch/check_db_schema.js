const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const tables = await prisma.$queryRaw`SHOW TABLES`;
    console.log('Tables in database:', tables);

    // Check inspection columns
    try {
        const columns = await prisma.$queryRaw`DESCRIBE inspection`;
        console.log('Columns in inspection:', columns);
    } catch (e) {
        console.log('Inspection table might not exist or error describing it.');
    }

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
