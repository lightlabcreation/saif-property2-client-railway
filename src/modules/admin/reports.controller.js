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
                                include: { tenant: true, temp_unit: true }
                            },
                            reserved_by_user: true
                        }
                    },
                    leases: {
                        where: { status: 'Active' },
                        include: { tenant: true, temp_unit: true }
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
                                include: { tenant: true, temp_unit: true }
                            },
                            reserved_by_user: true
                        }
                    },
                    leases: {
                        where: { status: 'Active' },
                        include: { tenant: true, temp_unit: true }
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

        const tempLeases = await prisma.lease.findMany({
            where: { status: 'Active', temp_unit_id: { not: null } },
            include: { tenant: true, unit: true }
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

                    
                    let displayStatus = 'Occupied';
                    let relUnit = '-';
                    if (activeLease.temp_unit_id) {
                        displayStatus = 'Temporarily elsewhere';
                        relUnit = 'Temp Unit: ' + (activeLease.temp_unit?.unitNumber || activeLease.temp_unit?.name || activeLease.temp_unit_id);
                    }

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
                        status: displayStatus,
                        relatedUnit: relUnit,
                        isTempRow: false
                    });
                } else {
                    const isReserved = u.reserved_flag;
                    if (isReserved) {
                        occupiedUnits++; // Count as occupied for summary if reserved? Or keep separate?
                    } else {
                        vacantUnits++;
                    }
                    
                    let displayStatus = isReserved ? 'Reserved' : 'Vacant';
                    let prospectName = u.reserved_by_user ? (u.reserved_by_user.name || `${u.reserved_by_user.firstName || ''} ${u.reserved_by_user.lastName || ''}`.trim()) : (u.status_note || 'Reserved');

                    
                    const asTempLease = tempLeases.find(l => l.temp_unit_id === u.id);
                    if (asTempLease) {
                        displayStatus = 'Temporarily Occupied';
                        prospectName = (asTempLease.tenant?.name || asTempLease.tenant?.firstName + ' ' + asTempLease.tenant?.lastName) + ' (temporary)';
                        // Does not generate rent or vacancy loss per specs
                    } else if (isReserved) {
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
                        tenantName: isReserved || asTempLease ? prospectName : '-',
                        startDate: null,
                        endDate: null,
                        monthlyRent: asTempLease ? 0 : unitPotentialRent, 
                        potentialRent: asTempLease ? 0 : unitPotentialRent,
                        vacancyLoss: (isReserved || asTempLease) ? 0 : unitPotentialRent,
                        outstandingRent: unitRentBalance,
                        outstandingDeposit: unitDepositBalance,
                        status: displayStatus,
                        relatedUnit: asTempLease ? 'Contracted Unit: ' + (asTempLease.unit?.unitNumber || asTempLease.unit?.name) : '-',
                        isTempRow: !!asTempLease
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
                    const isFullyVacant = u.bedroomsList.every(bedroom => {
                        const bLease = bedroom.leases[0] || u.leases.find(l => l.bedroomId === bedroom.id);
                        return !(bLease || bedroom.status === 'Occupied' || bedroom.reserved_flag);
                    });

                    if (isFullyVacant) {
                        let totalUnitVacancyLoss = 0;
                        u.bedroomsList.forEach(bedroom => {
                            const typeRate = unitTypeRates.find(r => r.typeName.toLowerCase() === (u.unitType || '').toLowerCase());
                            const bPotentialRent = typeRate ? parseFloat(typeRate.singleBedroomRate) : parseFloat(bedroom.rentAmount || 0);
                            
                            totalPotentialMonthlyRent += bPotentialRent;
                            totalVacancyLoss += bPotentialRent;
                            totalUnitVacancyLoss += bPotentialRent;
                        });

                        rentRollArray.push({
                            id: `unit-${u.id}`,
                            buildingName: u.property?.name || 'N/A',
                            leaseType: 'Full Unit',
                            unitNumber: u.unitNumber || u.name,
                            bedroomNumber: '-',
                            tenantName: '-',
                            startDate: null,
                            endDate: null,
                            monthlyRent: totalUnitVacancyLoss,
                            potentialRent: totalUnitVacancyLoss,
                            vacancyLoss: totalUnitVacancyLoss,
                            outstandingRent: 0,
                            outstandingDeposit: 0,
                            status: 'Vacant',
                            relatedUnit: '-',
                            isTempRow: false
                        });

                        vacantUnits++;
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
                                        status: 'Occupied',
                                        relatedUnit: '-',
                                        isTempRow: false
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
                                        status: 'Reserved',
                                        relatedUnit: '-',
                                        isTempRow: false
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
                                        status: 'Occupied',
                                        relatedUnit: '-',
                                        isTempRow: false
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
                                    status: 'Vacant',
                            relatedUnit: '-',
                            isTempRow: false
                        });
                            }
                        });

                        if (unitIsFullyVacant) vacantUnits++;
                    }
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

