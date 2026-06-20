const prisma = require('../../config/prisma');
const { generateInvoicePDF } = require('../../utils/pdf.utils');

// GET /api/owner/dashboard/stats
exports.getOwnerDashboardStats = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const companyId = user.companyId;

        const properties = await prisma.property.findMany({
            where: {
                owners: { some: { id: ownerId } }
            },
            select: { id: true }
        });
        const propertyIds = properties.map(p => p.id);
        const propertyCount = properties.length;
        const unitCount = await prisma.unit.count({ where: { propertyId: { in: propertyIds } } });

        let occupiedUnitsCount = 0;
        let vacantUnitsCount = 0;
        let occupiedBedroomsCount = 0;
        let vacantBedroomsCount = 0;

        const vacantUnitsList = [];
        const vacantBedroomsList = [];

        const units = await prisma.unit.findMany({
            where: { propertyId: { in: propertyIds } },
            include: {
                bedroomsList: true,
                property: true,
                leases: { where: { status: 'Active' } }
            }
        });

        units.forEach(u => {
            if (u.rentalMode === 'BEDROOM_WISE') {
                // If it's bedroom-wise, we should count occupied rooms
                // A room is occupied if its status is Occupied OR if there is an active lease for it
                const occupiedRoomIds = new Set(u.leases.filter(l => l.bedroomId).map(l => l.bedroomId));

                const rooms = u.bedroomsList.map(b => ({
                    ...b,
                    isOccupied: b.status === 'Occupied' || occupiedRoomIds.has(b.id)
                }));

                const occBeds = rooms.filter(r => r.isOccupied).length;
                const vacBeds = rooms.filter(r => !r.isOccupied);

                occupiedBedroomsCount += occBeds;
                vacantBedroomsCount += vacBeds.length;

                vacBeds.forEach(v => {
                    vacantBedroomsList.push(`${u.property.name} - Unit ${u.unitNumber} (Rm ${v.bedroomNumber})`);
                });

                if (occBeds > 0) occupiedUnitsCount++;
                else {
                    vacantUnitsCount++;
                    vacantUnitsList.push(`${u.property.name} - Unit ${u.unitNumber}`);
                }
            } else {
                // For FULL_UNIT mode
                const hasActiveLease = u.leases && u.leases.length > 0;
                if (hasActiveLease || u.status === 'Occupied' || u.status === 'Fully Booked') {
                    occupiedUnitsCount++;
                } else {
                    vacantUnitsCount++;
                    vacantUnitsList.push(`${u.property.name} - Unit ${u.unitNumber}`);
                }
            }
        });

        // Sum All Unpaid Invoices (Rent + Deposits + Fees) - excluding drafts
        const duesAgg = await prisma.invoice.aggregate({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: { notIn: ['draft', 'cancelled', 'paid'] }
            },
            _sum: { balanceDue: true }
        });

        // Sum Paid Rent Invoices only for Revenue tracking
        const rentAgg = await prisma.invoice.aggregate({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: 'paid',
                category: 'RENT'
            },
            _sum: { paidAmount: true }
        });

        // Sum Security Deposits (Category SERVICE) - treated as liability
        const depositAgg = await prisma.invoice.aggregate({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: 'paid',
                category: 'SERVICE'
            },
            _sum: { paidAmount: true }
        });

        const monthlyRevenue = Number(rentAgg._sum.paidAmount || 0);
        const outstandingDues = Number(duesAgg._sum.balanceDue || 0);
        const totalDepositsHeld = Number(depositAgg._sum.paidAmount || 0);

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        const insuranceExpiryCount = await prisma.insurance.count({
            where: {
                OR: [
                    { userId: ownerId },
                    { unit: { propertyId: { in: propertyIds } } }
                ],
                endDate: { gte: new Date(), lte: thirtyDaysFromNow }
            }
        });

        const recentInvoices = await prisma.invoice.findMany({
            where: { unit: { propertyId: { in: propertyIds } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { unit: true }
        });
        const recentActivity = recentInvoices.map(inv =>
            `Invoice ${inv.invoiceNo} for ${inv.month} (${inv.status})`
        );

        // 9. Active Tenants (via Leases)
        const activeLeases = await prisma.lease.findMany({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: 'Active'
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
                tenant: { select: { firstName: true, lastName: true, email: true, name: true, companyName: true } },
                unit: { select: { unitNumber: true, property: { select: { name: true } } } }
            }
        });
        const tenants = activeLeases.map(l => {
            const fullName = `${l.tenant.firstName || ''} ${l.tenant.lastName || ''}`.trim();
            const nameToDisplay = fullName || l.tenant.name || l.tenant.companyName || 'N/A';
            return {
                id: l.tenantId,
                name: nameToDisplay,
                email: l.tenant.email || 'N/A',
                property: l.unit.property.name,
                unit: l.unit.unitNumber
            };
        });

        const growthIdx = propertyCount > 0 ? (12.4 + (occupiedUnitsCount / (unitCount || 1)) * 2).toFixed(1) : "0.0";

        res.json({
            propertyCount,
            unitCount,
            occupancy: {
                occupiedUnits: occupiedUnitsCount,
                vacantUnits: vacantUnitsCount,
                occupiedBedrooms: occupiedBedroomsCount,
                vacantBedrooms: vacantBedroomsCount,
                vacantUnitsList,
                vacantBedroomsList
            },
            monthlyRevenue,
            outstandingDues,
            totalDepositsHeld,
            insuranceExpiryCount,
            recentActivity: recentActivity.length > 0 ? recentActivity : ["Welcome to your dashboard", "Add properties to see activity"],
            portfolioGrowth: `+0.0%`,
            tenants
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/properties
exports.getOwnerProperties = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        const properties = await prisma.property.findMany({
            where: {
                owners: { some: { id: ownerId } }
            },
            include: {
                units: { include: { bedroomsList: true, leases: { where: { status: 'Active' } } } },
                owners: true
            }
        });

        const formatted = await Promise.all(properties.map(async p => {
            const totalUnits = p.units.length;

            let occupiedUnitsCount = 0;
            let vacantUnitsCount = 0;
            let occupiedBedroomsCount = 0;
            let vacantBedroomsCount = 0;

            p.units.forEach(u => {
                if (u.rentalMode === 'BEDROOM_WISE') {
                    const occupiedRoomIds = new Set(u.leases.filter(l => l.bedroomId).map(l => l.bedroomId));
                    const occBeds = u.bedroomsList.filter(b => b.status === 'Occupied' || occupiedRoomIds.has(b.id)).length;
                    const vacBeds = u.bedroomsList.length - occBeds;

                    occupiedBedroomsCount += occBeds;
                    vacantBedroomsCount += Math.max(0, vacBeds);
                    if (occBeds > 0) occupiedUnitsCount++;
                    else vacantUnitsCount++;
                } else {
                    const hasActiveLease = u.leases && u.leases.length > 0;
                    if (hasActiveLease || u.status === 'Occupied' || u.status === 'Fully Booked') {
                        occupiedUnitsCount++;
                    } else {
                        vacantUnitsCount++;
                    }
                }
            });

            const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnitsCount / totalUnits) * 100) : 0;

            // Calculate actual revenue for this property based on invoices
            const invoiceAgg = await prisma.invoice.aggregate({
                where: {
                    unit: { propertyId: p.id },
                    status: { notIn: ['draft', 'cancelled'] },
                    category: 'RENT' // Exclude deposits from revenue
                },
                _sum: { paidAmount: true }
            });
            const monthlyRevenue = Number(invoiceAgg._sum.paidAmount || 0);

            // Fetch active leases to determine next payment date (simplified: use 1st of next month)
            // or fetch next due invoice
            const nextInvoice = await prisma.invoice.findFirst({
                where: { unit: { propertyId: p.id }, status: { not: 'paid' }, dueDate: { gte: new Date() } },
                orderBy: { dueDate: 'asc' }
            });

            const nextPaymentDate = nextInvoice
                ? nextInvoice.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            // Unit Type Breakdown
            const commercialCount = p.units.filter(u => ['Commercial', 'Retail', 'Office'].includes(u.unitType)).length;
            const residentialCount = totalUnits - commercialCount;

            // Residents Count (Active Leases for this property)
            const activeLeases = await prisma.lease.findMany({
                where: {
                    unit: { propertyId: p.id },
                    status: 'Active'
                },
                include: { residents: true }
            });

            // Count primary tenants (1 per lease) + additional residents
            const residentCount = activeLeases.reduce((acc, lease) => {
                return acc + 1 + (lease.residents ? lease.residents.length : 0);
            }, 0);

            // Calculate ownership percentage (assuming equal split)
            const ownerCount = p.owners ? p.owners.length : 1;
            const ownershipPercentage = ownerCount > 0 ? Math.round(100 / ownerCount) : 100;

            return {
                id: p.id,
                name: p.name,
                address: p.address,
                units: totalUnits,
                occupancy: `${occupancyRate}%`,
                status: p.status,
                revenue: monthlyRevenue,
                // New Dynamic Fields
                projectedAnnual: monthlyRevenue * 12,
                nextPaymentDate: nextPaymentDate,
                residentialCount,
                commercialCount,
                residentCount, // Pass to frontend
                ownershipPercentage,
                occupiedUnits: occupiedUnitsCount,
                vacantUnits: vacantUnitsCount,
                occupiedBedrooms: occupiedBedroomsCount,
                vacantBedrooms: vacantBedroomsCount
            };
        }));

        res.json(formatted);
    } catch (error) {
        console.error('PROPERTIES ERROR:', error);
        require('fs').writeFileSync('debug-properties.txt', String(error.stack || error));
        res.status(500).json({ message: 'Error' });
    }
};

