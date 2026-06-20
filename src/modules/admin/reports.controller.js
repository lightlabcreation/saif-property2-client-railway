const prisma = require('../../config/prisma');
const { generateReportPDF } = require('../../utils/pdf.utils');

// GET /api/admin/reports/:id/download
exports.downloadReportPDF = async (req, res) => {
    try {
        const { id } = req.params;
        // Basic implementation, can be expanded to fetch real data
        generateReportPDF(id, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

// GET /api/admin/reports
exports.getReports = async (req, res) => {
    try {
        // --- KPI Calculation ---

        // Total Revenue (All Payments Received)
        const [allInvoices, allRefunds] = await Promise.all([
            prisma.invoice.findMany({ where: { paidAmount: { gt: 0 } } }),
            prisma.refundAdjustment.findMany({ where: { status: 'Completed' } })
        ]);
        const grossRevenue = allInvoices.reduce((sum, i) => sum + parseFloat(i.paidAmount), 0);
        const totalRefunds = allRefunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);
        const totalRevenue = grossRevenue - totalRefunds;

        // Occupancy Rate - Filter out INACTIVE (In Construction) units
        const unitFilter = {
            unit_status: 'ACTIVE'
        };
        const totalUnits = await prisma.unit.count({ where: unitFilter });
        const occupiedUnits = await prisma.unit.count({ 
            where: { 
                status: { not: 'Vacant' },
                ...unitFilter
            } 
        });
        const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

        // Active Leases
        const activeLeases = await prisma.lease.count({ 
            where: { 
                status: 'Active',
                unit: unitFilter
            } 
        });

        // Outstanding Rent Dues (Total Remaining Balance for RENT category)
        const unpaidRentInvoices = await prisma.invoice.findMany({
            where: {
                status: { notIn: ['paid', 'draft'] },
                category: 'RENT'
            }
        });
        const outstandingRent = unpaidRentInvoices.reduce((sum, i) => sum + (parseFloat(i.amount) - parseFloat(i.paidAmount)), 0);

        // Outstanding Deposit Dues (Total Remaining Balance for Security Deposit category or description)
        const unpaidDepositInvoices = await prisma.invoice.findMany({
            where: {
                status: { notIn: ['paid', 'draft'] },
                OR: [
                    { category: 'SECURITY_DEPOSIT' },
                    { 
                        category: 'SERVICE',
                        description: { contains: 'Security Deposit' }
                    }
                ]
            }
        });
        const outstandingDeposits = unpaidDepositInvoices.reduce((sum, i) => sum + (parseFloat(i.amount) - parseFloat(i.paidAmount)), 0);

        // --- Graphs Data ---

        // Monthly Revenue (Aggregate by month string using paidAmount)
        const monthlyMap = {};
        allInvoices.forEach(inv => {
            if (!monthlyMap[inv.month]) monthlyMap[inv.month] = 0;
            monthlyMap[inv.month] += parseFloat(inv.paidAmount);
        });

        // Subtract refunds from their respective months in the chart
        allRefunds.forEach(ref => {
            // Note: the month format in invoices is "MMM 'YY", we match that for consistency
            const monthStr = ref.date.toLocaleString('en-US', { month: 'short' }) + " '" + ref.date.getFullYear().toString().slice(-2);
            if (monthlyMap[monthStr] !== undefined) {
                monthlyMap[monthStr] -= parseFloat(ref.amount);
            }
        });


        // Lease Type Distribution
        // We need to fetch units to check bedrooms count for lease type heuristic
        const leases = await prisma.lease.findMany({
            where: { status: 'Active' },
            include: { unit: true }
        });

        let fullUnitCount = 0;
        let bedroomCount = 0;
        leases.forEach(l => {
            if (l.unit.rentalMode === 'FULL_UNIT') fullUnitCount++;
            else bedroomCount++;
        });

        // --- Top Performing Properties ---
        const properties = await prisma.property.findMany({
            include: {
                units: {
                    include: {
                        leases: { where: { status: 'Active' } },
                        invoices: { where: { status: 'paid' } }
                    }
                }
            }
        });

        const propertyPerformance = properties.map(p => {
            const revenue = p.units.reduce((rSum, u) => {
                return rSum + u.invoices.reduce((iSum, i) => iSum + parseFloat(i.paidAmount), 0);
            }, 0);

            const pTotalUnits = p.units.length;
            const pOccupied = p.units.filter(u => u.status !== 'Vacant').length;
            const pOccupancy = pTotalUnits > 0 ? Math.round((pOccupied / pTotalUnits) * 100) : 0;

            return {
                name: p.name,
                revenue,
                occupancy: pOccupancy
            };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 5); // Top 5

        // Tenant vs Resident counts
        const tenantCount = await prisma.user.count({
            where: { role: 'TENANT', type: { in: ['INDIVIDUAL', 'COMPANY'] } }
        });
        const residentCount = await prisma.user.count({
            where: { role: 'TENANT', type: 'RESIDENT' }
        });

        res.json({
            kpi: {
                totalRevenue,
                occupancyRate,
                activeLeases,
                outstandingRent,
                outstandingDeposits,
                outstandingDues: outstandingRent + outstandingDeposits,
                tenantCount,
                residentCount
            },
            monthlyRevenue: Object.keys(monthlyMap).map(k => ({ month: k, amount: monthlyMap[k] })),
            leaseDistribution: { fullUnit: fullUnitCount, bedroom: bedroomCount },
            topProperties: propertyPerformance
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/reports/rent-roll
exports.getRentRoll = async (req, res) => {
    try {
        let units;
        try {
            units = await prisma.unit.findMany({
                where: {
                    OR: [
                        { unit_status: 'ACTIVE' },
                        { reserved_flag: true },
                        { bedroomsList: { some: { reserved_flag: true } } }
                    ]
                },
                include: {
                    property: true,
                    bedroomsList: {
                        include: {
                            leases: {
                                where: { status: 'Active' },
                                include: { tenant: true }
                            },
                            reserved_by_user: true
                        }
                    },
                    leases: {
                        where: { status: 'Active' },
                        include: { tenant: true }
                    },
                    invoices: {
                        where: { status: { notIn: ['paid', 'draft'] } }
                    },
                    reserved_by_user: true
                }
            });
        } catch (err) {
            console.warn('Rent Roll Fallback: unit_status column not yet sync. Fetching all units.');
            units = await prisma.unit.findMany({
                include: {
                    property: true,
                    bedroomsList: {
                        include: {
                            leases: {
                                where: { status: 'Active' },
                                include: { tenant: true }
                            },
                            reserved_by_user: true
                        }
                    },
                    leases: {
                        where: { status: 'Active' },
                        include: { tenant: true }
                    },
                    invoices: {
                        where: { status: { notIn: ['paid', 'draft'] } }
                    },
                    reserved_by_user: true
                }
            });
        }

        // Also fetch all unpaid invoices for all tenants to calculate balances accurately
        // (Actually, we can optimize by including invoices in the unit query)

        // Calculate Portfolio-wide Outstanding Balances (for Summary Cards)
        const allUnpaidInvoices = await prisma.invoice.findMany({
            where: { status: { notIn: ['paid', 'draft'] } }
        });

        const unitTypeRates = await prisma.unitTypeRate.findMany();

        let totalOutstandingRent = 0;
        let totalOutstandingDeposits = 0;

        allUnpaidInvoices.forEach(inv => {
            const isDeposit = inv.category === 'SECURITY_DEPOSIT' || 
                             (inv.category === 'SERVICE' && inv.description?.includes('Security Deposit'));
            const balance = parseFloat(inv.amount) - parseFloat(inv.paidAmount);
            if (isDeposit) totalOutstandingDeposits += balance;
            else if (inv.category === 'RENT') totalOutstandingRent += balance;
        });

        let rentRollArray = [];
        let totalUnits = 0;
        let occupiedUnits = 0;
        let vacantUnits = 0;
        let occupiedBedrooms = 0;
        let vacantBedrooms = 0;
        
        let totalActualMonthlyRent = 0;
        let totalPotentialMonthlyRent = 0;
        let totalVacancyLoss = 0;

        units.forEach(u => {
            totalUnits++;
            const isFullUnit = u.rentalMode === 'FULL_UNIT';
            
            const typeRate = unitTypeRates.find(r => r.typeName.toLowerCase() === (u.unitType || '').toLowerCase());
            const unitPotentialRent = typeRate ? parseFloat(typeRate.fullUnitRate) : parseFloat(u.rentAmount || 0);

            if (isFullUnit) {
                const activeLease = u.leases[0];
                
                // Calculate balances for this unit/tenant
                let unitRentBalance = 0;
                let unitDepositBalance = 0;

                if (activeLease && activeLease.tenantId) {
                    // Look at ALL unpaid invoices for this tenant to be safe
                    allUnpaidInvoices.filter(inv => inv.tenantId === activeLease.tenantId).forEach(inv => {
                        const isDeposit = inv.category === 'SECURITY_DEPOSIT' || 
                                         (inv.category === 'SERVICE' && inv.description?.includes('Security Deposit'));
                        if (isDeposit) unitDepositBalance += parseFloat(inv.balanceDue);
                        else if (inv.category === 'RENT') unitRentBalance += parseFloat(inv.balanceDue);
                    });
                } else {
                    // Fallback to unit-linked invoices if no active lease but unit has debt? 
                    // Usually we only show debt for current tenants in rent roll.
                    u.invoices.forEach(inv => {
                        const isDeposit = inv.category === 'SECURITY_DEPOSIT' || 
                                         (inv.category === 'SERVICE' && inv.description?.includes('Security Deposit'));
                        if (isDeposit) unitDepositBalance += parseFloat(inv.balanceDue);
                        else if (inv.category === 'RENT') unitRentBalance += parseFloat(inv.balanceDue);
                    });
                }

                if (activeLease) {
                    occupiedUnits++;
                    const rent = activeLease.monthlyRent ? parseFloat(activeLease.monthlyRent.toString()) : 0;
                    totalActualMonthlyRent += rent;
                    totalPotentialMonthlyRent += rent; // If occupied, potential is the actual rent

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
                        potentialRent: rent,
                        vacancyLoss: 0,
                        outstandingRent: unitRentBalance,
                        outstandingDeposit: unitDepositBalance,
                        status: 'Occupied'
                    });
                } else {
                    const isReserved = u.reserved_flag;
                    if (isReserved) {
                        occupiedUnits++; // Count as occupied for summary if reserved? Or keep separate?
                    } else {
                        vacantUnits++;
                    }
                    
                    const displayStatus = isReserved ? 'Reserved' : 'Vacant';
                    const prospectName = u.reserved_by_user ? (u.reserved_by_user.name || `${u.reserved_by_user.firstName || ''} ${u.reserved_by_user.lastName || ''}`.trim()) : (u.status_note || 'Reserved');

                    if (isReserved) {
                        totalPotentialMonthlyRent += unitPotentialRent;
                    } else {
                        totalPotentialMonthlyRent += unitPotentialRent;
                        totalVacancyLoss += unitPotentialRent;
                    }

                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property?.name || 'N/A',
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: isReserved ? prospectName : '-',
                        startDate: null,
                        endDate: null,
                        monthlyRent: unitPotentialRent, 
                        potentialRent: unitPotentialRent,
                        vacancyLoss: isReserved ? 0 : unitPotentialRent,
                        outstandingRent: unitRentBalance,
                        outstandingDeposit: unitDepositBalance,
                        status: displayStatus
                    });
                }
            } else {
                // ... logic for bedrooms ... (already handles potential rent in the loop below)
                // BEDROOM_WISE mode
                let unitIsFullyVacant = true;
                let unitIsFullyOccupied = true;

                if (u.bedroomsList.length === 0) {
                    vacantUnits++;
                    totalPotentialMonthlyRent += unitPotentialRent;
                    totalVacancyLoss += unitPotentialRent;
                } else {
                    u.bedroomsList.forEach(bedroom => {
                        const typeRate = unitTypeRates.find(r => r.typeName.toLowerCase() === (u.unitType || '').toLowerCase());
                        const bPotentialRent = typeRate ? parseFloat(typeRate.singleBedroomRate) : parseFloat(bedroom.rentAmount || 0);
                        const bLease = bedroom.leases[0] || u.leases.find(l => l.bedroomId === bedroom.id);
                        
                        // Calculate balances for this bedroom/tenant
                        let bRentBalance = 0;
                        let bDepositBalance = 0;

                        if (bLease && bLease.tenantId) {
                            // Filter invoices from ALL unpaid for this specific tenant
                            allUnpaidInvoices.filter(inv => inv.tenantId === bLease.tenantId).forEach(inv => {
                                const isDeposit = inv.category === 'SECURITY_DEPOSIT' || 
                                                (inv.category === 'SERVICE' && inv.description?.includes('Security Deposit'));
                                if (isDeposit) bDepositBalance += parseFloat(inv.balanceDue);
                                else if (inv.category === 'RENT') bRentBalance += parseFloat(inv.balanceDue);
                            });
                        }

                        if (bLease || bedroom.status === 'Occupied' || bedroom.reserved_flag) {
                            occupiedBedrooms++;
                            unitIsFullyVacant = false;

                            if (bLease) {
                                const rent = bLease.monthlyRent ? parseFloat(bLease.monthlyRent.toString()) : 0;
                                totalActualMonthlyRent += rent;
                                totalPotentialMonthlyRent += rent;

                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    parentUnitId: u.id,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: bLease.tenant ? (bLease.tenant.companyName || `${bLease.tenant.firstName || ''} ${bLease.tenant.lastName || ''}`.trim() || bLease.tenant.name || '-') : '-',
                                    startDate: bLease.startDate,
                                    endDate: bLease.endDate,
                                    monthlyRent: rent,
                                    potentialRent: rent,
                                    vacancyLoss: 0,
                                    outstandingRent: bRentBalance,
                                    outstandingDeposit: bDepositBalance,
                                    status: 'Occupied'
                                });
                            } else if (bedroom.reserved_flag) {
                                totalPotentialMonthlyRent += bPotentialRent;
                                const prospectName = bedroom.reserved_by_user ? (bedroom.reserved_by_user.name || `${bedroom.reserved_by_user.firstName || ''} ${bedroom.reserved_by_user.lastName || ''}`.trim()) : (u.status_note || 'Reserved');
                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    parentUnitId: u.id,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: prospectName,
                                    startDate: null,
                                    endDate: null,
                                    monthlyRent: bPotentialRent,
                                    potentialRent: bPotentialRent,
                                    vacancyLoss: 0,
                                    outstandingRent: 0,
                                    outstandingDeposit: 0,
                                    status: 'Reserved'
                                });
                            } else {
                                // Occupied but no lease found (fallback)
                                totalPotentialMonthlyRent += bPotentialRent;
                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    parentUnitId: u.id,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: 'Unknown (Occupied)',
                                    startDate: null,
                                    endDate: null,
                                    monthlyRent: 0,
                                    potentialRent: bPotentialRent,
                                    vacancyLoss: 0,
                                    outstandingRent: 0,
                                    outstandingDeposit: 0,
                                    status: 'Occupied'
                                });
                            }
                        } else {
                            vacantBedrooms++;
                            unitIsFullyOccupied = false;
                            totalPotentialMonthlyRent += bPotentialRent;
                            totalVacancyLoss += bPotentialRent;

                            rentRollArray.push({
                                id: `bed-${bedroom.id}`,
                                parentUnitId: u.id,
                                buildingName: u.property?.name || 'N/A',
                                leaseType: 'Bedroom Lease',
                                unitNumber: u.unitNumber || u.name,
                                bedroomNumber: bedroom.bedroomNumber,
                                tenantName: '-',
                                startDate: null,
                                endDate: null,
                                monthlyRent: bPotentialRent, // Shows Potential Rent when vacant
                                potentialRent: bPotentialRent,
                                vacancyLoss: bPotentialRent,
                                outstandingRent: 0,
                                outstandingDeposit: 0,
                                status: 'Vacant'
                            });
                        }
                    });

                    if (unitIsFullyVacant) vacantUnits++;
                    else if (unitIsFullyOccupied) occupiedUnits++;
                    else occupiedUnits++; // Partially occupied is counted as occupied unit broadly
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
                totalActualMonthlyRent,
                totalPotentialMonthlyRent,
                totalVacancyLoss,
                totalOutstandingRent,
                totalOutstandingDeposits,
                totalOutstandingBalance: totalOutstandingRent + totalOutstandingDeposits
            },
            rentRoll: rentRollArray
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error generating rent roll' });
    }
};

// PUT /api/admin/reports/potential-rent
exports.updatePotentialRent = async (req, res) => {
    try {
        const { id, type, potentialRent } = req.body;
        
        if (!id || !type) {
            return res.status(400).json({ message: 'Missing id or type in request body' });
        }

        const rent = parseFloat(potentialRent || 0);
        const cleanId = parseInt(id.toString().replace('unit-', '').replace('bed-', ''));

        if (type === 'Full Unit' || type.toLowerCase().includes('unit')) {
            await prisma.unit.update({
                where: { id: cleanId },
                data: { rentAmount: rent }
            });
        } else if (type === 'Bedroom Lease' || type.toLowerCase().includes('bedroom')) {
            await prisma.bedroom.update({
                where: { id: cleanId },
                data: { rentAmount: rent }
            });
        } else {
            return res.status(400).json({ message: 'Invalid lease type parameter' });
        }

        res.json({ success: true, message: 'Potential rent updated successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error updating potential rent' });
    }
};
