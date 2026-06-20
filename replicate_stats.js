const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function replicateFrontendLogic() {
    try {
        // Fetch exactly what the controller returns
        const txs = await prisma.transaction.findMany({
            include: {
                invoice: { select: { category: true, tenant: { select: { name: true } } } },
                payment: { include: { invoice: { select: { category: true, tenant: { select: { name: true } } } } } }
            }
        });

        const completedRefunds = await prisma.refundAdjustment.findMany({
            where: { status: 'Completed' },
            include: { tenant: { select: { name: true } } }
        });

        // 1. FORMAT
        let allData = txs.map(t => {
            const desc = (t.description || '').toLowerCase();
            return {
                id: t.id,
                description: t.description,
                type: (t.type || '').toUpperCase(),
                amount: parseFloat(t.amount),
                category: t.payment?.invoice?.category || t.invoice?.category || (desc.includes('deposit') ? 'SECURITY_DEPOSIT' : null)
            };
        });

        // 2. SYNC
        const seenRefundIdsInTx = new Set();
        allData.forEach(t => {
            const match = t.description.match(/RA-\d+/);
            if (match) seenRefundIdsInTx.add(match[0]);
        });

        completedRefunds.forEach(ref => {
            if (!seenRefundIdsInTx.has(ref.requestId)) {
                allData.push({
                    id: `legacy-${ref.requestId}`,
                    description: `${ref.type} Refund - ${ref.requestId}`,
                    type: 'LIABILITY',
                    amount: parseFloat(ref.amount),
                    category: ref.type.toUpperCase().includes('DEPOSIT') ? 'SECURITY_DEPOSIT' : 'REFUND'
                });
            }
        });

        // 3. AGGREGATE STATS (The Frontend Logic)
        let totalRefunds = 0;
        allData.forEach(t => {
            const desc = (t.description || '').toLowerCase();
            const type = (t.type || '').toUpperCase();
            const amount = Math.abs(t.amount);

            const isLiabilityDeduction = ['LIABILITY', 'LIABILITY TRANSFER', 'LIABILITY DEDUCTION', 'LIABILITY REFUND'].includes(type) || desc.includes('refund');

            if (isLiabilityDeduction) {
                totalRefunds += amount;
            }
        });

        console.log(`--- ACCOUNTING STATS AUDIT ---`);
        console.log(`Calculated totalRefunds: $${totalRefunds.toLocaleString()}`);

    } catch (e) { console.error(e); }
    finally { await prisma.$disconnect(); }
}

replicateFrontendLogic();
