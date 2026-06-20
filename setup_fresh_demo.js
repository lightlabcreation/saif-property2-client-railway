const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Creating FULL FRESH setup for Demo...");
        // 1. Find ANY unit to link to
        const unit = await prisma.unit.findFirst({ select: { id: true } });
        if (!unit) {
            console.log("No unit found");
            return;
        }

        const uniqueSuffix = Date.now();
        const freshTenant = await prisma.user.create({
            data: {
                name: `Fresh Demo Tenant ${uniqueSuffix}`,
                email: `freshdemo${uniqueSuffix}@example.com`,
                role: 'TENANT',
                phone: "1234567890"
            }
        });
        console.log(`Created Tenant: ID ${freshTenant.id}`);

        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        const lease = await prisma.lease.create({
            data: {
                unitId: unit.id,
                tenantId: freshTenant.id,
                startDate: lastYear,
                endDate: lastMonth,
                status: 'Expired',
                monthlyRent: 1500,
                securityDeposit: 1500
            }
        });
        console.log(`Created Expired Lease ID ${lease.id}`);

        await prisma.invoice.create({
            data: {
                invoiceNo: `INV-FRESH-${uniqueSuffix}`,
                tenantId: freshTenant.id,
                unitId: unit.id,
                leaseId: lease.id,
                month: "Jan 2026",
                amount: 1500,
                rent: 0,
                serviceFees: 0,
                status: "paid",
                paidAmount: 1500,
                category: "SECURITY_DEPOSIT",
                description: "Security Deposit Payment",
                balanceDue: 0
            }
        });
        console.log("Created Paid Security Deposit Invoice for fresh tenant!");
        console.log("Setup COMPLETELY ready.");

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
