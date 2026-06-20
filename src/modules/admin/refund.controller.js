const prisma = require('../../config/prisma');

// GET /api/admin/refunds
exports.getRefunds = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [refunds, total] = await Promise.all([
            prisma.refundAdjustment.findMany({
                include: {
                    tenant: true,
                    unit: true
                },
                orderBy: {
                    date: 'desc'
                },
                skip,
                take: limit
            }),
            prisma.refundAdjustment.count()
        ]);

        const formatted = refunds.map(r => ({
            id: r.requestId,
            type: r.type,
            reason: r.reason,
            tenant: r.tenant?.name || (r.tenant?.firstName ? `${r.tenant.firstName} ${r.tenant.lastName || ''}`.trim() : 'Unknown Tenant'),
            tenantId: r.tenantId,
            unit: r.unit.name,
            unitId: r.unitId,
            amount: parseFloat(r.amount),
            date: r.date.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric'
            }),
            status: r.status,
            issuedDate: r.issuedDate ? r.issuedDate.toISOString().split('T')[0] : null,
            method: r.method,
            referenceNumber: r.referenceNumber,
            proofUrl: r.proofUrl,
            outcomeReason: r.outcomeReason || 'Pending review'
        }));

        res.json({
            data: formatted,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/refunds
exports.createRefund = async (req, res) => {
    try {
        const { type, reason, tenantId, unitId, amount, status, date, issuedDate, method, referenceNumber, proofUrl, outcomeReason, allocations } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Concurrency Check: Verify deposit balance hasn't been used yet
            const depositInvoices = await tx.invoice.findMany({
                where: {
                    tenantId: parseInt(tenantId),
                    unitId: parseInt(unitId), // UNIT-AWARE: Only consider deposits for this unit
                    OR: [
                        { category: 'SECURITY_DEPOSIT' },
                        { description: { contains: 'Security Deposit' } }
                    ],
                    paidAmount: { gt: 0 }
                }
            });
            const totalDepositPaid = depositInvoices.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || 0), 0);
            
            const existingRefunds = await tx.refundAdjustment.findMany({
                where: {
                    tenantId: parseInt(tenantId),
                    unitId: parseInt(unitId), // UNIT-AWARE
                    status: { in: ['Completed', 'Issued'] }
                }
            });
            const totalRefundedAlready = existingRefunds.reduce((sum, r) => sum + Math.abs(parseFloat(r.amount || 0)), 0);
            const availableDeposit = Math.max(0, totalDepositPaid - totalRefundedAlready);

            const requestedAmount = parseFloat(amount) || 0;
            if (requestedAmount > availableDeposit) {
                throw new Error(`Insufficient security deposit balance. You requested $${requestedAmount}, but only $${availableDeposit} is available for this unit after previous refunds and deductions.`);
            }

            // 2. Generate Request ID (Robust logic: Find max existing ID instead of count)
            const lastRefund = await tx.refundAdjustment.findFirst({
                orderBy: { id: 'desc' }
            });
            const nextNum = (lastRefund?.id || 0) + 1;
            const requestId = `RA-${String(nextNum).padStart(5, '0')}`;

            // 3. Create Refund Adjustment Record
            let finalIssuedDate = issuedDate ? new Date(issuedDate) : null;
            if (status === 'Completed' && !finalIssuedDate) {
                finalIssuedDate = new Date();
            }

            const refund = await tx.refundAdjustment.create({
                data: {
                    requestId,
                    type,
                    reason,
                    tenantId: parseInt(tenantId),
                    unitId: parseInt(unitId),
                    amount: requestedAmount,
                    status: status || 'Pending',
                    date: date ? new Date(date) : new Date(),
                    issuedDate: finalIssuedDate,
                    method: method || null,
                    referenceNumber: referenceNumber || null,
                    proofUrl: proofUrl || null,
                    outcomeReason: outcomeReason || 'Pending review',
                    createdBy: req.user?.id || 1
                }
            });

            // 4. Process Allocations (Deductions) if Status is Completed
            if (status === 'Completed') {
                let finalAllocations = [];
                if (allocations && Array.isArray(allocations) && allocations.length > 0) {
                    finalAllocations = allocations;
                } else if (type === 'Security Deposit' && unitId) {
                    // AUTO-ALLOCATION: Find unpaid Rent for this unit
                    const unpaidRent = await tx.invoice.findMany({
                        where: { tenantId: parseInt(tenantId), unitId: parseInt(unitId), category: 'RENT', status: { not: 'paid' } },
                        orderBy: { dueDate: 'asc' }
                    });
                    
                    // Priority Security: We must reserve the 'requestedAmount' for the cash refund first
                    // so we don't accidentally allocate it to rent.
                    let tempPool = availableDeposit - requestedAmount;

                    for (const inv of unpaidRent) {
                        if (tempPool <= 0) break;
                        const ded = Math.min(tempPool, parseFloat(inv.balanceDue));
                        finalAllocations.push({ invoiceId: inv.id, amount: ded });
                        tempPool -= ded;
                    }
                }

                for (const allocation of finalAllocations) {
                    const invoice = await tx.invoice.findUnique({ where: { id: allocation.invoiceId } });
                    if (!invoice) continue;

                    const invAmount = parseFloat(invoice.amount) || 0;
                    const invPaid = parseFloat(invoice.paidAmount) || 0;
                    const remainingToPay = Math.max(0, invAmount - invPaid);
                    
                    // SAFETY GUARD: Never allocate more than what is actually remaining
                    const allocAmount = Math.min(parseFloat(allocation.amount), remainingToPay);
                    if (allocAmount <= 0) continue;

                    const newPaidAmount = invPaid + allocAmount;
                    const newBalanceDue = Math.max(0, invAmount - newPaidAmount);

                    // Update Invoice
                    await tx.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            paidAmount: newPaidAmount,
                            balanceDue: newBalanceDue,
                            status: newBalanceDue <= 0 ? 'paid' : 'partial',
                            paidAt: newBalanceDue <= 0 ? new Date() : undefined
                        }
                    });

                    // Create Payment Record
                    await tx.payment.create({
                        data: {
                            invoiceId: invoice.id,
                            amount: allocAmount,
                            method: 'Security Deposit Allocation',
                            reference: requestId,
                            date: new Date()
                        }
                    });

                    // Accounting Ledger: Double-Entry (Dr Liability, Cr Income)
                    const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                    const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;
                    
                    // 1. Decrease Liability
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            description: `SD Allocation [Liability Deduction]: ${invoice.invoiceNo} (${invoice.category}) - ${requestId}`,
                            type: 'Liability Deduction',
                            amount: allocAmount,
                            balance: prevBalance - allocAmount,
                            status: 'Completed',
                            invoiceId: invoice.id
                        }
                    });

                    // 2. Increase Income OR Transfer Liability
                    const isIncome = invoice.category !== 'SECURITY_DEPOSIT' && !invoice.description?.toLowerCase().includes('deposit');
                    
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            description: `SD Allocation [${isIncome ? 'Income Record' : 'Liability Transfer'}]: ${invoice.invoiceNo} (${invoice.category}) - ${requestId}`,
                            type: isIncome ? 'Income' : 'Liability Transfer',
                            amount: allocAmount,
                            balance: prevBalance, 
                            status: 'Completed',
                            invoiceId: invoice.id
                        }
                    });
                }
            }

            // 5. Final Ledger for Cash Refund if applicable
            if (status === 'Completed' && type.toLowerCase().includes('refund')) {
                // The stored 'amount' represents the CASH part now
                const cashRefunded = requestedAmount;

                if (cashRefunded > 0) {
                    const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                    const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            description: `Security Deposit Cash Refund - ${requestId}`,
                            type: 'Liability Refund',
                            amount: cashRefunded,
                            balance: prevBalance - cashRefunded,
                            status: 'Completed'
                        }
                    });
                }
            }

            // Notification for Security Deposit
            if (type.toLowerCase().includes('deposit') || reason.toLowerCase().includes('deposit')) {
                await tx.message.create({
                    data: {
                        content: `Notification: A ${type} of $${requestedAmount} has been processed for your account. Reason: ${reason}`,
                        senderId: req.user?.id || 1,
                        receiverId: parseInt(tenantId)
                    }
                });
            }

            return refund;
        });

        res.status(201).json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating refund: ' + e.message });
    }
};

