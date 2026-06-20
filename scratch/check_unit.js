const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const unit = await prisma.unit.findFirst({
    where: { unitNumber: 'tst' },
    include: { leases: { where: { status: 'Active' } } }
  });
  console.log(JSON.stringify(unit, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
