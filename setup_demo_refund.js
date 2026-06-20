const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Searching for Demo Tenant...");
        const tenant = await prisma.user.findFirst({
            where: {
                role: 'TENANT',
                OR: [
                    { name: { contains: 'demo' } },
                    { firstName: { contains: 'demo' } }
                ]
            },
            include: { leases: true }
        });

        if (!tenant) {
            console.log("No 'Demo' tenant found. I will create one to be safe.");
            // Let's create a full setup to avoid messing up existing data.
            // 1. Find a unit
            const unit = await prisma.unit.findFirst({ include: { property: true } });
            if (!unit) {
                console.log("No units found to attach data to.");
                return;
            }

            // 2. Create Tenant
            const newTenant = await prisma.user.create({
                data: {
                    name: "Demo Test Tenant",
                    email: "demotest@example.com",
                    role: "TENANT",
                    phone: "1234567890"
                }
            });
            console.log(`Created Tenant: ${newTenant.name} (ID: ${newTenant.id})`);

            // 3. Create Expired Lease
            const lastYear = new Date();
            lastYear.setFullYear(lastYear.getFullYear() - 1);
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);

            const lease = await prisma.lease.create({
                data: {
                    unitId: unit.id,
                    tenantId: newTenant.id,
                    startDate: lastYear,
                    endDate: lastMonth,
                    status: 'Expired', // status doesn't matter for the query, but good practice
                    monthlyRent: 1200,
                    securityDeposit: 1000
                }
            });
            console.log(`Created Expired Lease: ID ${lease.id}`);

            // 4. Create Paid Security Deposit Invoice
            await prisma.invoice.create({
                data: {
                    invoiceNo: `INV-DEMO-${Date.now()}`,
                    tenantId: newTenant.id,
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
            console.log("Created Paid Security Deposit Invoice.");
            console.log("Setup complete for NEW tenant.");
        } else {
            console.log(`Found Tenant: ${tenant.name} (ID: ${tenant.id})`);
            // Check if they already have an expired lease
            const expiredLease = tenant.leases.find(l => new Date(l.endDate) < new Date());
            let targetLease = expiredLease;

            const unit = await prisma.unit.findFirst();

            if (!targetLease) {
                console.log("No expired lease found for this tenant. Creating one.");
                const lastYear = new Date();
                lastYear.setFullYear(lastYear.getFullYear() - 1);
                const lastMonth = new Date();
                lastMonth.setMonth(lastMonth.getMonth() - 1);

                targetLease = await prisma.lease.create({
                    data: {
                        unitId: tenant.unitId || unit.id,
                        tenantId: tenant.id,
                        startDate: lastYear,
                        endDate: lastMonth,
                        status: 'Expired',
                        monthlyRent: 1000,
                        securityDeposit: 800
                    }
                });
                console.log(`Created Expired Lease ID ${targetLease.id}`);
            } else {
                console.log(`Using existing Expired Lease ID ${targetLease.id}`);
            }

            // Create Paid Security Deposit Invoice
            // Check if one exists
            const existingInv = await prisma.invoice.findFirst({
                where: {
                    tenantId: tenant.id,
                    status: 'paid',
                    OR: [
                        { category: 'SECURITY_DEPOSIT' },
                        { description: { contains: 'Security Deposit' } }
                    ]
                }
            });

            if (!existingInv) {
                console.log("Creating Paid Security Deposit Invoice.");
                await prisma.invoice.create({
                    data: {
                        invoiceNo: `INV-DEMO-${Date.now()}`,
                        tenantId: tenant.id,
                        unitId: targetLease.unitId,
                        leaseId: targetLease.id,
                        month: "Jan 2026",
                        amount: 800,
                        rent: 0,
                        serviceFees: 0,
                        status: "paid",
                        paidAmount: 800,
                        category: "SECURITY_DEPOSIT",
                        description: "Security Deposit Payment",
                        balanceDue: 0
                    }
                });
            } else {
                console.log("Paid Security Deposit Invoice already exists.");
            }
            console.log("Setup complete for existing tenant.");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
