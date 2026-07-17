const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://root:iaNGRpTFZqOBMuuhicnPBXdmLwdmbaLn@yamabiko.proxy.rlwy.net:18357/railway"
    }
  }
});

async function rollbackRA00040() {
    try {
        console.log('Starting rollback for RA-00040...');
        
        // 1. Find the payment created by the fix script
        const payment = await prisma.payment.findFirst({
            where: { reference: 'RA-00040' }
        });

        if (!payment) {
            console.log('Could not find the payment record for RA-00040. Rollback may have already been completed or the data is not in the expected state.');
            return;
        }

        const rollbackAmount = parseFloat(payment.amount);
        console.log(`Found Payment record for $${rollbackAmount}. Deleting payment...`);

        // 2. Delete the payment record
        await prisma.payment.delete({
            where: { id: payment.id }
        });

        // 3. Rollback the invoice
        const invoice = await prisma.invoice.findUnique({
            where: { id: payment.invoiceId }
        });

        if (invoice) {
            const invPaid = parseFloat(invoice.paidAmount) || 0;
            const invBalance = parseFloat(invoice.balanceDue) || 0;
            
            const newPaidAmount = Math.max(0, invPaid - rollbackAmount);
            const newBalanceDue = invBalance + rollbackAmount;
            
            let newStatus = 'partial';
            if (newPaidAmount === 0) {
                newStatus = 'unpaid'; // Or whatever default unpaid status your schema uses
            }

            console.log(`Reverting Invoice ${invoice.invoiceNo}: Subtracting $${rollbackAmount} from paid amount.`);
            
            await prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                    paidAmount: newPaidAmount,
                    balanceDue: newBalanceDue,
                    status: newStatus,
                    paidAt: null // Remove the paid date
                }
            });
        }

        // 4. Delete the Ledger Transactions created
        // The previous script created two transactions that contained "RA-00040" in the description
        const transactions = await prisma.transaction.findMany({
            where: {
                description: { contains: 'RA-00040' },
                invoiceId: payment.invoiceId
            }
        });

        if (transactions.length > 0) {
            console.log(`Found ${transactions.length} ledger transactions related to RA-00040. Deleting...`);
            for (const tx of transactions) {
                await prisma.transaction.delete({
                    where: { id: tx.id }
                });
                console.log(`Deleted transaction: ${tx.description} (Amount: $${tx.amount})`);
            }
        } else {
            console.log('No related ledger transactions found.');
        }

        console.log('✅ RA-00040 Rollback completed successfully! Data has been restored.');
        console.log('➡️ You can now run the corrected fix_ra_00040.js script to apply the $1,450.');
        
    } catch (error) {
        console.error('❌ Rollback failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

rollbackRA00040();
