const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://root:iaNGRpTFZqOBMuuhicnPBXdmLwdmbaLn@yamabiko.proxy.rlwy.net:18357/railway"
    }
  }
});

async function fixRA00040() {
    try {
        console.log('Starting data correction for RA-00040...');
        
            // 1. Find the Refund Adjustment
            const refund = await prisma.refundAdjustment.findUnique({
                where: { requestId: 'RA-00040' }
            });
            
            if (!refund) {
                throw new Error('Could not find RA-00040 in the database.');
            }
            console.log(`Found RA-00040. TenantID: ${refund.tenantId}, UnitID: ${refund.unitId}`);

            // 2. Find and delete the $0 dummy transaction
            const dummyTx = await prisma.transaction.findFirst({
                where: {
                    description: { contains: 'RA-00040' },
                    amount: 0
                }
            });
            
            if (dummyTx) {
                await prisma.transaction.delete({ where: { id: dummyTx.id } });
                console.log(`Deleted $0 dummy transaction (ID: ${dummyTx.id}).`);
            } else {
                console.log(`No $0 dummy transaction found, moving on.`);
            }

            // 3. Find the unpaid rent invoice
            const unpaidRent = await prisma.invoice.findMany({
                where: { 
                    tenantId: refund.tenantId, 
                    unitId: refund.unitId, 
                    category: 'RENT', 
                    status: { not: 'paid' } 
                },
                orderBy: { dueDate: 'asc' }
            });

            if (unpaidRent.length === 0) {
                console.log('No unpaid rent invoices found. Maybe it was already updated?');
                return;
            }

            const invoice = unpaidRent[0];
            const allocAmount = parseFloat(invoice.balanceDue);
            
            console.log(`Found unpaid rent invoice ${invoice.invoiceNo} for $${allocAmount}. Applying deposit...`);

            // 4. Update the invoice
            const invAmount = parseFloat(invoice.amount) || 0;
            const invPaid = parseFloat(invoice.paidAmount) || 0;
            const newPaidAmount = invPaid + allocAmount;
            const newBalanceDue = Math.max(0, invAmount - newPaidAmount);

            await prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                    paidAmount: newPaidAmount,
                    balanceDue: newBalanceDue,
                    status: newBalanceDue <= 0 ? 'paid' : 'partial',
                    paidAt: newBalanceDue <= 0 ? new Date() : undefined
                }
            });
            console.log(`Invoice ${invoice.invoiceNo} marked as paid.`);

            // 5. Create Payment Record
            await prisma.payment.create({
                data: {
                    invoiceId: invoice.id,
                    amount: allocAmount,
                    method: 'Security Deposit Allocation',
                    reference: refund.requestId,
                    date: new Date()
                }
            });
            console.log(`Payment record created.`);

            // 6. Create Ledger Entries
            const lastTx = await prisma.transaction.findFirst({ orderBy: { id: 'desc' } });
            const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

            // 6a. Liability Deduction
            await prisma.transaction.create({
                data: {
                    date: new Date(),
                    description: `SD Allocation [Liability Deduction]: ${invoice.invoiceNo} (${invoice.category}) - ${refund.requestId}`,
                    type: 'Liability Deduction',
                    amount: allocAmount,
                    balance: prevBalance - allocAmount,
                    status: 'Completed',
                    invoiceId: invoice.id
                }
            });

            // 6b. Income
            await prisma.transaction.create({
                data: {
                    date: new Date(),
                    description: `SD Allocation [Income Record]: ${invoice.invoiceNo} (${invoice.category}) - ${refund.requestId}`,
                    type: 'Income',
                    amount: allocAmount,
                    balance: prevBalance, // Transfer: No net change to global cash
                    status: 'Completed',
                    invoiceId: invoice.id
                }
            });
            console.log(`Double-entry ledger transactions (Liability Deduction and Income) created successfully.`);
        
        console.log('✅ RA-00040 data correction completed successfully!');
    } catch (error) {
        console.error('❌ Data correction failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

fixRA00040();
