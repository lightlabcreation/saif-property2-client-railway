const prisma = require('../../config/prisma');

exports.getRevenueStats = async (req, res) => {
    try {
        const { ownerId } = req.query;
        console.log('Revenue Stats - Received ownerId:', ownerId);
        const parsedOwnerId = ownerId && ownerId !== 'null' && ownerId !== '' ? parseInt(ownerId) : null;

        let propertyIds = [];
        if (parsedOwnerId) {
            const ownerProperties = await prisma.property.findMany({
                where: {
                    owners: {
                        some: { id: parsedOwnerId }
                    }
                },
                select: { id: true }
            });
            propertyIds = ownerProperties.map(p => p.id);
        }

        // Use unitFilter correctly so global view (no owner) is not filtered to empty set
        const unitFilter = parsedOwnerId ? { propertyId: { in: propertyIds } } : {};

        // Projected Revenue: Sum of monthlyRent across all Active leases
        const leaseAgg = await prisma.lease.aggregate({
            where: {
                status: 'Active',
                unit: unitFilter
            },
            _sum: { monthlyRent: true }
        });
        const projectedRevenue = parseFloat(leaseAgg._sum.monthlyRent) || 0;

        // Fetch all paid invoices for Actual Revenue and breakdowns
        const [invoices, refunds, allocations] = await Promise.all([
          prisma.invoice.findMany({
              where: {
                  paidAmount: { gt: 0 },
                  unit: unitFilter
              },
              include: { unit: { include: { property: true } } }
          }),
          prisma.refundAdjustment.findMany({
              where: {
                  status: 'Completed',
                  unit: unitFilter
              },
              include: { unit: { include: { property: true } } }
          }),
          prisma.payment.findMany({
            where: {
              method: 'Security Deposit Allocation',
              invoice: { unit: unitFilter }
            },
            include: { invoice: { include: { unit: { include: { property: true } } } } }
          })
        ]);

        // Helper to standardize month keys (e.g., "March 2026")
        const getMonthKey = (dateInput) => {
            const d = new Date(dateInput);
            if (isNaN(d.getTime())) return dateInput; // Fallback to raw string
            return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        };

        let actualRevenue = 0;
        let actualRent = 0;
        let actualDeposit = 0;
        let actualServiceFees = 0;
        const propertyMap = {};   // { propName: { amount, rent, deposit, serviceFees, monthly: { month: {...} } } }
        const monthlyMap = {};    // { month: { amount, rent, deposit, serviceFees } }

        invoices.forEach(inv => {
            const amount = parseFloat(inv.paidAmount) || 0;
            actualRevenue += amount;

            const desc = (inv.description || '').toLowerCase();
            const category = (inv.category || '').toUpperCase();
            let type = 'Rent';

            // 🟢 HIGH PRECISISION CATEGORIZATION
            if (category === 'SECURITY_DEPOSIT') {
                type = 'Deposit';
                actualDeposit += amount;
            } else if (category === 'RENT') {
                type = 'Rent';
                actualRent += amount;
            } 
            // CATCH EXCEPTION: Description says "Deposit" but category is wrong (like the $5000 SERVICE error)
            else if (desc.includes('deposit')) {
                type = 'Deposit';
                actualDeposit += amount;
            } 
            // OTHER CATEGORIES
            else if (category === 'SERVICE' || category === 'LATE_FEE') {
                type = 'ServiceFees';
                actualServiceFees += amount;
            } 
            // FALLBACKS (For old un-tagged data)
            else if (desc.includes('rent') || desc.includes('lease')) {
                type = 'Rent';
                actualRent += amount;
            } else if (desc.includes('service') || desc.includes('fee')) {
                type = 'ServiceFees';
                actualServiceFees += amount;
            } else {
                type = 'Rent'; // Default to Rent
                actualRent += amount;
            }

            // Breakdown by Property (cumulative + monthly)
            const propName = inv.unit?.property?.name || 'Other Building';
            if (!propertyMap[propName]) propertyMap[propName] = { amount: 0, rent: 0, deposit: 0, serviceFees: 0, monthly: {} };
            // Note: propertyMap[propName].amount handled as sum of parts at the end for consistency
            if (type === 'Rent') propertyMap[propName].rent += amount;
            else if (type === 'Deposit') propertyMap[propName].deposit += amount;
            else if (type === 'ServiceFees') propertyMap[propName].serviceFees += amount;

            // Monthly breakdown per property
            const mon = getMonthKey(inv.month);
            if (!propertyMap[propName].monthly[mon]) propertyMap[propName].monthly[mon] = { amount: 0, rent: 0, deposit: 0, serviceFees: 0 };
            if (type === 'Rent') propertyMap[propName].monthly[mon].rent += amount;
            else if (type === 'Deposit') propertyMap[propName].monthly[mon].deposit += amount;
            else if (type === 'ServiceFees') propertyMap[propName].monthly[mon].serviceFees += amount;

            // Global monthly breakdown
            if (!monthlyMap[mon]) monthlyMap[mon] = { amount: 0, rent: 0, deposit: 0, serviceFees: 0 };
            if (type === 'Rent') monthlyMap[mon].rent += amount;
            else if (type === 'Deposit') monthlyMap[mon].deposit += amount;
            else if (type === 'ServiceFees') monthlyMap[mon].serviceFees += amount;
        });

        // Subtract refunds from totals and breakdowns
        refunds.forEach(ref => {
          const amount = Math.abs(parseFloat(ref.amount)) || 0;
          
          let type = 'Rent';
          const rType = ref.type.toLowerCase();
          const rReason = (ref.reason || '').toLowerCase();
          
          if (rType.includes('deposit') || rReason.includes('deposit')) {
            type = 'Deposit';
            actualDeposit -= amount;
          } else if (rType.includes('adjustment') || rType.includes('service') || rReason.includes('fee')) {
            type = 'ServiceFees';
            actualServiceFees -= amount;
          } else {
            type = 'Rent';
            actualRent -= amount;
          }

          const propName = ref.unit?.property?.name || 'Other Building';
          if (propertyMap[propName]) {
            if (type === 'Rent') propertyMap[propName].rent -= amount;
            else if (type === 'Deposit') propertyMap[propName].deposit -= amount;
            else if (type === 'ServiceFees') propertyMap[propName].serviceFees -= amount;
          }

          const mon = getMonthKey(ref.date);
          if (monthlyMap[mon]) {
            if (type === 'Rent') monthlyMap[mon].rent -= amount;
            else if (type === 'Deposit') monthlyMap[mon].deposit -= amount;
            else if (type === 'ServiceFees') monthlyMap[mon].serviceFees -= amount;
          }

          if (propertyMap[propName] && propertyMap[propName].monthly[mon]) {
            if (type === 'Rent') propertyMap[propName].monthly[mon].rent -= amount;
            else if (type === 'Deposit') propertyMap[propName].monthly[mon].deposit -= amount;
            else if (type === 'ServiceFees') propertyMap[propName].monthly[mon].serviceFees -= amount;
          }
        });

        // Subtract Allocations from the "Deposit" pool (they already moved to Rent/ServiceFees via invoices)
        allocations.forEach(alloc => {
          const amount = parseFloat(alloc.amount) || 0;
          // Subtract from actualRevenue to prevent double-counting (since it's already in the target invoice's paidAmount)
          actualRevenue -= amount;
          actualDeposit -= amount;

          const propName = alloc.invoice?.unit?.property?.name || 'Other Building';
          if (propertyMap[propName]) {
            propertyMap[propName].amount -= amount;
            propertyMap[propName].deposit -= amount;
          }

        });

        // 🟢 FINAL AGGREGATION: Recalculate totals as sum of realization parts
        // actualRevenue = Total Rent Collected + Remaining Deposits Held + Fees
        actualRevenue = actualRent + actualDeposit + actualServiceFees;

        // Ensure property totals are also calculated as sum of their parts
        Object.keys(propertyMap).forEach(pKey => {
          const p = propertyMap[pKey];
          p.amount = p.rent + p.deposit + p.serviceFees;
          Object.keys(p.monthly).forEach(mKey => {
            const m = p.monthly[mKey];
            m.amount = m.rent + m.deposit + m.serviceFees;
          });
        });

        // Ensure global monthly totals match
        Object.keys(monthlyMap).forEach(mKey => {
          const m = monthlyMap[mKey];
          m.amount = m.rent + m.deposit + m.serviceFees;
        });


        const monthSorter = (a, b) => {
            const parseDate = (s) => {
                const [mName, y] = s.split(' ');
                const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                const mIdx = fullMonthNames.indexOf(mName);
                if (mIdx === -1) return 0;
                return new Date(parseInt(y), mIdx).getTime();
            };
            return parseDate(a) - parseDate(b);
        };

        // Sort monthly data chronologically
        const monthlyRevenue = Object.keys(monthlyMap)
            .sort(monthSorter)
            .map(m => {
                const parts = m.split(' ');
                const label = parts.length >= 2 
                    ? `${parts[0].substring(0, 3)} '${parts[1].slice(-2)}` 
                    : m; // Fallback to raw string if format is unexpected
                return {
                    month: label,
                    amount: monthlyMap[m].amount,
                    rent: monthlyMap[m].rent,
                    deposit: monthlyMap[m].deposit,
                    serviceFees: monthlyMap[m].serviceFees
                };
            });

        // Build revenueByProperty with monthly breakdown
        const revenueByProperty = Object.keys(propertyMap).map(p => ({
            name: p,
            amount: propertyMap[p].amount,
            rent: propertyMap[p].rent,
            deposit: propertyMap[p].deposit,
            serviceFees: propertyMap[p].serviceFees,
            monthly: Object.keys(propertyMap[p].monthly)
                .sort(monthSorter)
                .map(m => {
                    const parts = m.split(' ');
                    const label = parts.length >= 2 
                        ? `${parts[0].substring(0, 3)} '${parts[1].slice(-2)}` 
                        : m;
                    return {
                        month: label,
                        ...propertyMap[p].monthly[m]
                    };
                })
        }));

        res.json({
            actualRevenue,
            actualRent,
            actualDeposit,
            actualServiceFees,
            projectedRevenue,
            totalRevenue: actualRevenue,
            monthlyRevenue,
            revenueByProperty
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getVacancyStats = async (req, res) => {
    try {
        const { ownerId } = req.query;
        console.log('Vacancy Stats - Received ownerId:', ownerId);
        const parsedOwnerId = ownerId && ownerId !== 'null' && ownerId !== '' ? parseInt(ownerId) : null;

        const whereClause = parsedOwnerId ? {
            property: {
                owners: {
                    some: { id: parsedOwnerId }
                }
            }
        } : {};

        // Fetch all units with their bedrooms and active leases
        let units;
        const fetchArgs = {
            where: {
                ...whereClause,
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
                            select: { id: true, bedroomId: true }
                        }
                    }
                },
                leases: {
                    where: { status: 'Active' },
                    select: { id: true, bedroomId: true }
                }
            }
        };

        try {
            units = await prisma.unit.findMany(fetchArgs);
        } catch (err) {
            console.warn('Vacancy Stats Fallback: unit_status column not recognized by client. Fetching all units.');
            const fallbackWhere = { ...whereClause };
            units = await prisma.unit.findMany({
                where: fallbackWhere,
                include: fetchArgs.include
            });
        }

        let totalVacantBedrooms = 0;
        let total = 0;
        let occupied = 0;
        let vacant = 0;
        let fullUnitCount = 0;
        let bedroomWiseCount = 0;
        
        const buildingStats = {};
        
        units.forEach(u => {
            const propName = u.property?.name || 'Other';
            if (!buildingStats[propName]) buildingStats[propName] = {
                total: 0,
                vacant: 0,
                occupied: 0,
                fullUnitVacant: 0,
                vacantBedrooms: 0,
                hasBedroomWise: false
            };
            
            buildingStats[propName].total++;
            total++;

            const isFullUnit = u.rentalMode === 'FULL_UNIT';

            if (isFullUnit) {
                fullUnitCount++;
                const activeLease = u.leases && u.leases.length > 0;
                const isReserved = u.reserved_flag;
                
                if (activeLease || isReserved) {
                    occupied++;
                    buildingStats[propName].occupied++;
                } else {
                    vacant++;
                    buildingStats[propName].vacant++;
                    buildingStats[propName].fullUnitVacant++;
                }
            } else {
                // BEDROOM_WISE
                bedroomWiseCount++;
                buildingStats[propName].hasBedroomWise = true;
                
                let unitIsFullyVacant = true;
                let unitIsFullyOccupied = true;
                
                if (!u.bedroomsList || u.bedroomsList.length === 0) {
                    vacant++;
                    buildingStats[propName].vacant++;
                } else {
                    u.bedroomsList.forEach(bedroom => {
                        const bLease = (bedroom.leases && bedroom.leases.length > 0) || (u.leases || []).find(l => l.bedroomId === bedroom.id);
                        if (bLease || bedroom.status === 'Occupied' || bedroom.reserved_flag) {
                            unitIsFullyVacant = false;
                        } else {
                            unitIsFullyOccupied = false;
                            totalVacantBedrooms++;
                            buildingStats[propName].vacantBedrooms++;
                        }
                    });
                    
                    if (unitIsFullyVacant) {
                        vacant++;
                        buildingStats[propName].vacant++;
                    } else {
                        occupied++; // Partially or fully occupied
                        buildingStats[propName].occupied++;
                    }
                }
            }
        });

        // NEW: Readiness Metrics for the Summary Boxes
        const readyForLeasing = units.filter(u => u.ready_for_leasing).length;
        const reservedUnits = units.filter(u => u.reserved_flag).length;
        
        const now = new Date().setHours(0,0,0,0);
        const overdueUnits = units.filter(u => {
            const milestones = [
                'gc_delivered', 'gc_deficiencies', 'gc_cleaned', 
                'ffe_installed', 'ose_installed', 'final_cleaning', 'unit_ready'
            ];
            return milestones.some(key => {
                const isCompleted = u[`${key}_completed`];
                const targetDateValue = u[`${key}_target_date`] ? new Date(u[`${key}_target_date`]).getTime() : null;
                return !isCompleted && targetDateValue && targetDateValue < now;
            });
        }).length;

        const vacancyByBuilding = Object.keys(buildingStats).map(p => ({
            name: p,
            vacant: buildingStats[p].vacant,
            occupied: buildingStats[p].occupied,
            total: buildingStats[p].total,
            vacantBedrooms: buildingStats[p].vacantBedrooms,
            hasBedroomWise: buildingStats[p].hasBedroomWise
        }));

        res.json({
            total,
            vacant,
            occupied,
            totalVacantBedrooms,
            fullUnitCount,
            bedroomWiseCount,
            vacancyByBuilding,
            // Readiness specifics
            totalUnits: total,
            readyForLeasing,
            reservedUnits,
            overdueUnits
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
