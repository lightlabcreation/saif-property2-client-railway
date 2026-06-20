const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkInvoicesWithUnits() {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { notIn: ['paid', 'draft'] }
    },
    select: {
      id: true,
      category: true,
      description: true,
      balanceDue: true,
      status: true,
      unitId: true,
      tenantId: true
    }
  });

  console.log('Unpaid Invoices:', JSON.stringify(invoices, null, 2));

  const units = await prisma.unit.findMany({
    select: { id: true, name: true, unitNumber: true }
  });
  console.log('Units:', JSON.stringify(units, null, 2));

  await prisma.$disconnect();
}

checkInvoicesWithUnits();
