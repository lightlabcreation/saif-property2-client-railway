const prisma = require('../../config/prisma');
const { generateInvoicePDF } = require('../../utils/pdf.utils');

// GET /api/tenant/invoices
exports.getInvoices = async (req, res) => {
    try {
        const userId = req.user.id;

        // Find invoices where tenantId matches
        const invoices = await prisma.invoice.findMany({
            where: {
                tenantId: userId,
                status: {
                    not: 'draft' // Show everything that isn't a draft
                }
            },
            orderBy: { createdAt: 'desc' },
            include: { 
                unit: { include: { property: true } },
                tenant: true
            }
        });

        const formatted = invoices.map(inv => {
            let statusDisplay = 'Due';
            const s = inv.status.toLowerCase();

            if (s === 'paid') statusDisplay = 'Paid';
            else if (s === 'overdue') statusDisplay = 'Overdue';
            else if (s === 'sent') statusDisplay = 'Due';
            else if (s === 'unpaid') statusDisplay = 'Due';
            else if (s === 'partial') statusDisplay = 'Partial';
            else statusDisplay = s.charAt(0).toUpperCase() + s.slice(1);

            return {
                id: inv.invoiceNo,
                dbId: inv.id,
                month: inv.month,
                amount: parseFloat(inv.amount),
                balanceDue: parseFloat(inv.balanceDue || inv.amount),
                rent: parseFloat(inv.rent),
                serviceFees: parseFloat(inv.serviceFees),
                status: statusDisplay,
                date: inv.createdAt.toISOString().split('T')[0],
                unit: inv.unit ? (inv.unit.unitNumber || inv.unit.name) : 'N/A',
                building: inv.unit?.property?.name || 'N/A',
                tenantName: inv.tenant?.name || inv.tenant?.firstName + ' ' + inv.tenant?.lastName
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/tenant/invoices/:id/download
exports.downloadInvoicePDF = async (req, res) => {
    try {
        const userId = req.user.id;
        const id = parseInt(req.params.id);

        const invoice = await prisma.invoice.findFirst({
            where: { id, tenantId: userId },
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
            if (s.key === 'companyName') settings['company_name'] = s.value;
            else if (s.key === 'companyAddress') settings['company_address'] = s.value;
            else if (s.key === 'companyPhone') settings['company_phone'] = s.value;
            else settings[s.key] = s.value;
        });

        generateInvoicePDF(invoice, res, settings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};