// PUT /api/admin/refunds/:id
exports.updateRefund = async (req, res) => {
    try {
        const { status, reason, amount, issuedDate, method, referenceNumber, proofUrl, outcomeReason } = req.body;
        const { id } = req.params;

        const updated = await prisma.$transaction(async (tx) => {
            const current = await tx.refundAdjustment.findUnique({
                where: { requestId: id }
            });

            if (!current) throw new Error('Refund not found');

            // Audit Lock: Prevent silent edits AFTER completion
            if (current.status === 'Completed' && status !== 'Completed') {
                throw new Error('Cannot modify or un-post a record that is already marked as Completed.');
            }

            // Smart Date Logic: Auto-populate issuedDate on completion
            let finalIssuedDate = issuedDate ? new Date(issuedDate) : (current.issuedDate || undefined);
            if (status === 'Completed' && current.status !== 'Completed' && !issuedDate) {
                finalIssuedDate = new Date(); // Set to now if completing
            } else if (status === 'Pending') {
                finalIssuedDate = null; // Clear if pending
            }

            const updatedRefund = await tx.refundAdjustment.update({
                where: { requestId: id },
                data: {
                    status,
                    reason,
                    amount: amount ? parseFloat(amount) : undefined,
                    issuedDate: finalIssuedDate,
                    method: method !== undefined ? method : undefined,
                    referenceNumber: referenceNumber !== undefined ? referenceNumber : undefined,
                    proofUrl: proofUrl !== undefined ? proofUrl : undefined,
                    outcomeReason: outcomeReason !== undefined ? outcomeReason : undefined
                }
            });

            // Process Allocations if status is moving TO Completed
            if (status === 'Completed' && current.status !== 'Completed' && req.body.allocations && Array.isArray(req.body.allocations)) {
                for (const allocation of req.body.allocations) {
                    const invoice = await tx.invoice.findUnique({ where: { id: allocation.invoiceId } });
                    if (!invoice) continue;

                    const invAmount = parseFloat(invoice.amount) || 0;
                    const invPaid = parseFloat(invoice.paidAmount) || 0;
                    const remainingToPay = Math.max(0, invAmount - invPaid);
                    
                    // SAFETY GUARD: Never allocate more than what is actually remaining
                    const allocAmount = Math.min(parseFloat(allocation.amount), remainingToPay);
                    if (allocAmount <= 0) continue;

                    const newPaidAmount = invPaid + allocAmount;
                    const newBalanceDue = Math.max(0, invAmount - newPaidAmount);

                    // Update Invoice
                    await tx.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            paidAmount: newPaidAmount,
                            balanceDue: newBalanceDue,
                            status: newBalanceDue <= 0 ? 'paid' : 'partial',
                            paidAt: newBalanceDue <= 0 ? new Date() : undefined
                        }
                    });

                    // Create Payment Record
                    await tx.payment.create({
                        data: {
                            invoiceId: invoice.id,
                            amount: allocAmount,
                            method: 'Security Deposit Allocation',
                            reference: id,
                            date: new Date()
                        }
                    });

                    // Accounting Ledger: Double-Entry (Deduction from Liability + Income Record)
                    const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                    const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;
                    
                    // 1. Decrease Liability
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            description: `SD Allocation [Liability Deduction]: ${invoice.invoiceNo} (${invoice.category}) - ${id}`,
                            type: 'Liability Deduction',
                            amount: allocAmount,
                            balance: prevBalance - allocAmount,
                            status: 'Completed',
                            invoiceId: invoice.id
                        }
                    });

                    // 2. Increase Income OR Transfer Liability (Correcting Accounting Labels)
                    const isIncome = invoice.category !== 'SECURITY_DEPOSIT' && !invoice.description?.toLowerCase().includes('deposit');

                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            description: `SD Allocation [${isIncome ? 'Income Record' : 'Liability Transfer'}]: ${invoice.invoiceNo} (${invoice.category}) - ${id}`,
                            type: isIncome ? 'Income' : 'Liability Transfer',
                            amount: allocAmount,
                            balance: prevBalance, // Transfer: No net change to global cash
                            status: 'Completed',
                            invoiceId: invoice.id
                        }
                    });

                }
            }

            // Ledger Entry (Accounting Requirement) - Only if moving TO Completed
            if (status === 'Completed' && current.status !== 'Completed') {
                const refundamt = Math.abs(parseFloat(amount || updatedRefund.amount)) || 0;
                
                const existingTx = await tx.transaction.findFirst({
                    where: { description: { contains: id } }
                });

                if (!existingTx) {
                    const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                    const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            description: `${updatedRefund.type} Refund - ${id}`,
                            type: updatedRefund.type.toLowerCase().includes('deposit') ? 'Liability' : 'Expense',
                            amount: refundamt,
                            balance: prevBalance - refundamt,
                            status: 'Completed'
                        }
                    });
                }
            }

            return updatedRefund;
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating refund' });
    }
};

