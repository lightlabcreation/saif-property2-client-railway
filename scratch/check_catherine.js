const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCatherine() {
    const catherine = await prisma.tenant.findFirst({
        where: { name: { contains: 'Catherine' } },
        include: {
            invoices: {
                where: { category: 'SECURITY_DEPOSIT' },
                orderBy: { createdAt: 'desc' }
            }
        }
    });

    if (!catherine) {
        console.log("Tenant Catherine not found.");
        process.exit(0);
    }

    console.log(`Tenant: ${catherine.name}`);
    catherine.invoices.forEach(inv => {
        console.log(`- ${inv.invoiceNo}: Amt: ${inv.amount}, Paid: ${inv.paidAmount}, Status: ${inv.status}, Created: ${inv.createdAt}`);
    });

    process.exit(0);
}

checkCatherine();
