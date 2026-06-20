const prisma = require('../../config/prisma');

// GET /api/admin/accounting/transactions
exports.getTransactions = async (req, res) => {
    try {
        // 1. Fetch official transactions
        const txs = await prisma.transaction.findMany({
            orderBy: { date: 'desc' },
            include: {
                invoice: { select: { category: true, tenant: { select: { name: true } } } },
                payment: { include: { invoice: { select: { category: true, tenant: { select: { name: true } } } } } }
            }
        });

        // 2. Fetch all completed refunds (to find any not yet captured in the transaction table)
        const completedRefunds = await prisma.refundAdjustment.findMany({
            where: { status: 'Completed' },
            include: { tenant: { select: { name: true } } }
        });

        const formatted = txs.map(t => {
            const tenantName = 
                t.payment?.invoice?.tenant?.name || 
                t.invoice?.tenant?.name || 
                "Administrative";

            const desc = (t.description || '').toLowerCase();
            let category = t.payment?.invoice?.category || t.invoice?.category || null;

            // SMART CATEGORIZATION (Matches Revenue Dashboard Logic)
            if (!category) {
                if (desc.includes('deposit')) category = 'SECURITY_DEPOSIT';
                else if (desc.includes('rent') || desc.includes('lease')) category = 'RENT';
                else if (desc.includes('service') || desc.includes('fee')) category = 'SERVICE';
            } else {
                // Catch the specific case where description says "Deposit" but category was "SERVICE"
                if (desc.includes('deposit')) category = 'SECURITY_DEPOSIT';
            }

            return {
                id: t.id,
                date: t.date.toISOString().split('T')[0],
                tenant: tenantName,
                description: t.description,
                category: category,
                type: t.type,
                amount: parseFloat(t.amount),
                balance: parseFloat(t.balance),
                status: t.status,
                paymentId: t.paymentId,
                invoiceId: t.invoiceId,
                isSystemTx: true
            };
        });

        // 3. 🟢 SMART SYNC: Inject missing RefundAdjustments that aren't in the Transaction table
        // We identify them by checking for the Request ID (RA-XXXXX) in the description
        const seenRefundIdsInTx = new Set();
        formatted.forEach(t => {
            const match = t.description.match(/RA-\d+/);
            if (match) seenRefundIdsInTx.add(match[0]);
        });

        completedRefunds.forEach(ref => {
            if (!seenRefundIdsInTx.has(ref.requestId)) {
                // This refund exists in the refund table but hasn't been posted to the ledger yet
                formatted.push({
                    id: `legacy-${ref.requestId}`,
                    date: ref.date.toISOString().split('T')[0],
                    tenant: ref.tenant?.name || "Tenant",
                    description: `${ref.type} Refund - ${ref.requestId}`,
                    category: ref.type.toUpperCase().includes('DEPOSIT') ? 'SECURITY_DEPOSIT' : 'REFUND',
                    type: 'LIABILITY', // Matches the logic for deductions
                    amount: parseFloat(ref.amount),
                    balance: 0, // Will be recalculated
                    status: 'Completed',
                    isSystemTx: false
                });
            }
        });

        // 4. Sort everything by date DESC again after merging
        const sortedAll = formatted.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 5. Deduplication Layer (Remove exact duplicates if any exist)
        const seenPayments = new Set();
        const seenRefs = new Set();
        
        const uniqueTxs = sortedAll.filter(t => {
            if (t.paymentId) {
                if (seenPayments.has(t.paymentId)) return false;
                seenPayments.add(t.paymentId);
            }
            const refundMatch = t.description.match(/REG-\d+|REF-\d+|ADJ-\d+|RA-\d+/);
            if (refundMatch) {
                const requestId = refundMatch[0];
                const typeSuffix = t.description.toLowerCase().includes('allocation') ? 'ALLOC' : 'CASH';
                const uniqueKey = `${requestId}_${typeSuffix}`;
                if (seenRefs.has(uniqueKey)) return false;
                seenRefs.add(uniqueKey);
            }
            return true;
        });

        // 6. 🟢 DIRECT DATA SCAN FOR SUMMARY BOXES (Mirror Revenue Dashboard Exactly)
        const [invStats, refStats, allocStats] = await Promise.all([
          prisma.invoice.findMany({ where: { paidAmount: { gt: 0 } } }),
          prisma.refundAdjustment.findMany({ where: { status: 'Completed' } }),
          prisma.payment.findMany({ where: { method: 'Security Deposit Allocation' } })
        ]);

        let actualRent = 0;
        let actualDeposit = 0;
        let actualServiceFees = 0;
        let actualRefunds = 0;

        invStats.forEach(inv => {
            const amount = parseFloat(inv.paidAmount) || 0;
            const desc = (inv.description || '').toLowerCase();
            const category = (inv.category || '').toUpperCase();
            
            if (category === 'SECURITY_DEPOSIT') actualDeposit += amount;
            else if (category === 'RENT') actualRent += amount;
            else if (desc.includes('deposit')) actualDeposit += amount;
            else if (category === 'SERVICE' || category === 'LATE_FEE') actualServiceFees += amount;
            else if (desc.includes('rent') || desc.includes('lease')) actualRent += amount;
            else if (desc.includes('service') || desc.includes('fee')) actualServiceFees += amount;
            else actualRent += amount;
        });

        refStats.forEach(ref => {
          const amount = Math.abs(parseFloat(ref.amount)) || 0;
          const rType = ref.type.toLowerCase();
          const rReason = (ref.reason || '').toLowerCase();
          
          actualRefunds += amount;
          if (rType.includes('deposit') || rReason.includes('deposit')) actualDeposit -= amount;
          else if (rType.includes('adjustment') || rType.includes('service') || rReason.includes('fee')) actualServiceFees -= amount;
          else actualRent -= amount;
        });

        allocStats.forEach(alloc => {
          actualDeposit -= (parseFloat(alloc.amount) || 0);
        });

        // 7. Balance re-calc for the table list (independent of summary boxes)
        let runningBalance = 0;
        const chronological = [...uniqueTxs].reverse();
        chronological.forEach(t => {
            const typeLower = (t.type || '').toLowerCase();
            const isDeduction = typeLower.includes('refund') || typeLower.includes('liability') || t.description.toLowerCase().includes('allocation');
            const amtVal = parseFloat(t.amount) || 0;
            const amt = isDeduction ? -Math.abs(amtVal) : Math.abs(amtVal);
            runningBalance += amt;
            t.balance = runningBalance;
        });

        // Return to DESC for the UI
        res.json({
            transactions: uniqueTxs,
            stats: {
                totalRent: actualRent,
                totalDeposits: actualDeposit,
                totalFees: actualServiceFees,
                totalRefunds: actualRefunds
            }
        });
    } catch (e) {
        console.error('Accounting Ledger Sync Error:', e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/accounting/transactions
exports.createTransaction = async (req, res) => {
    try {
        const { date, description, type, amount, status } = req.body;

        // Simple balance logic: last balance + amount
        const lastTx = await prisma.transaction.findFirst({
            orderBy: { id: 'desc' }
        });
        const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;
        const newBalance = prevBalance + parseFloat(amount);

        const newTx = await prisma.transaction.create({
            data: {
                date: new Date(date),
                description,
                type,
                amount: parseFloat(amount),
                balance: newBalance,
                status: status || 'Paid'
            }
        });

        res.status(201).json(newTx);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating transaction' });
    }
};
