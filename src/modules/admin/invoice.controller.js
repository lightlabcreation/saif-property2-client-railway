const prisma = require('../../config/prisma');
const { generateInvoicePDF } = require('../../utils/pdf.utils');

// GET /api/admin/invoices/:id/download
exports.downloadInvoicePDF = async (req, res) => {
    try {
        const invoice = await prisma.invoice.findUnique({
            where: { id: parseInt(req.params.id) },
            include: {
                tenant: true,
                unit: {
                    include: { property: true }
                },
                lease: {
                    include: { bedroom: true }
                }
            }
        });

        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        // Fetch Branding Settings
        const settingsList = await prisma.systemSetting.findMany();
        const settings = {};
        settingsList.forEach(s => {
            // Map internal keys to PDF-expected keys
            if (s.key === 'companyName') settings['company_name'] = s.value;
            else if (s.key === 'companyAddress') settings['company_address'] = s.value;
            else if (s.key === 'companyPhone') settings['company_phone'] = s.value;
            else settings[s.key] = s.value;
        });

        // Fallback to Admin Profile if settings are empty
        if (!settings['company_name'] || !settings['company_address'] || !settings['company_phone']) {
            const adminUser = await prisma.user.findFirst({
                where: { role: 'ADMIN' },
                orderBy: { id: 'asc' }
            });

            if (adminUser) {
                if (!settings['company_name']) settings['company_name'] = adminUser.companyName || adminUser.name || 'Masteko';
                if (!settings['company_address']) settings['company_address'] = adminUser.companyDetails || '';
                if (!settings['company_phone']) settings['company_phone'] = adminUser.phone || '';
            }
        }

        generateInvoicePDF(invoice, res, settings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

// GET /api/admin/invoices
exports.getInvoices = async (req, res) => {
    try {
        const invoices = await prisma.invoice.findMany({
            include: {
                items: true,
                tenant: {
                    include: { leases: true }
                },
                unit: {
                    include: { property: true }
                },
                lease: true // Include lease to check rentAmount
            },
            orderBy: { createdAt: 'desc' }
        });

        // SAFETY NET: Auto-correct unpaid $0 invoices before returning
        const formatted = await Promise.all(invoices.map(async (inv) => {
            let currentAmount = parseFloat(inv.amount);
            let currentRent = parseFloat(inv.rent);
            let currentStatus = inv.status.toLowerCase();

            if (currentStatus !== 'paid' && currentAmount === 0 && inv.lease && parseFloat(inv.lease.monthlyRent) > 0) {
                const rentAmt = parseFloat(inv.lease.monthlyRent);
                // Update in DB for persistence
                await prisma.invoice.update({
                    where: { id: inv.id },
                    data: {
                        rent: rentAmt,
                        amount: rentAmt,
                        balanceDue: rentAmt
                    }
                });
                currentAmount = rentAmt;
                currentRent = rentAmt;
            }

            // Find active lease to get dates for UI
            const activeLease = inv.tenant.leases.find(l => l.status === 'Active' || l.status === 'DRAFT');

            const displayCategory = inv.category === 'SECURITY_DEPOSIT' ? 'DEPOSIT' : inv.category;

            return {
                id: inv.id,
                invoiceNo: inv.invoiceNo,
                tenantId: inv.tenantId,
                unitId: inv.unitId,
                propertyId: inv.unit?.propertyId || inv.unit?.property?.id || null,
                tenant: inv.tenant?.name || (inv.tenant?.firstName ? `${inv.tenant.firstName} ${inv.tenant.lastName || ''}`.trim() : 'Unknown Tenant'),
                unit: inv.unit.name,
                month: inv.month,
                rent: currentRent,
                serviceFees: parseFloat(inv.serviceFees),
                amount: currentAmount,
                paidAmount: parseFloat(inv.paidAmount || 0),
                balanceDue: parseFloat(inv.balanceDue || 0),
                status: inv.status,

                category: displayCategory,
                description: inv.description,
                items: inv.items || [],
                leaseStartDate: activeLease?.startDate || null,
                leaseEndDate: activeLease?.endDate || null
            };
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/invoices (Create draft)
exports.createInvoice = async (req, res) => {
    try {
        let { tenantId, unitId, month, rent, serviceFees, items } = req.body;

        if (!tenantId || !unitId) {
            return res.status(400).json({ message: 'Tenant ID and Unit ID are required' });
        }

        // 1. Find the lease for this tenant and unit (can be Active or even a past lease for billing)
        const lease = await prisma.lease.findFirst({
            where: {
                tenantId: parseInt(tenantId),
                unitId: parseInt(unitId)
            },
            orderBy: { endDate: 'desc' }, // Latest lease first
            include: { unit: true, tenant: true }
        });

        if (!lease) {
            return res.status(400).json({ message: 'No lease found for this tenant and unit.' });
        }

        // Determine who to bill: If tenant is a RESIDENT, bill their Parent
        let billableTenantId = parseInt(tenantId);
        if (lease.tenant.type === 'RESIDENT') {
            if (!lease.tenant.parentId) {
                return res.status(400).json({ message: 'Resident has no billable parent assigned.' });
            }
            billableTenantId = lease.tenant.parentId;
        }

        // Note: RESIDENT is not a tenant type - only INDIVIDUAL and COMPANY are valid tenant types
        // Residents are separate entities linked to tenant leases, not direct lease holders

        const rentAmt = parseFloat(rent) || 0;
        let feesAmt = parseFloat(serviceFees) || 0;

        if (Array.isArray(items) && items.length > 0) {
            feesAmt = items.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
        }

        if (rentAmt > 0 && feesAmt > 0) {
            return res.status(400).json({ message: 'Rent and Service Fees must be on separate invoices.' });
        }

        // If creating a rent invoice, ensure it matches the lease
        let finalRent = rentAmt;
        if (rentAmt > 0) {
            finalRent = parseFloat(lease.monthlyRent) || 0;
        }

        const totalAmount = finalRent + feesAmt;

        // Generate Invoice Number
        const count = await prisma.invoice.count();
        const prefix = req.body.category === 'SECURITY_DEPOSIT' ? 'INV-DEP' : 'INV-MAN';
        const invoiceNo = `${prefix}-${String(count + 1).padStart(5, '0')}`;

        const newInvoice = await prisma.invoice.create({
            data: {
                invoiceNo,
                tenantId: billableTenantId,
                unitId: parseInt(unitId),
                leaseId: lease.id,
                leaseType: lease.unit.rentalMode,
                month,
                rent: finalRent,
                serviceFees: feesAmt,
                amount: totalAmount,
                paidAmount: 0,
                balanceDue: totalAmount,
                status: req.body.status || 'draft',
                category: req.body.category || 'RENT',
                description: req.body.description || null,
                dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                items: Array.isArray(items) && items.length > 0 ? {
                    create: items.map(item => ({
                        description: item.description,
                        amount: parseFloat(item.amount || 0)
                    }))
                } : undefined
            },
            include: {
                tenant: true,
                unit: true
            }
        });

        res.status(201).json(newInvoice);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating invoice' });
    }
};

// PUT /api/admin/invoices/:id (Update status or details)
exports.updateInvoice = async (req, res) => {
    try {
        const { status, month, rent, serviceFees, paymentMethod } = req.body;
        const id = parseInt(req.params.id);

        const existing = await prisma.invoice.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: 'Invoice not found' });

        const data = {};
        if (month) data.month = month;
        if (req.body.description !== undefined) data.description = req.body.description;
        if (req.body.category) data.category = req.body.category;

        let newRent = rent !== undefined ? parseFloat(rent) : Number(existing.rent);
        let newFees = serviceFees !== undefined ? parseFloat(serviceFees) : Number(existing.serviceFees);

        if (status) {
            data.status = status;
            if (status.toLowerCase() === 'paid') {
                data.paidAt = new Date();
                data.paidAmount = existing.amount;
                data.balanceDue = 0;
                if (paymentMethod) data.paymentMethod = paymentMethod;

                // CRITICAL (Requirement 2): If manual status change to Paid, we should ideally create a transaction
                // but usually this is done via the Payment process. If it's done manually here, 
                // we should still record it in the ledger for consistency.
                await prisma.transaction.create({
                    data: {
                        date: new Date(),
                        description: `Manual Invoice Paid - ${existing.invoiceNo}`,
                        type: 'Income',
                        amount: existing.amount,
                        status: 'Completed',
                        invoiceId: id
                    }
                });
            }
        }

        if (rent !== undefined || serviceFees !== undefined) {
            const upRent = rent !== undefined ? parseFloat(rent) : Number(existing.rent);
            const upFees = serviceFees !== undefined ? parseFloat(serviceFees) : Number(existing.serviceFees);

            if (upRent > 0 && upFees > 0) {
                return res.status(400).json({ message: 'Rent and Service Fees must be on separate invoices.' });
            }

            data.rent = upRent;
            data.serviceFees = upFees;
            data.amount = upRent + upFees;
            // Recalc balance based on what was already paid
            data.balanceDue = (upRent + upFees) - Number(existing.paidAmount);
        }

        const updated = await prisma.invoice.update({
            where: { id },
            data
        });
        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating invoice' });
    }
};

// POST /api/admin/invoices/batch (Trigger manual batch run)
exports.runBatchInvoicing = async (req, res) => {
    console.log('[Batch Rent Run] Starting execution...');
    const today = new Date();
    const currentMonth = today.toLocaleString('default', { month: 'long', year: 'numeric' });

    // 1. Initialize RentRun Record
    const rentRun = await prisma.rentRun.create({
        data: {
            status: 'Pending'
        }
    });

    let createdCount = 0;
    let skippedCount = 0;
    let totalAmount = 0;

    try {
        const activeLeases = await prisma.lease.findMany({
            where: {
                status: 'Active',
                startDate: { lte: today },
                endDate: { gte: today },
                // Only include leases for actual tenants (INDIVIDUAL or COMPANY)
                // Residents are separate entities and cannot have direct leases
                tenant: {
                    type: { in: ['INDIVIDUAL', 'COMPANY', 'RESIDENT'] }
                }
            },
            include: { unit: true, tenant: true }
        });

        for (const lease of activeLeases) {
            try {
                // 2. Idempotency Check
                const existing = await prisma.invoice.findFirst({
                    where: { leaseId: lease.id, month: currentMonth, rent: { gt: 0 } }
                });

                if (existing) {
                    await prisma.rentRunLog.create({
                        data: {
                            rentRunId: rentRun.id,
                            message: `[Skipped] Lease ID ${lease.id}: Rent invoice already exists for ${currentMonth}.`
                        }
                    });
                    skippedCount++;
                    continue;
                }

                const rentAmount = parseFloat(lease.monthlyRent) || 0;

                if (rentAmount <= 0) {
                    await prisma.rentRunLog.create({
                        data: {
                            rentRunId: rentRun.id,
                            message: `[Skipped] Lease ID ${lease.id}: Monthly rent is 0 or invalid.`
                        }
                    });
                    skippedCount++;
                    continue;
                }

                // 3. Generate Invoice
                const count = await prisma.invoice.count();
                const invoiceNo = `INV-BATCH-${String(count + 1).padStart(5, '0')}`;
                const dueDate = new Date(today.getFullYear(), today.getMonth(), 10); // 10th of month

                // Determine who to bill: If tenant is a RESIDENT, bill their Parent
                const billableTenantId = lease.tenant.type === 'RESIDENT' ? lease.tenant.parentId : lease.tenantId;

                if (!billableTenantId) {
                    await prisma.rentRunLog.create({
                        data: {
                            rentRunId: rentRun.id,
                            message: `[Skipped] Lease ID ${lease.id}: No billable tenant (parent) found for this resident.`
                        }
                    });
                    skippedCount++;
                    continue;
                }

                await prisma.invoice.create({
                    data: {
                        invoiceNo,
                        tenantId: billableTenantId,
                        unitId: lease.unitId,
                        leaseId: lease.id,
                        leaseType: lease.unit.rentalMode,
                        month: currentMonth,
                        rent: rentAmount,
                        serviceFees: 0,
                        amount: rentAmount,
                        paidAmount: 0,
                        balanceDue: rentAmount,
                        status: 'sent',
                        dueDate: dueDate
                    }
                });

                await prisma.rentRunLog.create({
                    data: {
                        rentRunId: rentRun.id,
                        message: `[Success] Lease ID ${lease.id}: Invoice ${invoiceNo} generated.`
                    }
                });

                createdCount++;
                totalAmount += rentAmount;

            } catch (innerError) {
                console.error(`[Batch Run] Error processing Lease ID ${lease.id}:`, innerError);
                await prisma.rentRunLog.create({
                    data: {
                        rentRunId: rentRun.id,
                        message: `[Error] Lease ID ${lease.id}: ${innerError.message || 'Unknown processing error.'}`
                    }
                });
                skippedCount++;
            }
        }

        // 4. Update RentRun with results
        await prisma.rentRun.update({
            where: { id: rentRun.id },
            data: {
                status: 'Completed',
                successCount: createdCount,
                skippedCount,
                totalAmount
            }
        });

        res.json({ message: 'Batch run complete', createdCount, skippedCount, runId: rentRun.id });
    } catch (e) {
        console.error('[Batch Run] Critical Error:', e);
        await prisma.rentRun.update({
            where: { id: rentRun.id },
            data: { status: 'Failed' }
        });
        res.status(500).json({ message: 'Error in batch generation' });
    }
};

// DELETE /api/admin/invoices/:id
exports.deleteInvoice = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        await prisma.$transaction(async (tx) => {
            // 1. Delete associated Transactions
            await tx.transaction.deleteMany({
                where: { invoiceId: id }
            });

            // 2. Delete associated Payments (and their transactions if any)
            const payments = await tx.payment.findMany({ where: { invoiceId: id } });
            for (const payment of payments) {
                await tx.transaction.deleteMany({ where: { paymentId: payment.id } });
            }
            await tx.payment.deleteMany({
                where: { invoiceId: id }
            });

            // 3. Nullify Document associations (don't delete files, just remove the link)
            await tx.document.updateMany({
                where: { invoiceId: id },
                data: { invoiceId: null }
            });

            // 4. Finally delete the Invoice
            await tx.invoice.delete({
                where: { id }
            });
        });

        res.json({ message: 'Deleted successfully' });
    } catch (e) {
        console.error('Delete Invoice Error:', e);
        res.status(500).json({ message: 'Error deleting invoice: ' + (e.message || 'Internal Server Error') });
    }
};

