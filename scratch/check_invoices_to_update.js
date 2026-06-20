const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const invoices = await prisma.invoice.findMany({
        where: {
            category: 'SERVICE',
            OR: [
                { description: 'Security Deposit' },
                { invoiceNo: { startsWith: 'INV-DEP' } }
            ]
        }
    });

    console.log(`Found ${invoices.length} invoices to update.`);
    invoices.forEach(inv => {
        console.log(`- ${inv.invoiceNo}: ${inv.description}`);
    });

    await prisma.$disconnect();
}

check();