// GET /api/owner/financials
exports.getOwnerFinancials = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });

        // Find properties for this owner strictly
        const properties = await prisma.property.findMany({
            where: {
                owners: { some: { id: ownerId } }
            }
        });
        const propertyIds = properties.map(p => p.id);

        // Find ALL invoices (Revenue & Dues)
        const invoices = await prisma.invoice.findMany({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: { notIn: ['draft', 'cancelled'] } // Sync with Dashboard logic
            },
            include: { unit: { include: { property: true } } },
            orderBy: { createdAt: 'desc' }
            // take: 100 // Removed to ensure full portfolio consistency
        });

        const rentCollected = invoices.reduce((sum, inv) => {
            return inv.category === 'RENT' ? sum + parseFloat(inv.paidAmount || 0) : sum;
        }, 0);

        const securityDepositsHeld = invoices.reduce((sum, inv) => {
            return inv.category === 'SERVICE' ? sum + parseFloat(inv.paidAmount || 0) : sum;
        }, 0);

        const outstandingDues = invoices.reduce((sum, inv) => {
            return sum + parseFloat(inv.balanceDue || 0);
        }, 0);

        const serviceFees = invoices.reduce((sum, inv) => sum + parseFloat(inv.serviceFees || 0), 0);

        // Net Earnings = Collected - Service Fees (simplified logic)
        // Or if service fees are deducted from collected, clarify. Usually Net = Collected - Expenses.
        // For now, assuming Service Fees are part of what was collected or separate. 
        // Let's assume Net Earnings = Rent Collected (Pure Rent) - Service Fees? 
        // Or just Total Collected. The UI calls it "Net Earnings". I'll use Collected - Service Fees.
        const netEarnings = rentCollected - serviceFees;

        const transactions = invoices.map(inv => ({
            id: inv.id,
            property: inv.unit?.property?.name || 'Unknown',
            date: inv.createdAt.toLocaleDateString(),
            type: inv.category === 'SERVICE' ? 'Deposit' : 'Rent Invoice',
            amount: parseFloat(inv.amount),
            paidAmount: parseFloat(inv.paidAmount),
            balance: parseFloat(inv.balanceDue),
            status: inv.status.charAt(0).toUpperCase() + inv.status.slice(1)
        }));


        res.json({
            collected: rentCollected,
            outstandingDues,
            securityDepositsHeld,
            serviceFees,
            netEarnings: rentCollected - serviceFees,
            transactions
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};


// GET /api/owner/dashboard/financial-pulse
exports.getOwnerFinancialPulse = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });

        // Get properties strictly for this owner
        const properties = await prisma.property.findMany({
            where: {
                owners: { some: { id: ownerId } }
            }
        });
        const propertyIds = properties.map(p => p.id);

        const financialPulse = [];
        const today = new Date();

        for (let i = 0; i < 6; i++) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthStr = date.toLocaleString('default', { month: 'short', year: 'numeric' });

            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

            const monthlyInvoices = await prisma.invoice.findMany({
                where: {
                    unit: { propertyId: { in: propertyIds } },
                    status: { notIn: ['draft', 'cancelled'] },
                    category: 'RENT', // Only track pure rent for growth pulse
                    createdAt: {
                        gte: monthStart,
                        lte: monthEnd
                    }
                }
            });

            let expected = 0;
            let collected = 0;
            let dues = 0;

            monthlyInvoices.forEach(inv => {
                const totalAmount = parseFloat(inv.amount);
                const paidAmt = parseFloat(inv.paidAmount);
                const balDue = parseFloat(inv.balanceDue);

                expected += totalAmount;
                collected += paidAmt;
                dues += balDue;
            });


            financialPulse.push({
                month: monthStr,
                expected,
                collected,
                dues
            });
        }

        res.json(financialPulse);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/reports – dynamic reports list and stats for owner's portfolio
