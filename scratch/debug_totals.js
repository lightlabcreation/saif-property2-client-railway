const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAccounting() {
    try {
        const transactions = await prisma.transaction.findMany();
        console.log(`Found ${transactions.length} transactions.`);
        
        let stats = {
            rent: 0,
            deposits: 0,
            fees: 0,
            refunds: 0
        };

        transactions.forEach(tx => {
            const desc = (tx.description || '').toLowerCase();
            const amount = parseFloat(tx.amount || 0);
            const isRefund = desc.includes('refund') || (tx.type && tx.type.toLowerCase().includes('refund'));

            if (isRefund) {
                stats.refunds += amount;
            } else if (desc.includes('rent')) {
                stats.rent += amount;
            } else if (desc.includes('deposit')) {
                stats.deposits += amount;
            } else if (desc.includes('fee')) {
                stats.fees += amount;
            }
        });

        console.log("Database Totals (Raw Transactions):");
        console.log("Rent:", stats.rent);
        console.log("Deposits:", stats.deposits);
        console.log("Fees:", stats.fees);
        console.log("Refunds:", stats.refunds);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

checkAccounting();