// DELETE /api/admin/refunds/:id
exports.deleteRefund = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.refundAdjustment.delete({
            where: { requestId: id }
        });
        res.json({ message: 'Refund record deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting refund' });
    }
};

// GET /api/admin/refunds/calculate/:tenantId
exports.calculateRefund = async (req, res) => {
    try {
        const tenantId = parseInt(req.params.tenantId);
        const unitId = req.query.unitId ? parseInt(req.query.unitId) : null;

        if (!unitId) {
            return res.status(400).json({ message: "Unit ID is required for accurate refund calculation. Please select a unit." });
        }

        // 1. Get Paid Security Deposits (STRICTLY UNIT-AWARE)
        const depositInvoices = await prisma.invoice.findMany({
            where: {
                tenantId,
                unitId: unitId, 
                OR: [
                    { category: 'SECURITY_DEPOSIT' },
                    { description: { contains: 'Security Deposit' } }
                ],
                paidAmount: { gt: 0 }
            }
        });

        const totalDepositPaid = depositInvoices.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || 0), 0);

        // 2. Subtract ALL existing refund records (CASH part) - STRICTLY UNIT-AWARE
        const existingRefunds = await prisma.refundAdjustment.findMany({
            where: {
                tenantId,
                unitId: unitId,
                status: { in: ['Completed', 'Issued'] }
            }
        });
        const totalRefundedInCash = existingRefunds.reduce((sum, r) => sum + Math.abs(parseFloat(r.amount || 0)), 0);

        // 3. Subtract ALL existing allocations (DEDUCTION part) - STRICTLY UNIT-AWARE
        const existingAllocations = await prisma.payment.findMany({
            where: {
                invoice: { 
                    tenantId,
                    unitId: unitId
                },
                method: 'Security Deposit Allocation'
            }
        });
        const totalAllocatedSoFar = existingAllocations.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        // TRUE Available Cash = Total Paid - Total Refunds - Total Deductions
        const availableDeposit = Math.max(0, totalDepositPaid - totalRefundedInCash - totalAllocatedSoFar);

        // Security Guard: Check if lease has actually Ended/Expired for AUTO-ALLOCATION
        const hasEndedLease = await prisma.lease.findFirst({
            where: {
                tenantId,
                unitId: unitId,
                status: { in: ['Expired', 'Ended'] }
            }
        });

        if (!hasEndedLease) {
            // Return only balance, no proposed allocations
            return res.json({ 
                tenantId,
                unitId,
                totalDepositPaid,
                availableDeposit,
                proposedAllocations: [], 
                message: "Manual Adjustment Mode: Lease is still Active. Automatic priority deductions (Rent/Fees) are disabled until lease ends." 
            });
        }

        // 3. Get Outstanding Invoices (Priority: Service first, then Rent) - STRICTLY UNIT-AWARE
        const outstandingInvoices = await prisma.invoice.findMany({
            where: {
                tenantId,
                unitId: unitId,
                status: { not: 'paid' },
                balanceDue: { gt: 0 }
            },
            orderBy: [
                { category: 'desc' }, // SERVICE > RENT if alphabetical (S > R)
                { dueDate: 'asc' }
            ]
        });

        // 4. Perform Priority Allocation Logic
        let remainingToAllocate = availableDeposit;
        const proposedAllocations = [];

        // Clear Service Fees first
        const serviceInvoices = outstandingInvoices.filter(inv => inv.category === 'SERVICE');
        for (const inv of serviceInvoices) {
            const balance = parseFloat(inv.balanceDue);
            const canAlloc = Math.min(remainingToAllocate, balance);
            if (canAlloc > 0) {
                proposedAllocations.push({
                    invoiceId: inv.id,
                    invoiceNo: inv.invoiceNo,
                    category: inv.category,
                    amount: canAlloc,
                    fullBalance: balance
                });
                remainingToAllocate -= canAlloc;
            }
        }

        // Clear Rent next
        const rentInvoices = outstandingInvoices.filter(inv => inv.category === 'RENT');
        for (const inv of rentInvoices) {
            const balance = parseFloat(inv.balanceDue);
            const canAlloc = Math.min(remainingToAllocate, balance);
            if (canAlloc > 0) {
                proposedAllocations.push({
                    invoiceId: inv.id,
                    invoiceNo: inv.invoiceNo,
                    category: inv.category,
                    amount: canAlloc,
                    fullBalance: balance
                });
                remainingToAllocate -= canAlloc;
            }
        }

        const totalDeductions = proposedAllocations.reduce((sum, a) => sum + a.amount, 0);
        const finalRefundAmount = remainingToAllocate; // Priority 3: Refund the rest

        res.json({
            tenantId,
            totalDepositPaid,
            totalRefundedAlready: totalRefundedInCash,
            availableDeposit,
            totalDeductions,
            finalRefundAmount,
            proposedAllocations
        });

    } catch (e) {
        console.error('Calculate Refund Error:', e);
        res.status(500).json({ message: 'Error calculating refund: ' + (e.message || 'Server error') });
    }
};
