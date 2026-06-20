const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Checking owner...");
        const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
        if (!owner) {
            console.log("NO_OWNER found in database.");
            return;
        }
        console.log(`Owner found: ${owner.email} (${owner.id})`);

        console.log("Linking owner to all properties...");
        const properties = await prisma.property.findMany();
        for (const p of properties) {
            await prisma.property.update({
                where: { id: p.id },
                data: { owners: { connect: { id: owner.id } } }
            });
            console.log(`Linked property: ${p.name}`);
        }

        console.log("Creating dummy overdue 'RENT' invoices to show outstanding dues...");
        const tenants = await prisma.user.findMany({ where: { role: 'TENANT' }, take: 3 });
        if (tenants.length === 0) {
            console.log("No tenants found to create invoices for.");
        }

        for (const t of tenants) {
            const num = 'INV-' + Date.now() + Math.floor(Math.random() * 100);
            await prisma.invoice.create({
                data: {
                    tenantId: t.id,
                    invoiceNo: num, // Corrected field name based on schema
                    amount: 1500,
                    status: 'Overdue',
                    invoiceDate: new Date(),
                    dueDate: new Date(Date.now() - 86400000 * 10), // 10 days ago
                    type: 'RENT'
                }
            });
            console.log(`Created overdue RENT invoice for tenant: ${t.name || t.email}`);
        }

        console.log("DUMMY DATA SETUP COMPLETE.");
    } catch (e) {
        console.error("ERROR:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
