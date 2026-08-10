const prisma = require('../../config/prisma');
const { generateReceiptPDF } = require('../../utils/pdf.utils');

// GET /api/admin/payments/:id/download
exports.downloadReceiptPDF = async (req, res) => {
    try {
        const { id } = req.params;
        // Try finding by internal ID or invoiceNo
        const invoice = await prisma.invoice.findFirst({
            where: {
                OR: [
                    { id: isNaN(parseInt(id)) ? -1 : parseInt(id) },
                    { invoiceNo: id }
                ]
            },
            include: {
                tenant: true,
                unit: true
            }
        });

        if (!invoice) return res.status(404).json({ message: 'Receipt not found' });

        generateReceiptPDF(invoice, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

exports.getOutstandingDues = async (req, res) => {
    try {
        const dues = await prisma.invoice.findMany({
            where: {
                status: {
                    not: 'paid'
                }
            },
            include: {
                tenant: true,
                unit: true
            },
            orderBy: {
                dueDate: 'asc'
            }
        });

        // Fetch latest rent reminders from CommunicationLog to find when they were last sent
        const reminderLogs = await prisma.communicationLog.findMany({
            where: {
                relatedEntity: 'Invoice',
                eventType: 'RENT_REMINDER'
            },
            orderBy: {
                timestamp: 'desc'
            }
        });

        const latestReminderMap = {};
        for (const log of reminderLogs) {
            if (log.entityId && !latestReminderMap[log.entityId]) {
                latestReminderMap[log.entityId] = log.timestamp;
            }
        }

        const formattedDues = dues
            .map(due => {
                const dueDate = due.dueDate ? new Date(due.dueDate) : new Date(due.createdAt);
                const now = new Date();
                const diffTime = now - dueDate;
                const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                const totalAmount = parseFloat(due.amount || 0);
                const paidAmt = parseFloat(due.paidAmount || 0);
                const balanceDue = totalAmount - paidAmt;

                // Determine status dynamically
                let displayStatus = 'Pending';
                if (due.status === 'partial') {
                    displayStatus = 'Partial';
                } else if (daysOverdue > 0) {
                    displayStatus = 'Overdue';
                }

                const lastSentDate = latestReminderMap[due.id];

                return {
                    id: due.id,
                    invoice: due.invoiceNo,
                    tenant: due.tenant?.name || (due.tenant?.firstName ? `${due.tenant.firstName} ${due.tenant.lastName || ''}`.trim() : 'Unknown Tenant'),
                    email: due.tenant?.email || null,
                    unit: due.unit?.name || 'Unknown Unit',
                    propertyId: due.unit?.propertyId, // Added for building filter
                    leaseType: due.unit?.rentalMode === 'FULL_UNIT' ? 'Full Unit' : (due.unit?.rentalMode === 'BEDROOM_WISE' ? 'Bedroom' : 'N/A'),
                    category: due.category === 'SECURITY_DEPOSIT' ? 'DEPOSIT' : (due.category || 'RENT'),
                    amount: Math.max(0, balanceDue), // Prevent negative display
                    totalAmount: totalAmount,
                    paidAmount: paidAmt,
                    dueDate: dueDate.toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric'
                    }),
                    daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
                    status: displayStatus,
                    balanceDue: balanceDue, // Keep raw for filter
                    lastReminderSent: lastSentDate ? lastSentDate.toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric'
                    }) : null
                };
            })
            .filter(d => d.balanceDue > 0); // Only show actual outstanding amounts

        res.json(formattedDues);
    } catch (error) {
        console.error('Error fetching outstanding dues:', error);
        res.status(500).json({ message: 'Error fetching outstanding dues' });
    }
};

exports.sendRentReminder = async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await prisma.invoice.findUnique({
            where: { id: parseInt(id) },
            include: {
                tenant: true,
                unit: true
            }
        });

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        const tenant = invoice.tenant;
        if (!tenant || !tenant.email) {
            return res.status(400).json({ message: 'Tenant does not have a configured email address.' });
        }

        const balanceDue = parseFloat(invoice.amount || 0) - parseFloat(invoice.paidAmount || 0);
        const formattedAmount = balanceDue.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formattedDueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) : 'N/A';

        const EmailService = require('../../services/email.service');
        const subject = `Rent Reminder: Outstanding Dues for Unit ${invoice.unit?.name || 'N/A'}`;
        
        const tenantName = tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim() || 'Tenant';
        const invoiceNo = invoice.invoiceNo || 'N/A';
        const unitName = invoice.unit?.name || 'N/A';

        const body = `<p>Dear ${tenantName},</p>
<p>This is a friendly reminder that you have an outstanding balance of <strong>$${formattedAmount}</strong> for unit <strong>${unitName}</strong> (Invoice <strong>${invoiceNo}</strong>).</p>
<p>This invoice was due on <strong>${formattedDueDate}</strong>.</p>
<p>Please submit your payment as soon as possible. If you have already made this payment, please disregard this email.</p>
<p>Thank you for your cooperation.</p>
<p>Best regards,<br/>Property Management</p>`;

        const sendResult = await EmailService.sendEmail(tenant.email, subject, body, {
            recipientId: tenant.id,
            eventType: 'RENT_REMINDER',
            isHtml: true,
            buildingId: invoice.unit?.propertyId,
            relatedEntity: 'Invoice',
            entityId: invoice.id
        });

        if (!sendResult.success) {
            return res.status(502).json({ message: `Failed to send email: ${sendResult.error || 'SendGrid API error'}` });
        }

        res.json({ message: 'Rent reminder email sent successfully.' });
    } catch (error) {
        console.error('Error sending rent reminder:', error);
        res.status(500).json({ message: 'Error sending rent reminder' });
    }
};

