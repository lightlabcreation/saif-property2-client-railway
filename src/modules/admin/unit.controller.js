const prisma = require('../../config/prisma');
const { recalculateTimelineHelper } = require('./readiness.controller');
const workflowService = require('../../services/workflow.service');

// GET /api/admin/units
exports.getAllUnits = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const skip = (page - 1) * limit;

        const propertyId = (req.query.propertyId || req.query.building_id) ? parseInt(req.query.propertyId || req.query.building_id) : undefined;
        const rentalMode = req.query.rentalMode;
        const unitType = req.query.unitType;
        const search = req.query.search;

        const whereConditions = [];
        const tenantId = req.query.tenantId ? parseInt(req.query.tenantId) : undefined;
        
        // Step 1: Handle Construction Visibility
        // Include INACTIVE units if showInactive=true OR if we are doing a specific search
        if (req.query.showInactive !== 'true' && !search) {
            if (tenantId) {
                whereConditions.push({
                    OR: [
                        { unit_status: 'ACTIVE' },
                        { reserved_by_id: tenantId }
                    ]
                });
            } else {
                whereConditions.push({ unit_status: 'ACTIVE' });
            }
        }

        // Step 2: Handle Property/Search Filters
        if (propertyId && !isNaN(propertyId)) {
            whereConditions.push({ propertyId: propertyId });
        }
        if (rentalMode) whereConditions.push({ rentalMode: rentalMode });
        if (unitType) whereConditions.push({ unitType: unitType });

        // Step 3: Handle Availability Filter (Vacant/Reserved/Occupied)
        const statusFilter = req.query.status;
        if (statusFilter === 'Vacant') {
            // For leasing dropdown: Include Vacant OR Reserved (if they aren't fully booked yet)
            whereConditions.push({
                OR: [
                    { status: 'Vacant' },
                    { reserved_flag: true }
                ]
            });
        } else if (statusFilter) {
            whereConditions.push({ status: statusFilter });
        }

        if (search) {
            const parts = search.split('-').map(p => p.trim());
            const searchOR = [
                { unitNumber: { contains: search } },
                { property: { name: { contains: search } } },
                { property: { civicNumber: { contains: search } } }
            ];

            // If it looks like a combined identifier (e.g., "93-402")
            if (parts.length >= 2 && parts[0] && parts[1]) {
                searchOR.push({
                    AND: [
                        { property: { civicNumber: { contains: parts[0] } } },
                        { unitNumber: { contains: parts[1] } }
                    ]
                });
            }

            whereConditions.push({ OR: searchOR });
        }

        const where = whereConditions.length > 0 ? { AND: whereConditions } : {};
        console.log('[DEBUG] Unit Query Where:', JSON.stringify(where, null, 2));

        let units = [];
        let total = 0;

        try {
            // Main Query with Unit Status Isolation
            const [fetchedUnits, fetchedTotal] = await Promise.all([
                prisma.unit.findMany({
                    where,
                    include: {
                        property: true,
                        bedroomsList: true,
                        leases: {
                            where: { status: 'Active' },
                            include: { tenant: true }
                        }
                    },
                    skip,
                    take: limit,
                    orderBy: { createdAt: 'desc' }
                }),
                prisma.unit.count({ where })
            ]);
            units = fetchedUnits;
            total = fetchedTotal;
            console.log(`[DEBUG] Found ${units.length} units out of ${total}`);
        } catch (err) {
            console.error('Unit Query Error:', err.message);
            // Fallback: If unit_status column is totally missing or sync error
            const safeConditions = whereConditions.filter(cond => !cond.hasOwnProperty('unit_status'));
            const fallbackWhere = safeConditions.length > 0 ? { AND: safeConditions } : {};

            const [fallbackUnits, fallbackTotal] = await Promise.all([
                prisma.unit.findMany({
                    where: fallbackWhere,
                    include: {
                        property: true,
                        bedroomsList: true,
                        leases: {
                            where: { status: 'Active' },
                            include: { tenant: true }
                        }
                    },
                    skip,
                    take: limit,
                    orderBy: { createdAt: 'desc' }
                }),
                prisma.unit.count({ where: fallbackWhere })
            ]);
            units = fallbackUnits;
            total = fallbackTotal;
        }

        // Step 3: Format exactly as frontend expects
        const formatted = units.map(u => {
            const unitIdentifier = u.property.civicNumber && u.unitNumber
                ? `${u.property.civicNumber}-${u.unitNumber}`
                : u.unitNumber || u.name;

            let displayStatus = u.status;
            if (u.rentalMode === 'BEDROOM_WISE') {
                const totalRooms = u.bedroomsList.length;
                const occupiedRoomIds = new Set(u.leases.filter(l => l.status === 'Active' && l.bedroomId).map(l => l.bedroomId));
                const occupiedRooms = u.bedroomsList.filter(b => b.status === 'Occupied' || occupiedRoomIds.has(b.id)).length;
                displayStatus = totalRooms > 0 ? (occupiedRooms === totalRooms ? 'Fully Booked' : occupiedRooms > 0 ? 'Occupied' : 'Vacant') : 'Vacant';
            } else {
                displayStatus = u.status === 'Occupied' ? 'Occupied' : ((u.leases && u.leases.length > 0) ? 'Fully Booked' : 'Vacant');
            }

            return {
                id: u.id,
                unitNumber: u.unitNumber || u.name,
                unit_identifier: unitIdentifier,
                unitIdentifier: unitIdentifier,
                unitType: u.unitType,
                floor: u.floor,
                civicNumber: u.property.civicNumber,
                building: u.property.civicNumber || u.property.name,
                buildingName: u.property.name,
                status: displayStatus,
                unit_status: u.unit_status,
                bedrooms: u.bedrooms,
                rentalMode: u.rentalMode,
                activeLeaseCount: u.leases ? u.leases.length : 0,
                hasCompanyLease: u.leases ? u.leases.some(l => l.tenant.type === 'COMPANY') : false,
            };
        });

        res.json({
            status: 'success',
            data: formatted,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Final Controller Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/units
exports.createUnit = async (req, res) => {
    try {
        console.log('CREATE UNIT REQUEST:', req.body);
        const { unit: unitName, propertyId, rentalMode, unitNumber, unitType, floor, bedrooms: bedroomCount, bedroomIdentifiers, classification } = req.body;
        if (!propertyId) return res.status(400).json({ message: 'Property (Building) is required' });
        
        const finalPropertyId = parseInt(propertyId);
        const property = await prisma.property.findUnique({ where: { id: finalPropertyId } });
        if (!property) return res.status(404).json({ message: 'Property not found' });

        let normalizedMode = (rentalMode === 'BEDROOM_WISE' || rentalMode === '3') ? 'BEDROOM_WISE' : 'FULL_UNIT';
        const numBedrooms = parseInt(bedroomCount) || (normalizedMode === 'BEDROOM_WISE' ? 3 : 1);

        let resUserId = req.body.reserved_by_id ? parseInt(req.body.reserved_by_id) : null;

        // Phase 2: Quick Reservation Logic (Find or Create User)
        if (req.body.reserved_flag && req.body.reserve_email) {
            const { reserve_firstName, reserve_lastName, reserve_email, reserve_phone } = req.body;
            const email = reserve_email.toLowerCase().trim();
            
            let targetUser = await prisma.user.findUnique({ where: { email } });
            
            if (targetUser) {
                resUserId = targetUser.id;
                // Update basic info if missing
                await prisma.user.update({
                    where: { id: targetUser.id },
                    data: {
                        name: `${reserve_firstName} ${reserve_lastName}`.trim(),
                        firstName: reserve_firstName,
                        lastName: reserve_lastName,
                        phone: reserve_phone || targetUser.phone
                    }
                });
            } else {
                const newUser = await prisma.user.create({
                    data: {
                        email,
                        name: `${reserve_firstName} ${reserve_lastName}`.trim(),
                        firstName: reserve_firstName,
                        lastName: reserve_lastName,
                        phone: reserve_phone || null,
                        role: 'TENANT',
                        type: 'INDIVIDUAL'
                    }
                });
                resUserId = newUser.id;
            }
        }

        const newUnit = await prisma.unit.create({
            data: {
                name: unitName || unitNumber,
                unitNumber: unitNumber || unitName,
                unitType: unitType || null,
                floor: floor ? parseInt(floor) : null,
                propertyId: finalPropertyId,
                status: 'Vacant',
                classification: classification || 'Completed',
                unit_type: classification === 'New Construction' ? 'NEW_CONSTRUCTION' : 'COMPLETED',
                unit_status: classification === 'New Construction' ? 'INACTIVE' : 'ACTIVE',
                availability_status: classification === 'New Construction' ? 'Unavailable' : 'Available',
                rentalMode: normalizedMode,
                bedrooms: numBedrooms,
                rentAmount: 0,
                // readiness fields
                gc_delivered_target_date: req.body.gc_delivered_target_date ? workflowService.normalizeToNoon(req.body.gc_delivered_target_date) : null,
                reserved_flag: req.body.reserved_flag || false,
                reserved_by_id: resUserId,
                reservation_date: req.body.reserved_flag ? new Date() : null,
                tentative_move_in_date: req.body.tentative_move_in_date ? workflowService.normalizeToNoon(req.body.tentative_move_in_date) : null,
                ...(req.body.gc_delivered_target_date ? await recalculateTimelineHelper(req.body.gc_delivered_target_date) : {})
            },
            include: { property: true }
        });

        if (numBedrooms > 0) {
            const civic = newUnit.property.civicNumber || '';
            const uNum = newUnit.unitNumber || newUnit.name;
            const bedroomsToCreate = Array.from({ length: numBedrooms }).map((_, i) => ({
                bedroomNumber: (bedroomIdentifiers && bedroomIdentifiers[i]) ? bedroomIdentifiers[i] : `${civic}-${uNum}-${i+1}`,
                roomNumber: i + 1,
                unitId: newUnit.id,
                status: 'Vacant',
                rentAmount: 0
            }));
            await prisma.bedroom.createMany({ data: bedroomsToCreate });
        }

        // --- NEW: Sync Move-In Dashboard ---
        if (newUnit.reserved_flag || newUnit.unit_status === 'ACTIVE') {
            await workflowService.syncMoveInStatus(newUnit.id, {
                targetDate: newUnit.tentative_move_in_date
            });
        }

        res.status(201).json(newUnit);
    } catch (error) {
        console.error('Create Unit Error:', error);
        res.status(500).json({ message: 'Error creating unit' });
    }
};

// GET /api/admin/units/:id
exports.getUnitDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const unit = await prisma.unit.findUnique({
            where: { id: parseInt(id) },
            include: {
                property: true,
                leases: { include: { tenant: true }, orderBy: { startDate: 'desc' } },
                bedroomsList: { orderBy: { roomNumber: 'asc' } },
                reserved_by_user: true
            }
        });

        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        const occupants = await prisma.user.findMany({
            where: {
                OR: [{ unitId: unit.id }, { bedroomId: { in: unit.bedroomsList.map(b => b.id) } }],
                type: 'RESIDENT'
            },
            select: { id: true, name: true, firstName: true, email: true, phone: true, bedroomId: true }
        });

        const activeLease = unit.leases.find(l => l.status === 'Active');
        res.json({
            ...unit,
            activeLease: activeLease ? { tenantName: activeLease.tenant.name, startDate: activeLease.startDate, endDate: activeLease.endDate, amount: activeLease.monthlyRent } : null,
            occupants: occupants || []
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/admin/units/:id
exports.updateUnit = async (req, res) => {
    try {
        const { id } = req.params;
        const unitId = parseInt(id);
        const { unitNumber, unitType, floor, bedrooms, rentalMode, status, propertyId, bedroomId } = req.body;

        // --- Step 1: Hard Reservation Lock Logic (Duplicate / Occupancy Check) ---
        if (req.body.reserved_flag === true) {
            if (bedroomId) {
                const bId = parseInt(bedroomId);
                // Check for active lease
                const activeLease = await prisma.lease.findFirst({
                    where: { bedroomId: bId, status: 'Active' }
                });
                if (activeLease) {
                    return res.status(400).json({ message: 'HARD LOCK: Cannot reserve this bedroom because it has an active lease.' });
                }
                // Removed self-blocking existingRes check to allow updates
            } else {
                // Unit-level check
                const activeLease = await prisma.lease.findFirst({
                    where: { unitId: unitId, status: 'Active' }
                });
                if (activeLease) {
                    return res.status(400).json({ 
                        message: 'HARD LOCK: Cannot reserve this unit because it currently has an active lease. Please end the active lease before reserving.' 
                    });
                }
                // Removed self-blocking existingRes check to allow updates
            }
        }

        let resUserId = req.body.reserved_by_id !== undefined ? (req.body.reserved_by_id ? parseInt(req.body.reserved_by_id) : null) : undefined;

        // --- Step 2: Quick Reservation Logic (Find or Create User) ---
        if (req.body.reserved_flag && req.body.reserve_email) {
            const { reserve_firstName, reserve_lastName, reserve_email, reserve_phone } = req.body;
            const email = reserve_email.toLowerCase().trim();
            
            let targetUser = await prisma.user.findUnique({ where: { email } });
            
            if (targetUser) {
                resUserId = targetUser.id;
                await prisma.user.update({
                    where: { id: targetUser.id },
                    data: {
                        name: `${reserve_firstName} ${reserve_lastName}`.trim(),
                        firstName: reserve_firstName,
                        lastName: reserve_lastName,
                        phone: reserve_phone || targetUser.phone
                    }
                });
            } else {
                const newUser = await prisma.user.create({
                    data: {
                        email,
                        name: `${reserve_firstName} ${reserve_lastName}`.trim(),
                        firstName: reserve_firstName,
                        lastName: reserve_lastName,
                        phone: reserve_phone || null,
                        role: 'TENANT',
                        type: 'INDIVIDUAL'
                    }
                });
                resUserId = newUser.id;
            }
        }
        
        // --- Step 3: Performance Update (Bedroom vs Unit) ---
        if (bedroomId) {
            const bId = parseInt(bedroomId);
            const updatedBedroom = await prisma.bedroom.update({
                where: { id: bId },
                data: {
                    reserved_flag: req.body.reserved_flag,
                    reserved_by_id: resUserId,
                    reservation_date: req.body.reserved_flag ? new Date() : null,
                    tentative_move_in_date: req.body.tentative_move_in_date ? new Date(req.body.tentative_move_in_date) : null
                }
            });

            // --- NEW: Sync Move-In Dashboard ---
            if (req.body.reserved_flag) {
                await workflowService.syncMoveInStatus(updatedBedroom.unitId, {
                    bedroomId: bId,
                    targetDate: updatedBedroom.tentative_move_in_date
                });
            }

            return res.json(updatedBedroom);
        }

        const updatedUnit = await prisma.unit.update({
            where: { id: unitId },
            data: {
                unitNumber,
                unitType,
                floor: floor ? parseInt(floor) : undefined,
                bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
                rentalMode,
                status,
                property: propertyId ? { connect: { id: parseInt(propertyId) } } : undefined,
                gc_delivered_target_date: req.body.gc_delivered_target_date ? workflowService.normalizeToNoon(req.body.gc_delivered_target_date) : undefined,
                reserved_flag: req.body.reserved_flag !== undefined ? req.body.reserved_flag : undefined,
                reserved_by_user: resUserId !== undefined ? (resUserId ? { connect: { id: resUserId } } : { disconnect: true }) : undefined,
                reservation_date: req.body.reservation_date ? new Date(req.body.reservation_date) : undefined,
                tentative_move_in_date: req.body.tentative_move_in_date ? workflowService.normalizeToNoon(req.body.tentative_move_in_date) : undefined,
                unit_status: req.body.unit_status,
                availability_status: req.body.availability_status,
                ...(req.body.gc_delivered_target_date ? await recalculateTimelineHelper(req.body.gc_delivered_target_date) : {})
            }
        });

        // --- NEW: Sync Move-In Dashboard ---
        if (req.body.reserved_flag) {
            await workflowService.syncMoveInStatus(unitId, {
                targetDate: updatedUnit.tentative_move_in_date
            });
        }

        res.json(updatedUnit);
    } catch (error) {
        console.error('Update Unit Error:', error);
        res.status(500).json({ message: 'Error updating unit' });
    }
};

// GET /api/admin/unit-types
exports.getUnitTypes = async (req, res) => {
    try {
        const unitTypes = await prisma.unitTypeRate.findMany({ orderBy: { typeName: 'asc' } });
        res.json({ unitTypes: unitTypes.map(t => ({ id: t.id, name: t.typeName, isActive: true })) });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/units/:id
exports.deleteUnit = async (req, res) => {
    try {
        const { id } = req.params;
        const unitId = parseInt(id);

        if (isNaN(unitId)) {
            return res.status(400).json({ message: 'Invalid unit ID' });
        }

        console.log(`[deleteUnit] Initiating robust deletion for Unit ID: ${unitId}`);

        // Scoping related entities
        const bedrooms = await prisma.bedroom.findMany({ where: { unitId }, select: { id: true } });
        const bedroomIds = bedrooms.map(b => b.id);

        const leases = await prisma.lease.findMany({ where: { unitId }, select: { id: true } });
        const leaseIds = leases.map(l => l.id);

        const invoices = await prisma.invoice.findMany({ 
            where: { OR: [{ unitId }, { leaseId: { in: leaseIds } }] }, 
            select: { id: true } 
        });
        const invoiceIds = invoices.map(i => i.id);

        const payments = await prisma.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
        const paymentIds = payments.map(p => p.id);

        await prisma.$transaction(async (tx) => {
            // A. Cleanup Transactions (Must be first)
            await tx.transaction.deleteMany({
                where: { OR: [{ invoiceId: { in: invoiceIds } }, { paymentId: { in: paymentIds } }] }
            });

            // A2. Cleanup Invoice Line Items (Prevents FK error deleting Invoices)
            await tx.invoiceLineItem.deleteMany({
                where: { invoiceId: { in: invoiceIds } }
            });

            // B. Cleanup Payments
            await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });

            // C. Insurance
            await tx.insurance.deleteMany({ where: { OR: [{ unitId }, { leaseId: { in: leaseIds } }] } });

            // D1. Cleanup Document Links (Prevents FK error deleting Documents)
            const docs = await tx.document.findMany({ 
                where: { OR: [{ unitId }, { leaseId: { in: leaseIds } }, { invoiceId: { in: invoiceIds } }] },
                select: { id: true }
            });
            const docIds = docs.map(d => d.id);
            await tx.documentLink.deleteMany({ where: { documentId: { in: docIds } } });

            // D2. Documents
            await tx.document.deleteMany({ where: { id: { in: docIds } } });

            // E. Ticketing
            await tx.ticket.deleteMany({ where: { unitId } });

            // F. Refund Adjustments
            await tx.refundAdjustment.deleteMany({ where: { unitId } });

            // G. Invoices
            await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });

            // H. Unlink Users
            await tx.user.updateMany({ where: { unitId: unitId }, data: { unitId: null } });
            await tx.user.updateMany({ where: { leaseId: { in: leaseIds } }, data: { leaseId: null } });
            await tx.user.updateMany({ where: { bedroomId: { in: bedroomIds } }, data: { bedroomId: null } });
            // Also clear reservation link
            await tx.unit.update({
                where: { id: unitId },
                data: { reserved_by_id: null }
            });

            // I. Leases & Bedrooms
            await tx.lease.deleteMany({ where: { id: { in: leaseIds } } });
            await tx.bedroom.deleteMany({ where: { id: { in: bedroomIds } } });

            // J. Finally, the Unit
            await tx.unit.delete({ where: { id: unitId } });
        });

        console.log(`[deleteUnit] Successfully deleted unit ${unitId}.`);
        res.json({ message: 'Unit and all related data deleted successfully' });
    } catch (error) {
        console.error('Delete Unit Error:', error);
        res.status(500).json({ message: 'Error deleting unit', error: error.message });
    }
};

// POST /api/admin/unit-types
exports.createUnitType = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });
        const newType = await prisma.unitTypeRate.create({
            data: { typeName: name, fullUnitRate: 0, singleBedroomRate: 0 }
        });
        res.status(201).json(newType);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/unit-types/:id
