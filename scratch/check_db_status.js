const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Testing database connection...');
    await prisma.$connect();
    console.log('Connected successfully!');

    console.log('Checking MoveOut table...');
    const moveOutCount = await prisma.moveOut.count();
    console.log(`MoveOut count: ${moveOutCount}`);

    console.log('Checking Lease table...');
    const leaseCount = await prisma.lease.count();
    console.log(`Lease count: ${leaseCount}`);

  } catch (error) {
    console.error('Database check failed:');
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
