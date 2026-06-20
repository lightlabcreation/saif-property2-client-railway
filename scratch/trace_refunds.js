const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listDeductions() {
    const txs = await prisma.transaction.findMany({
        where: {
            OR: [
                { type: { contains: 'Liability' } },
                { description: { contains: 'Liability' } },
                { description: { contains: 'Allocation' } },
                { description: { contains: 'Refund' } }
            ]
        }
    });
    
    console.log("Found deductions/refunds:");
    txs.forEach(t => {
        console.log(`Date: ${t.date}, Type: ${t.type}, Amount: ${t.amount}, Desc: ${t.description}`);
    });
    process.exit(0);
}

listDeductions();