exports.getReceivedPayments = async (req, res) => {
    try {
        const payments = await prisma.payment.findMany({
            include: {
                invoice: {
                    include: {
                        tenant: true,
                        unit: true
                    }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });

        const formattedPayments = payments.map(p => {
            const inv = p.invoice;
            return {
                id: inv?.invoiceNo || `PAY-${p.id}`,
                paymentId: p.id,
                tenantId: inv?.tenantId,
                unitId: inv?.unitId,
                tenant: inv?.tenant?.name || (inv?.tenant?.firstName ? `${inv.tenant.firstName} ${inv.tenant.lastName || ''}`.trim() : 'Unknown Tenant'),
                unit: inv?.unit?.name || 'Unknown Unit',
                type: inv?.unit?.rentalMode === 'FULL_UNIT' ? 'Full Unit' : 'Bedroom',
                category: inv?.category === 'SECURITY_DEPOSIT' ? 'DEPOSIT' : (inv?.category || 'RENT'),
                amount: parseFloat(p.amount), // Correctly shows the ACTUAL payment amount
                method: p.method || 'N/A',
                date: p.date ? new Date(p.date).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric'
                }) : '-',
                status: 'Paid'
            };
        });

        res.json(formattedPayments);
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({ message: 'Error fetching payments' });
    }
};

// POST /api/admin/payments (Record Payment)
exports.recordPayment = async (req, res) => {
    try {
        const { invoiceId, amount, paymentMethod } = req.body;
        const payAmount = parseFloat(amount);

        if (!invoiceId || isNaN(payAmount) || payAmount <= 0) {
            return res.status(400).json({ message: 'Valid Invoice ID and Amount are required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get the invoice
            const invoice = await tx.invoice.findUnique({
                where: { id: parseInt(invoiceId) }
            });

            if (!invoice) {
                throw new Error('Invoice not found');
            }

            // 2. Create Payment Record
            const payment = await tx.payment.create({
                data: {
                    invoiceId: invoice.id,
                    amount: payAmount,
                    method: paymentMethod || 'Cash',
                    date: new Date()
                }
            });

            // 3. Update Invoice Status and Balances
            const currentPaid = parseFloat(invoice.paidAmount) || 0;
            const totalRequired = parseFloat(invoice.amount) || 0;

            const newPaidAmount = currentPaid + payAmount;
            const newBalanceDue = totalRequired - newPaidAmount;

            let status = 'partial';
            if (newBalanceDue <= 0) {
                status = 'paid';
            }

            const updatedInvoice = await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                    paidAmount: newPaidAmount,
                    balanceDue: Math.max(0, newBalanceDue),
                    status: status,
                    paidAt: status === 'paid' ? new Date() : invoice.paidAt,
                    paymentMethod: paymentMethod || invoice.paymentMethod
                }
            });

            // 4. Create Ledger Transaction
            let rentAccount = await tx.account.findFirst({
                where: { accountName: 'Rent Income' }
            });

            if (!rentAccount) {
                rentAccount = await tx.account.create({
                    data: {
                        accountName: 'Rent Income',
                        assetType: 'Income',
                        openingBalance: 0
                    }
                });
            }

            const lastTx = await tx.transaction.findFirst({
                orderBy: { id: 'desc' }
            });
            const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

            const transaction = await tx.transaction.create({
                data: {
                    date: new Date(),
                    description: `Payment - ${invoice.month} (Inv: ${invoice.invoiceNo})`,
                    type: 'Income',
                    amount: payAmount,
                    balance: prevBalance + payAmount,
                    status: 'Completed',
                    invoiceId: invoice.id,
                    paymentId: payment.id,
                    accountId: rentAccount.id
                }
            });

            return { payment, updatedInvoice, transaction };
        });

        res.json({
            success: true,
            message: 'Payment recorded successfully',
            paymentId: result.payment.id,
            invoiceId: result.updatedInvoice.id,
            status: result.updatedInvoice.status,
            balanceDue: result.updatedInvoice.balanceDue
        });

    } catch (e) {
        console.error('Payment Error:', e);
        res.status(500).json({ message: e.message || 'Payment recording failed' });
    }
};
