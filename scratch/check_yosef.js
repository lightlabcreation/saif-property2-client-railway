const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkYosef() {
    const yosef = await prisma.tenant.findFirst({
        where: { OR: [{ name: { contains: 'Youssef' } }, { name: { contains: 'Yosef' } }] },
        include: {
            invoices: true,
            payments: true
        }
    });

    if (!yosef) {
        console.log("Tenant Yosef not found.");
        process.exit(0);
    }

    console.log(`Tenant: ${yosef.name}`);
    console.log("Invoices:");
    yosef.invoices.forEach(inv => {
        console.log(`- ${inv.invoiceNo}: Amt: ${inv.amount}, Paid: ${inv.paidAmount}, Bal: ${inv.balanceDue}, Status: ${inv.status}`);
    });

    process.exit(0);
}

checkYosef();