exports.deleteUnitType = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.unitTypeRate.delete({ where: { id: parseInt(id) } });
        res.json({ message: 'Unit Type deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/units/dropdown
exports.getUnitDropdown = async (req, res) => {
    try {
        const units = await prisma.unit.findMany({
            where: {
                OR: [
                    { status: 'Vacant' },
                    { reserved_flag: true },
                    { unit_status: 'ACTIVE' }
                ]
            },
            include: { property: true },
            orderBy: { unitNumber: 'asc' }
        });

        const formatted = units.map(u => ({
            value: u.id,
            label: `${u.property.name} - ${u.unitNumber}`,
            propertyId: u.propertyId
        }));

        res.json(formatted);
    } catch (error) {
        console.error('getUnitDropdown Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/units/bedrooms/vacant
exports.getVacantBedrooms = async (req, res) => {
    try {
        const propertyId = req.query.propertyId ? parseInt(req.query.propertyId) : undefined;
        const tenantId = req.query.tenantId ? parseInt(req.query.tenantId) : undefined;
        const unitId = req.query.unitId ? parseInt(req.query.unitId) : undefined;

        const vacantBedrooms = await prisma.bedroom.findMany({
            where: {
                OR: [
                    { status: 'Vacant' },
                    { reserved_flag: true }
                ],
                unitId: unitId || undefined,
                unit: propertyId ? { propertyId } : undefined
            },
            include: { unit: { include: { property: true } } }
        });
        
        res.json(vacantBedrooms.map(b => ({
            id: b.id,
            bedroomNumber: b.bedroomNumber,
            roomNumber: b.roomNumber,
            displayName: `${b.unit.property.name}-${b.unit.unitNumber}-${b.roomNumber}`
        })));
    } catch (error) {
        console.error('getVacantBedrooms Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
