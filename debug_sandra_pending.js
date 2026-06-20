const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugSandraPending() {
    const today = new Date();
    
    const pendingRefundsRaw = await prisma.invoice.findMany({
        where: {
            paidAmount: { gt: 0 },
            OR: [
                { category: 'SECURITY_DEPOSIT' },
                { description: { contains: 'Security Deposit' } }
            ],
            lease: {
                endDate: { lt: today }
            }
        },
        include: {
            tenant: {
                include: {
                    refundAdjustments: true
                }
            },
            unit: { include: { property: true } },
            lease: true
        }
    });

    console.log('Total Raw Found:', pendingRefundsRaw.length);

    const sandraRaw = pendingRefundsRaw.find(inv => inv.tenant?.name?.includes('Sandra'));
    if (!sandraRaw) {
        console.log('Sandra not found in raw list');
    } else {
        console.log('Sandra Invoice ID:', sandraRaw.id);
        const adjustments = sandraRaw.tenant?.refundAdjustments || [];
        console.log('Sandra Adjustments count:', adjustments.length);
        console.log('Sandra Adjustments:', JSON.stringify(adjustments, null, 2));

        const hasFinishedOrCancelled = adjustments.some(adj =>
            ['Completed', 'Issued', 'Cancelled', 'Received'].includes(adj.status)
        );
        console.log('hasFinishedOrCancelled:', hasFinishedOrCancelled);
        console.log('Filtered out?:', hasFinishedOrCancelled);
    }
}

debugSandraPending()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
