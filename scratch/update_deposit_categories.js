const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function update() {
    const result = await prisma.invoice.updateMany({
        where: {
            category: 'SERVICE',
            OR: [
                { description: 'Security Deposit' },
                { invoiceNo: { startsWith: 'INV-DEP' } }
            ]
        },
        data: {
            category: 'SECURITY_DEPOSIT'
        }
    });

    console.log(`Updated ${result.count} invoices to SECURITY_DEPOSIT.`);
    await prisma.$disconnect();
}

update();
