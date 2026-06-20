const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkInvoices() {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { notIn: ['paid', 'draft'] }
    },
    select: {
      id: true,
      category: true,
      description: true,
      balanceDue: true,
      status: true
    }
  });

  console.log('Unpaid Invoices:', JSON.stringify(invoices, null, 2));
  
  const rentInvoices = invoices.filter(i => i.category === 'RENT');
  const depositInvoices = invoices.filter(i => 
    i.category === 'SECURITY_DEPOSIT' || 
    (i.category === 'SERVICE' && i.description?.includes('Security Deposit'))
  );

  console.log('Rent Total:', rentInvoices.reduce((sum, i) => sum + parseFloat(i.balanceDue), 0));
  console.log('Deposit Total:', depositInvoices.reduce((sum, i) => sum + parseFloat(i.balanceDue), 0));

  await prisma.$disconnect();
}

checkInvoices();