exports.getOwnerReports = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        const propertyIds = (await prisma.property.findMany({
            where: {
                owners: { some: { id: ownerId } }
            },
            select: { id: true }
        })).map(p => p.id);

        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });



        const reports = [
            { id: 'monthly_summary', title: 'Monthly Performance Summary', description: 'Comprehensive view of revenue, occupancy, and expenses for the current month.', type: 'monthly_summary', lastGenerated: today },
            { id: 'annual_overview', title: 'Annual Financial Overview', description: 'Year-on-year growth, cumulative earnings, and portfolio valuation trends.', type: 'annual_overview', lastGenerated: today },
            { id: 'occupancy_stats', title: 'Occupancy & Vacancy Analysis', description: 'Unit-by-unit occupancy status and historical vacancy rates across all sites.', type: 'occupancy_stats', lastGenerated: today },
        ];

        res.json({
            reports,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/reports/:type/download
exports.downloadReport = async (req, res) => {
    try {
        const type = req.params.type;
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });

        // Filters
        const queryMonth = req.query.month ? parseInt(req.query.month) : new Date().getMonth() + 1;
        const queryYear = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

        // Build Report PDF
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 50 });
        const filename = `${type}_${queryYear}_${queryMonth}.pdf`;
        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');

        doc.pipe(res);

        const name = (user.firstName && user.lastName)
            ? `${user.firstName} ${user.lastName}`
            : (user.name || 'Owner');

        // --- Styles & Helpers ---
        const drawHeader = (title, period) => {
            // Main Title
            doc.fontSize(24).font('Helvetica-Bold').text(title.toUpperCase(), { align: 'left' });
            doc.moveDown(0.5);

            // Period Badge / Text
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#4f46e5').text(period.toUpperCase(), { align: 'left' });
            doc.moveDown(0.5);

            // Metadata
            doc.fontSize(10).font('Helvetica').fillColor('#666666');
            doc.text(`GENERATED FOR: ${name.toUpperCase()}`, { align: 'left' });
            doc.text(`GENERATED ON: ${new Date().toLocaleDateString()}`, { align: 'left' });

            doc.moveDown(1.5);
            doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(2);
            doc.fillColor('#000000');
        };

        const drawTable = (headers, rows, startY) => {
            let currentY = startY;
            const colWidth = 500 / headers.length;

            // Header Row
            doc.font('Helvetica-Bold').fontSize(10);
            headers.forEach((h, i) => {
                doc.text(h, 50 + (i * colWidth), currentY, { width: colWidth, align: i === 0 ? 'left' : 'right' });
            });
            currentY += 15;
            doc.strokeColor('#000000').lineWidth(1).moveTo(50, currentY).lineTo(550, currentY).stroke();
            currentY += 10;

            // Data Rows
            doc.font('Helvetica').fontSize(10);
            rows.forEach((row, rowIndex) => {
                if (currentY > 700) { // New Page
                    doc.addPage();
                    currentY = 50;
                }
                row.forEach((cell, i) => {
                    doc.text(cell, 50 + (i * colWidth), currentY, { width: colWidth, align: i === 0 ? 'left' : 'right' });
                });
                currentY += 20;
                doc.strokeColor('#eeeeee').lineWidth(0.5).moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
            });
        };

        // --- Report Generation ---

        const monthName = new Date(queryYear, queryMonth - 1).toLocaleString('default', { month: 'long' });

        if (type === 'monthly_summary') {
            drawHeader('Monthly Performance Summary', `REPORTING PERIOD: ${monthName} ${queryYear}`);

            const properties = await prisma.property.findMany({
                where: { owners: { some: { id: ownerId } } },
                include: { units: true }
            });
            const propIds = properties.map(p => p.id);

            const startDate = new Date(queryYear, queryMonth - 1, 1);
            const endDate = new Date(queryYear, queryMonth, 0);

            const invoices = await prisma.invoice.findMany({
                where: {
                    unit: { propertyId: { in: propIds } },
                    createdAt: { gte: startDate, lte: endDate }
                }
            });

            const revenue = invoices.reduce((sum, i) => sum + parseFloat(i.paidAmount || 0), 0);
            const totalInvoiced = invoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
            const outstanding = invoices.reduce((sum, i) => sum + parseFloat(i.balanceDue || 0), 0);

            // Summary Box (Fixed Positioning)
            const boxTop = doc.y;
            doc.rect(50, boxTop, 500, 80).fill('#f9fafb').stroke('#e5e7eb');
            doc.fillColor('#000000');

            const textY = boxTop + 15; // Padding from top of box

            doc.font('Helvetica-Bold').fontSize(12).text('Financial Snapshot', 70, textY);

            // Columns inside box
            const valY = textY + 25;

            doc.font('Helvetica').fontSize(10).text('Total Revenue', 70, valY);
            doc.font('Helvetica-Bold').fontSize(14).text(`$${revenue.toLocaleString()}`, 70, valY + 15);

            doc.font('Helvetica').fontSize(10).text('Total Invoiced', 250, valY);
            doc.font('Helvetica-Bold').fontSize(14).text(`$${totalInvoiced.toLocaleString()}`, 250, valY + 15);

            doc.font('Helvetica').fontSize(10).text('Outstanding', 430, valY);
            doc.font('Helvetica-Bold').fontSize(14).fillColor('#ef4444').text(`$${outstanding.toLocaleString()}`, 430, valY + 15);
            doc.fillColor('#000000');

            // Move cursor past the box
            doc.y = boxTop + 100;

            doc.fontSize(14).font('Helvetica-Bold').text('Property Breakdown', 50, doc.y);
            doc.moveDown(1);

            const tableRows = properties.map(prop => {
                const propInvoices = invoices.filter(inv => prop.units.some(u => u.id === inv.unitId));
                const propRevenue = propInvoices.reduce((sum, i) => sum + parseFloat(i.paidAmount || 0), 0);
                return [prop.name, `$${propRevenue.toLocaleString()}`];
            });

            drawTable(['Property Name', 'Revenue Collected'], tableRows, doc.y);


        } else if (type === 'annual_overview') {
            const properties = await prisma.property.findMany({
                where: { owners: { some: { id: ownerId } } },
                include: { units: true }
            });
            const propIds = properties.map(p => p.id);

            drawHeader('Annual Financial Overview', `REPORTING YEAR: ${queryYear}`);

            let totalYearRevenue = 0;
            const monthlyData = [];

            for (let m = 0; m < 12; m++) {
                const start = new Date(queryYear, m, 1);
                const end = new Date(queryYear, m + 1, 0);
                const monthlyInv = await prisma.invoice.aggregate({
                    where: {
                        unit: { propertyId: { in: propIds } },
                        createdAt: { gte: start, lte: end }
                    },
                    _sum: { paidAmount: true }
                });
                const amount = Number(monthlyInv._sum.paidAmount || 0);
                totalYearRevenue += amount;
                monthlyData.push({ month: new Date(queryYear, m).toLocaleString('default', { month: 'long' }), amount });
            }

            // Summary
            doc.fontSize(12).font('Helvetica').text('Total Annual Revenue', 50, doc.y);
            doc.fontSize(24).font('Helvetica-Bold').text(`$${totalYearRevenue.toLocaleString()}`, 50, doc.y + 10);
            doc.moveDown(2);

            // Table
            doc.fontSize(14).font('Helvetica-Bold').text('Monthly Breakdown', 50, doc.y);
            doc.moveDown(1);

            const tableRows = monthlyData.map(d => [d.month, `$${d.amount.toLocaleString()}`]);
            drawTable(['Month', 'Revenue'], tableRows, doc.y);


        } else if (type === 'occupancy_stats') {
            const propertiesWithLeases = await prisma.property.findMany({
                where: { owners: { some: { id: ownerId } } },
                include: { units: { include: { leases: { where: { status: 'Active' } } } } }
            });

            drawHeader('Occupancy Analysis', `DATA AS OF: ${monthName} ${queryYear}`);

            let totalUnitsGlobal = 0;
            let totalOccupiedGlobal = 0;
            const tableRows = [];

            propertiesWithLeases.forEach(p => {
                const total = p.units.length;
                const occupied = p.units.filter(u => u.status === 'Occupied' || u.leases.length > 0).length;
                totalUnitsGlobal += total;
                totalOccupiedGlobal += occupied;
                const rate = total > 0 ? Math.round((occupied / total) * 100) : 0;
                tableRows.push([p.name, total.toString(), occupied.toString(), `${rate}%`]);
            });

            const globalRate = totalUnitsGlobal > 0 ? Math.round((totalOccupiedGlobal / totalUnitsGlobal) * 100) : 0;

            // Summary Circle (Simulated text)
            doc.fontSize(12).font('Helvetica').text('Global Portfolio Occupancy', 50, doc.y);
            doc.fontSize(24).font('Helvetica-Bold').fillColor(globalRate > 90 ? '#10b981' : (globalRate > 70 ? '#f59e0b' : '#ef4444')).text(`${globalRate}%`, 50, doc.y + 10);
            doc.fillColor('#000000');
            doc.moveDown(2);

            // Table
            doc.fontSize(14).font('Helvetica-Bold').text('Property Details', 50, doc.y);
            doc.moveDown(1);

            drawTable(['Property Name', 'Total Units', 'Occupied Units', 'Occupancy Rate'], tableRows, doc.y);
        }

        doc.end();

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
// GET /api/owner/profile
exports.getOwnerProfile = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const name = (user.firstName && user.lastName)
            ? `${user.firstName} ${user.lastName}`
            : user.name || 'Owner';

        res.json({
            name,
            email: user.email
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/invoices/:id/download
exports.downloadInvoice = async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id);
        const ownerId = req.user.id;

        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
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

        // Use the professional centralized PDF tool
        return generateInvoicePDF(invoice, res, settings);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/reports/rent-roll
exports.getOwnerRentRoll = async (req, res) => {
    try {
        const ownerId = req.user.id;

        const units = await prisma.unit.findMany({
            where: {
                property: {
                    owners: { some: { id: ownerId } }
                }
            },
            include: {
                property: true,
                bedroomsList: true,
                leases: {
                    where: { status: 'Active' },
                    include: { tenant: true }
                }
            }
        });

        let rentRollArray = [];
        let totalUnits = 0;
        let occupiedUnits = 0;
        let vacantUnits = 0;
        let occupiedBedrooms = 0;
        let vacantBedrooms = 0;
        let totalMonthlyRent = 0;

        units.forEach(u => {
            totalUnits++;
            const isFullUnit = u.rentalMode === 'FULL_UNIT';
            if (isFullUnit) {
                const activeLease = u.leases[0];
                if (activeLease) {
                    occupiedUnits++;
                    const rent = activeLease.monthlyRent ? parseFloat(activeLease.monthlyRent.toString()) : 0;
                    totalMonthlyRent += rent;

                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property?.name || 'N/A',
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: activeLease.tenant ? (activeLease.tenant.companyName || `${activeLease.tenant.firstName || ''} ${activeLease.tenant.lastName || ''}`.trim() || activeLease.tenant.name || '-') : '-',
                        startDate: activeLease.startDate,
                        endDate: activeLease.endDate,
                        monthlyRent: rent,
                        status: 'Occupied'
                    });
                } else {
                    vacantUnits++;
                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property?.name || 'N/A',
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: 'VACANT',
                        startDate: null,
                        endDate: null,
                        monthlyRent: parseFloat(u.rentAmount || 0),
                        status: 'Vacant'
                    });
                }
            } else {
                let unitIsFullyVacant = true;
                let unitIsFullyOccupied = true;

                if (u.bedroomsList.length === 0) {
                    vacantUnits++;
                } else {
                    u.bedroomsList.forEach(bedroom => {
                        // Priority 1: Check if there's an active lease specifically for this bedroom
                        const bLease = u.leases.find(l =>
                            l.bedroomId === bedroom.id ||
                            (l.tenant && l.tenant.bedroomId === bedroom.id)
                        );

                        // Priority 2: Check if there's an active FULL_UNIT lease for the entire unit
                        const unitLease = u.leases.find(l => l.leaseType === 'FULL_UNIT');

                        const activeLease = bLease || unitLease;

                        if (activeLease || bedroom.status === 'Occupied') {
                            occupiedBedrooms++;
                            unitIsFullyVacant = false;

                            if (activeLease) {
                                const rent = activeLease.monthlyRent ? parseFloat(activeLease.monthlyRent.toString()) : 0;
                                // Only count rent towards total if it's a bedroom-specific lease
                                // OR if it's a full unit lease but we're at the first bedroom (to avoid double counting)
                                if (bLease || (unitLease && bedroom === u.bedroomsList[0])) {
                                    totalMonthlyRent += rent;
                                }

                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: activeLease.tenant ? (activeLease.tenant.companyName || `${activeLease.tenant.firstName || ''} ${activeLease.tenant.lastName || ''}`.trim() || activeLease.tenant.name || 'N/A') : 'N/A',
                                    startDate: activeLease.startDate,
                                    endDate: activeLease.endDate,
                                    monthlyRent: rent,
                                    status: 'Occupied'
                                });
                            } else {
                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: 'Unknown (Occupied)',
                                    startDate: null,
                                    endDate: null,
                                    monthlyRent: 0,
                                    status: 'Occupied'
                                });
                            }
                        } else {
                            vacantBedrooms++;
                            unitIsFullyOccupied = false;
                            rentRollArray.push({
                                id: `bed-${bedroom.id}`,
                                buildingName: u.property?.name || 'N/A',
                                leaseType: 'Bedroom Lease',
                                unitNumber: u.unitNumber || u.name,
                                bedroomNumber: bedroom.bedroomNumber,
                                tenantName: 'VACANT',
                                startDate: null,
                                endDate: null,
                                monthlyRent: parseFloat(bedroom.rentAmount || 0),
                                status: 'Vacant'
                            });
                        }
                    });

                    if (unitIsFullyVacant) vacantUnits++;
                    else if (unitIsFullyOccupied) occupiedUnits++;
                    else occupiedUnits++;
                }
            }
        });

        res.json({
            summary: {
                totalUnits,
                occupiedUnits,
                occupiedBedrooms,
                vacantUnits,
                vacantBedrooms,
                totalMonthlyRent
            },
            rentRoll: rentRollArray
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error generating owner rent roll' });
    }
};
