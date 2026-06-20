const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("=== START DUMMY DATA TEST ===");

        // 1. Find a sample unit to attach the test
        const unit = await prisma.unit.findFirst({ include: { property: true } });
        if (!unit) {
            console.log("No units found backends. Setup aborted.");
            return;
        }

        const uniqueSuffix = Date.now();
        const tenantName = `Demo Dummy Tenant ${uniqueSuffix}`;

        // 2. Create Dummy Tenant
        const tenant = await prisma.user.create({
            data: {
                name: tenantName,
                email: `dummy${uniqueSuffix}@example.com`,
                role: "TENANT",
                phone: "1234567890"
            }
        });
        console.log(`\n👨‍💼 Created Dummy Tenant: ${tenant.name} (ID: ${tenant.id})`);

        // 3. Create Expired Lease
        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        const lease = await prisma.lease.create({
            data: {
                unitId: unit.id,
                tenantId: tenant.id,
                startDate: lastYear,
                endDate: lastMonth,
                status: 'Expired',
                monthlyRent: 1200,
                securityDeposit: 1000
            }
        });
        console.log(`Created Expired Lease ID ${lease.id} for the Tenant.`);

        // 4. Create Paid Security Deposit Invoice ($1,000)
        await prisma.invoice.create({
            data: {
                invoiceNo: `INV-DEP-${uniqueSuffix}`,
                tenantId: tenant.id,
                unitId: unit.id,
                leaseId: lease.id,
                month: "Feb 2026",
                amount: 1000,
                rent: 0,
                serviceFees: 0,
                status: "paid",
                paidAmount: 1000,
                category: "SECURITY_DEPOSIT",
                description: "Security Deposit Payment",
                balanceDue: 0
            }
        });
        console.log("💰 Created Paid Security Deposit Invoice: $1,000.00");

        // 5. Create Unpaid Deductions Service Fee Invoice ($250)
        await prisma.invoice.create({
            data: {
                invoiceNo: `INV-SVC-${uniqueSuffix}`,
                tenantId: tenant.id,
                unitId: unit.id,
                leaseId: lease.id,
                month: "Feb 2026",
                amount: 250.00,
                rent: 0,
                serviceFees: 250.00,
                status: "sent", // typical status for unpaid deduction
                category: "SERVICE",
                description: "Cleaning Fee + FOB Replacement"
            }
        });
        console.log(`📋 Created Service Deductions Invoice: $250.00`);

        // 6. RUN CALCULATION LOGIC (Exact logic from backend setup)
        const depositInvoices = await prisma.invoice.findMany({
            where: {
                tenantId: tenant.id,
                status: 'paid',
                OR: [
                    { category: 'SECURITY_DEPOSIT' },
                    { description: { contains: 'Security Deposit' } }
                ]
            }
        });
        const totalDepositPaid = depositInvoices.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || 0), 0);

        const serviceInvoices = await prisma.invoice.findMany({
            where: {
                tenantId: tenant.id,
                category: 'SERVICE'
            }
        });
        const totalServiceCharges = serviceInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
        const finalRefundAmount = Math.max(0, totalDepositPaid - totalServiceCharges);

        console.log("\n=== 🎯 REFUND CALCULATION RESULTS ===\n");
        console.log(`Original Security Deposit Paid :  $${totalDepositPaid.toFixed(2)}`);
        console.log(`Total Service Fee Deductions   : -$${totalServiceCharges.toFixed(2)}`);
        console.log(`-----------------------------------`);
        console.log(`💰 Final Refund Amount Payable :  $${finalRefundAmount.toFixed(2)}`);
        console.log("\n=====================================");

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