// GET /api/admin/reports/monthly-rent-collections
exports.getMonthlyRentCollectionsReport = async (req, res) => {
    try {
        const { startMonth, endMonth, buildingId, format = 'csv' } = req.query;
        if (!startMonth || !endMonth) {
            return res.status(400).json({ message: 'startMonth and endMonth are required (YYYY-MM)' });
        }

        const exceljs = require('exceljs');
        const startParts = startMonth.split('-');
        const endParts = endMonth.split('-');
        
        const startYear = parseInt(startParts[0]);
        const startMonthIndex = parseInt(startParts[1]) - 1; 
        
        const endYear = parseInt(endParts[0]);
        const endMonthIndex = parseInt(endParts[1]) - 1;
        
        const startDate = new Date(startYear, startMonthIndex, 1);
        const endDate = new Date(endYear, endMonthIndex + 1, 0, 23, 59, 59, 999);

        const leases = await prisma.lease.findMany({
            include: {
                tenant: true,
                unit: { include: { property: true } },
                bedroom: true
            }
        });

        const monthsToReport = [];
        let current = new Date(startYear, startMonthIndex, 1);
        while (current <= endDate) {
            monthsToReport.push(new Date(current));
            current.setMonth(current.getMonth() + 1);
        }

        const reportData = [];

        const invoices = await prisma.invoice.findMany({
            include: { payments: true, items: true }
        });

        const deposits = await prisma.refundAdjustment.findMany();
        
        for (const monthDate of monthsToReport) {
            const mYear = monthDate.getFullYear();
            const mMonth = monthDate.getMonth();
            const mMonthStr = monthDate.toLocaleString('en-US', { month: 'long' }) + ' ' + mYear;
            
            const monthStart = new Date(mYear, mMonth, 1);
            const monthEnd = new Date(mYear, mMonth + 1, 0, 23, 59, 59, 999);

            for (const lease of leases) {
                const lStart = lease.startDate ? new Date(lease.startDate) : null;
                const lEnd = lease.endDate ? new Date(lease.endDate) : null;
                
                if (!lStart) continue;
                
                if (lStart <= monthEnd && (!lEnd || lEnd >= monthStart)) {
                    const leaseBuildingId = lease.unit?.propertyId;
                    if (buildingId && buildingId !== 'all' && leaseBuildingId != buildingId) {
                        continue;
                    }

                    const tenantId = lease.tenantId;
                    const shortMonthStr = monthDate.toLocaleString('en-US', { month: 'short' }) + " '" + mYear.toString().slice(-2);
                    
                    const applicableInvoices = invoices.filter(inv => 
                        inv.tenantId === tenantId && 
                        (inv.leaseId === lease.id || inv.unitId === lease.unitId) &&
                        (
                            inv.month === shortMonthStr || 
                            (inv.dueDate && new Date(inv.dueDate) >= monthStart && new Date(inv.dueDate) <= monthEnd) ||
                            (new Date(inv.createdAt) >= monthStart && new Date(inv.createdAt) <= monthEnd)
                        )
                    );

                    let rentCharged = 0;
                    let rentCollected = 0;
                    let lockerCharged = 0;
                    let otherCharged = 0;

                    applicableInvoices.forEach(inv => {
                        if (inv.category === 'RENT') {
                            rentCharged += parseFloat(inv.amount || 0);
                            inv.payments.forEach(p => {
                                rentCollected += parseFloat(p.amount || 0);
                            });
                        } else if (inv.category === 'SERVICE' && (inv.description || '').toLowerCase().includes('locker')) {
                            lockerCharged += parseFloat(inv.amount || 0);
                        } else {
                            if (inv.category !== 'SECURITY_DEPOSIT') {
                                otherCharged += parseFloat(inv.amount || 0);
                            }
                        }
                    });

                    let depositCollected = 0;
                    invoices.filter(inv => inv.tenantId === tenantId && (inv.category === 'SECURITY_DEPOSIT' || (inv.description || '').toLowerCase().includes('deposit'))).forEach(inv => {
                        inv.payments.forEach(p => {
                            const pDate = new Date(p.date);
                            if (pDate >= monthStart && pDate <= monthEnd) {
                                depositCollected += parseFloat(p.amount || 0);
                            }
                        });
                    });

                    let depositRefunded = 0;
                    deposits.filter(d => d.tenantId === tenantId && d.type === 'Refund' && d.status === 'Completed').forEach(d => {
                        const dDate = new Date(d.date);
                        if (dDate >= monthStart && dDate <= monthEnd) {
                            depositRefunded += parseFloat(d.amount || 0);
                        }
                    });

                    const depositTotal = depositCollected - depositRefunded;

                    const unitNumber = lease.leaseType === 'BEDROOM' ? 
                        (lease.bedroom ? `${lease.unit.name}-${lease.bedroom.bedroomNumber}` : lease.unit.name) :
                        lease.unit.name;
                    
                    const tenantName = lease.tenant ? (lease.tenant.companyName || `${lease.tenant.firstName || ''} ${lease.tenant.lastName || ''}`.trim() || lease.tenant.name || '-') : '-';
                    const isExpired = (lEnd && lEnd < new Date()) ? 'Yes' : 'No';

                    reportData.push({
                        Month: mMonthStr,
                        'Unit Number': unitNumber,
                        'Rent Charged': rentCharged,
                        'Rent Collected': rentCollected,
                        'Deposit': depositTotal,
                        'Lead Tenant Name': tenantName,
                        'Unit Type': lease.unit?.unitType || lease.unit?.unit_type || '-',
                        'Parking Charged': 0,
                        'Internet Charged': 0,
                        'Locker Charged': lockerCharged,
                        'Other Charges': otherCharged,
                        'Lease Start': lStart ? lStart.toISOString().split('T')[0] : '-',
                        'Lease End': lEnd ? lEnd.toISOString().split('T')[0] : '-',
                        'Expired': isExpired
                    });
                }
            }
        }

        const workbook = new exceljs.Workbook();
        const sheet = workbook.addWorksheet('Rent & Collections');
        
        sheet.columns = [
            { header: 'Month', key: 'Month', width: 20 },
            { header: 'Unit Number', key: 'Unit Number', width: 15 },
            { header: 'Rent Charged', key: 'Rent Charged', width: 15 },
            { header: 'Rent Collected', key: 'Rent Collected', width: 15 },
            { header: 'Deposit', key: 'Deposit', width: 15 },
            { header: 'Lead Tenant Name', key: 'Lead Tenant Name', width: 25 },
            { header: 'Unit Type', key: 'Unit Type', width: 15 },
            { header: 'Parking Charged', key: 'Parking Charged', width: 15 },
            { header: 'Internet Charged', key: 'Internet Charged', width: 15 },
            { header: 'Locker Charged', key: 'Locker Charged', width: 15 },
            { header: 'Other Charges', key: 'Other Charges', width: 15 },
            { header: 'Lease Start', key: 'Lease Start', width: 15 },
            { header: 'Lease End', key: 'Lease End', width: 15 },
            { header: 'Expired', key: 'Expired', width: 10 }
        ];

        reportData.forEach(row => {
            sheet.addRow(row);
        });

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="monthly-rent-collections.csv"');
            await workbook.csv.write(res);
        } else {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="monthly-rent-collections.xlsx"');
            await workbook.xlsx.write(res);
        }
        res.end();

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error generating Monthly Rent Collections Report' });
    }
};
