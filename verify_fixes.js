const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Setting up Verification Data...");

        // 1. Find or Create Property/Unit
        let unit = await prisma.unit.findFirst({ include: { property: true } });
        if (!unit) {
            console.log("No units found. Please create a property and unit first.");
            return;
        }

        // 2. Create "Fix Verification" Tenant
        const tenantName = "Fix Verification Tenant";
        let tenant = await prisma.user.findFirst({ where: { name: tenantName } });
        if (!tenant) {
            tenant = await prisma.user.create({
                data: {
                    name: tenantName,
                    email: `verify@example.com`,
                    role: "TENANT",
                    phone: "555-0199"
                }
            });
            console.log("Created Verification Tenant.");
        }

        // 3. Create Expired Lease
        const expires = new Date();
        expires.setDate(expires.getDate() - 10); // Expired 10 days ago
        const starts = new Date();
        starts.setFullYear(starts.getFullYear() - 1);

        const lease = await prisma.lease.create({
            data: {
                unitId: unit.id,
                tenantId: tenant.id,
                startDate: starts,
                endDate: expires,
                status: 'Expired',
                monthlyRent: 1500,
                securityDeposit: 1200
            }
        });
        console.log("Created Expired Lease.");

        // 4. Create Paid Security Deposit Invoice ($1,200)
        await prisma.invoice.create({
            data: {
                invoiceNo: `INV-FIXV-${Date.now()}`,
                tenantId: tenant.id,
                unitId: unit.id,
                leaseId: lease.id,
                month: "Jan 2026",
                amount: 1200,
                rent: 0,
                serviceFees: 0,
                status: "paid",
                paidAmount: 1200,
                category: "SECURITY_DEPOSIT",
                description: "Initial Security Deposit",
                balanceDue: 0
            }
        });
        console.log("Created Paid Invoice ($1,200).");

        // 5. Create a PREVIOUSLY COMPLETED Partial Refund ($400)
        // This will test the new subtraction logic in calculateRefund
        const requestId = `RA-FIX-${Math.floor(Math.random() * 10000)}`;
        await prisma.refundAdjustment.create({
            data: {
                requestId,
                type: "Security Deposit",
                reason: "Partial refund issued for early cleanup bonus.",
                tenantId: tenant.id,
                unitId: unit.id,
                amount: 400,
                status: "Completed",
                date: new Date(new Date().setDate(new Date().getDate() - 5)), // Requested 5 days ago
                issuedDate: new Date(), // Issued today
                method: "Bank Transfer",
                outcomeReason: "Partial refund"
            }
        });
        console.log("Created Completed Partial Refund ($400).");

        console.log("\n--- VERIFICATION READY ---");
        console.log(`Tenant: ${tenantName}`);
        console.log("Total Deposit: $1,200");
        console.log("Already Refunded: $400");
        console.log("NEW Recommended Balance should be: $800");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
