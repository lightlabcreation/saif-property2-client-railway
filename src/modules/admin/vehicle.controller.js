const prisma = require('../../config/prisma');
const { uploadToCloudinary } = require('../../config/cloudinary');

// GET /api/admin/vehicles
exports.getAllVehicles = async (req, res) => {
    try {
        const { search, buildingId, unauthorizedOnly } = req.query;

        const where = {};
        if (buildingId) {
            where.lease = {
                unit: {
                    propertyId: parseInt(buildingId)
                }
            };
        }

        if (search) {
            where.OR = [
                { licensePlate: { contains: search } },
                { make: { contains: search } },
                { model: { contains: search } },
                { tenant: { name: { contains: search } } }
            ];
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Fetch all matching for calculation-based filtering
        const allVehicles = await prisma.vehicle.findMany({
            where,
            include: {
                tenant: {
                    include: {
                        leases: {
                            where: { status: 'Active' },
                            include: {
                                unit: {
                                    include: { property: true }
                                }
                            },
                            take: 1
                        },
                        residentLease: {
                            include: {
                                unit: {
                                    include: { property: true }
                                }
                            }
                        },
                        parent: {
                            include: {
                                leases: {
                                    where: { status: 'Active' },
                                    include: {
                                        unit: {
                                            include: { property: true }
                                        }
                                    },
                                    take: 1
                                }
                            }
                        }
                    }
                },
                lease: {
                    include: {
                        unit: {
                            include: {
                                property: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const now = new Date();

        // Collect all unique tenant IDs to check for resident-of-lease membership
        const tenantIds = [...new Set(allVehicles.map(v => v.tenantId))];

        // Find all active leases where these tenants appear as additional residents
        // (i.e. listed in the Lease.residents[] many-to-one via leaseId FK on User)
        // We query Lease where its residents include any of these tenants AND lease is active
        const residentLeaseMap = {};
        if (tenantIds.length > 0) {
            const residentLeases = await prisma.lease.findMany({
                where: {
                    status: 'Active',
                    residents: {
                        some: {
                            id: { in: tenantIds }
                        }
                    }
                },
                include: {
                    residents: { select: { id: true } },
                    unit: { include: { property: true } }
                }
            });

            // Build a map: tenantId -> active lease (as a resident)
            for (const lease of residentLeases) {
                for (const resident of lease.residents) {
                    if (!residentLeaseMap[resident.id]) {
                        residentLeaseMap[resident.id] = lease;
                    }
                }
            }
        }

        let formatted = allVehicles.map(v => {
            // Check all possible lease sources in priority order:
            // 1. Direct vehicle lease link
            // 2. Tenant's own primary active lease (as tenantId)
            // 3. Tenant's residentLease (via leaseId FK on User - single resident slot)
            // 4. Any active lease where this tenant is listed as an additional occupant/roommate
            // 5. Tenant's parent's active lease (if they are a sub-tenant/resident under a parent)
            const lease = v.lease 
                || (v.tenant.leases && v.tenant.leases[0]) 
                || v.tenant.residentLease 
                || residentLeaseMap[v.tenantId]
                || (v.tenant.parent && v.tenant.parent.leases && v.tenant.parent.leases[0]);

            const isActiveLease = lease && lease.status === 'Active' && 
                                (!lease.endDate || new Date(lease.endDate) >= now);
            
            return {
                id: v.id,
                tenantName: v.tenant.name || `${v.tenant.firstName} ${v.tenant.lastName}`,
                tenantId: v.tenantId,
                tenantPhone: v.tenant.phone || 'N/A',
                buildingName: lease?.unit?.property?.name || 'N/A',
                unitNumber: lease?.unit?.unitNumber || lease?.unit?.name || 'N/A',
                make: v.make,
                model: v.model,
                color: v.color,
                licensePlate: v.licensePlate,
                parkingSpace: v.parkingSpace,
                photo1Url: v.photo1Url,
                photo2Url: v.photo2Url,
                leaseStatus: lease?.status || 'No Lease',
                isAuthorized: !!isActiveLease,
                leaseExpiry: lease?.endDate ? lease.endDate.toISOString().split('T')[0] : 'N/A'
            };
        });

        if (unauthorizedOnly === 'unauthorized') {
            formatted = formatted.filter(v => !v.isAuthorized);
        }

        const total = formatted.length;
        const paginatedData = formatted.slice(skip, skip + limit);

        res.json({
            data: paginatedData,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        console.error('Error fetching vehicles:', e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/vehicles/:id
exports.getVehicleById = async (req, res) => {
    try {
        const { id } = req.params;
        const vehicle = await prisma.vehicle.findUnique({
            where: { id: parseInt(id) },
            include: {
                tenant: true,
                lease: {
                    include: {
                        unit: {
                            include: {
                                property: true
                            }
                        }
                    }
                }
            }
        });

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        res.json(vehicle);
    } catch (e) {
        console.error('Error fetching vehicle:', e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/vehicles
exports.createVehicle = async (req, res) => {
    try {
        const { tenantId, leaseId, make, model, color, licensePlate, parkingSpace } = req.body;

        let photo1Url = null;
        let photo2Url = null;

        // Handle Image uploads
        if (req.files) {
            if (req.files.photo1) {
                const result = await uploadToCloudinary(req.files.photo1.tempFilePath, 'vehicles/photos');
                photo1Url = result.secure_url;
            }
            if (req.files.photo2) {
                const result = await uploadToCloudinary(req.files.photo2.tempFilePath, 'vehicles/photos');
                photo2Url = result.secure_url;
            }
        }

        const newVehicle = await prisma.vehicle.create({
            data: {
                tenantId: parseInt(tenantId),
                leaseId: leaseId ? parseInt(leaseId) : null,
                make,
                model,
                color,
                licensePlate,
                parkingSpace,
                photo1Url,
                photo2Url
            }
        });

        res.status(201).json(newVehicle);
    } catch (e) {
        console.error('Error creating vehicle:', e);
        if (e.code === 'P2002') {
            return res.status(400).json({ message: 'License plate already exists' });
        }
        res.status(500).json({ message: 'Error creating vehicle' });
    }
};

// PUT /api/admin/vehicles/:id
exports.updateVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        const { tenantId, leaseId, make, model, color, licensePlate, parkingSpace } = req.body;

        const updateData = {
            tenantId: tenantId ? parseInt(tenantId) : undefined,
            leaseId: leaseId ? parseInt(leaseId) : undefined,
            make,
            model,
            color,
            licensePlate,
            parkingSpace
        };

        // Handle new images
        if (req.files) {
            if (req.files.photo1) {
                const result = await uploadToCloudinary(req.files.photo1.tempFilePath, 'vehicles/photos');
                updateData.photo1Url = result.secure_url;
            }
            if (req.files.photo2) {
                const result = await uploadToCloudinary(req.files.photo2.tempFilePath, 'vehicles/photos');
                updateData.photo2Url = result.secure_url;
            }
        }

        const updated = await prisma.vehicle.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        res.json(updated);
    } catch (e) {
        console.error('Error updating vehicle:', e);
        res.status(500).json({ message: 'Error updating vehicle' });
    }
};

// DELETE /api/admin/vehicles/:id
exports.deleteVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.vehicle.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Vehicle deleted' });
    } catch (e) {
        console.error('Error deleting vehicle:', e);
        res.status(500).json({ message: 'Error deleting vehicle' });
    }
};
