const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all lockers for the active property/company
exports.getLockers = async (req, res) => {
    try {
        const lockers = await prisma.locker.findMany({
            include: {
                property: {
                    select: {
                        name: true,
                    }
                },
                rentals: {
                    include: {
                        lease: {
                            include: {
                                tenant: {
                                    select: {
                                        firstName: true,
                                        lastName: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: [
                { buildingId: 'asc' },
                { lockerNumber: 'asc' }
            ]
        });

        const today = new Date();
        
        // Dynamically compute status
        const formattedLockers = lockers.map(locker => {
            let isOccupied = false;
            let currentTenant = null;
            let currentRent = 0;
            let currentEndDate = null;

            if (locker.rentals && locker.rentals.length > 0) {
                // Check if today falls between any rental start and end date
                for (const rental of locker.rentals) {
                    const start = new Date(rental.startDate);
                    const end = new Date(rental.endDate);
                    
                    // Normalize times for date comparison
                    start.setHours(0,0,0,0);
                    end.setHours(23,59,59,999);
                    
                    if (today >= start && today <= end) {
                        isOccupied = true;
                        currentTenant = rental.lease?.tenant ? `${rental.lease.tenant.firstName} ${rental.lease.tenant.lastName}` : 'Unknown';
                        currentRent = rental.rentAmount;
                        currentEndDate = rental.endDate;
                        break;
                    }
                }
            }

            return {
                ...locker,
                status: isOccupied ? 'Occupied' : 'Available',
                currentTenant,
                currentRent,
                currentEndDate
            };
        });

        res.status(200).json(formattedLockers);
    } catch (error) {
        console.error("Error fetching lockers:", error);
        res.status(500).json({ error: "Failed to fetch lockers" });
    }
};

exports.createLocker = async (req, res) => {
    try {
        const { buildingId, lockerNumber } = req.body;
        
        if (!buildingId || !lockerNumber) {
            return res.status(400).json({ error: "buildingId and lockerNumber are required" });
        }

        // Check for duplicates
        const existing = await prisma.locker.findUnique({
            where: {
                buildingId_lockerNumber: {
                    buildingId: parseInt(buildingId),
                    lockerNumber
                }
            }
        });

        if (existing) {
            return res.status(400).json({ error: "A locker with this number already exists in the selected building." });
        }

        const locker = await prisma.locker.create({
            data: {
                buildingId: parseInt(buildingId),
                lockerNumber,
                status: 'Available' // Base status, dynamically overridden on fetch
            },
            include: {
                property: true
            }
        });

        res.status(201).json(locker);
    } catch (error) {
        console.error("Error creating locker:", error);
        res.status(500).json({ error: "Failed to create locker" });
    }
};

exports.updateLocker = async (req, res) => {
    try {
        const { id } = req.params;
        const { buildingId, lockerNumber } = req.body;

        const locker = await prisma.locker.update({
            where: { id: parseInt(id) },
            data: {
                ...(buildingId && { buildingId: parseInt(buildingId) }),
                ...(lockerNumber && { lockerNumber })
            }
        });

        res.status(200).json(locker);
    } catch (error) {
        console.error("Error updating locker:", error);
        res.status(500).json({ error: "Failed to update locker" });
    }
};

exports.deleteLocker = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if locker has any rentals
        const rentals = await prisma.lockerRental.count({
            where: { lockerId: parseInt(id) }
        });

        if (rentals > 0) {
            return res.status(400).json({ error: "Cannot delete a locker that has been rented. Please remove the rentals first." });
        }

        await prisma.locker.delete({
            where: { id: parseInt(id) }
        });

        res.status(200).json({ message: "Locker deleted successfully" });
    } catch (error) {
        console.error("Error deleting locker:", error);
        res.status(500).json({ error: "Failed to delete locker" });
    }
};
