const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    try {
        const units = await prisma.unit.findMany({
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
                    totalMonthlyRent += parseFloat(activeLease.monthlyRent || 0);

                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property.name,
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: activeLease.tenant ? (activeLease.tenant.companyName || `${activeLease.tenant.firstName || ''} ${activeLease.tenant.lastName || ''}`.trim() || activeLease.tenant.name) : '-',
                        startDate: activeLease.startDate,
                        endDate: activeLease.endDate,
                        monthlyRent: activeLease.monthlyRent,
                        status: 'Occupied'
                    });
                } else {
                    vacantUnits++;
                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property.name,
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: '-',
                        startDate: null,
                        endDate: null,
                        monthlyRent: 0,
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
                        // POTENTIAL CRASH HERE
                        if (bedroom.status === 'Occupied') {
                            occupiedBedrooms++;
                            unitIsFullyVacant = false;

                            const bLease = u.leases.find(l => {
                                return l.bedroomId === bedroom.id || (l.tenant && l.tenant.bedroomId === bedroom.id);
                            });

                            if (bLease) {
                                totalMonthlyRent += parseFloat(bLease.monthlyRent || 0);
                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    buildingName: u.property.name,
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: bLease.tenant ? (bLease.tenant.companyName || `${bLease.tenant.firstName || ''} ${bLease.tenant.lastName || ''}`.trim() || bLease.tenant.name) : '-',
                                    startDate: bLease.startDate,
                                    endDate: bLease.endDate,
                                    monthlyRent: bLease.monthlyRent,
                                    status: 'Occupied'
                                });
                            } else {
                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    buildingName: u.property.name,
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
                                buildingName: u.property.name,
                                leaseType: 'Bedroom Lease',
                                unitNumber: u.unitNumber || u.name,
                                bedroomNumber: bedroom.bedroomNumber,
                                tenantName: '-',
                                startDate: null,
                                endDate: null,
                                monthlyRent: 0,
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

        console.log("Success: ", rentRollArray.length);
    } catch (e) {
        console.error("CRASH ERROR: ", e);
    } finally {
        await prisma.$disconnect();
    }
}

test();
