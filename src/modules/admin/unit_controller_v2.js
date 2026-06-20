const prisma = require('../../config/prisma');

// GET /api/admin/units
exports.getAllUnits = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const propertyId = (req.query.propertyId || req.query.building_id) ? parseInt(req.query.propertyId || req.query.building_id) : undefined;
        const rentalMode = req.query.rentalMode;
        const unitType = req.query.unitType;
        const search = req.query.search;

        const where = {};
        
        // If NOT showing inactive, filter to only show leasable units
        if (req.query.showInactive !== 'true') {
            where.OR = [
                { unit_status: 'ACTIVE' },
                { unit_status: null } // Important for legacy units
            ];
        }

        if (propertyId && propertyId !== 'null' && !isNaN(propertyId)) {
            where.propertyId = propertyId;
        }
        if (rentalMode) where.rentalMode = rentalMode;
        if (unitType) where.unitType = unitType;

        if (search) {
            where.OR = [
                { unitNumber: { contains: search, mode: 'insensitive' } },
                { property: { name: { contains: search, mode: 'insensitive' } } },
                { property: { civicNumber: { contains: search, mode: 'insensitive' } } }
            ];
        }

        let units, total;

        try {
            // Main Query with new fields
            [units, total] = await Promise.all([
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
        } catch (err) {
            console.error('New schema query failed, falling back to basic query:', err.message);
            // Fallback: If unit_status column is totally missing from index, run without it
            const fallbackWhere = { ...where };
            delete fallbackWhere.OR;
            delete fallbackWhere.unit_status;

            [units, total] = await Promise.all([
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
        }

        const formatted = units.map(u => {
            const unitIdentifier = u.property.civicNumber && u.unitNumber
                ? `${u.property.civicNumber}-${u.unitNumber}`
                : u.unitNumber || u.name;

            let displayStatus = u.status;
            if (u.rentalMode === 'BEDROOM_WISE') {
                const totalRooms = u.bedroomsList.length;
                const occupiedRoomIds = new Set(u.leases.filter(l => l.bedroomId).map(l => l.bedroomId));
                const occupiedRooms = u.bedroomsList.filter(b => b.status === 'Occupied' || occupiedRoomIds.has(b.id)).length;

                if (totalRooms > 0) {
                    displayStatus = occupiedRooms === totalRooms ? 'Fully Booked' : occupiedRooms > 0 ? 'Occupied' : 'Vacant';
                }
            } else {
                displayStatus = (u.leases && u.leases.length > 0) ? 'Fully Booked' : 'Vacant';
            }

            return {
                id: u.id,
                unitNumber: u.unitNumber || u.name,
                unitIdentifier,
                unitType: u.unitType,
                floor: u.floor,
                buildingName: u.property.name,
                building: u.property.civicNumber || u.property.name,
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
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
