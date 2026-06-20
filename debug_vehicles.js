const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugVehicles() {
    try {
        const vehicles = await prisma.vehicle.findMany({
            include: { lease: true }
        });

        console.log(`--- Total Vehicles: ${vehicles.length} ---`);
        
        vehicles.forEach((v, index) => {
            console.log(`\n[Vehicle #${index + 1}]`);
            console.log(`ID: ${v.id}`);
            console.log(`Make/Model: ${v.make} ${v.model}`);
            console.log(`Plate: ${v.licensePlate}`);
            console.log(`Lease ID on Vehicle: ${v.leaseId}`);
            
            if (v.lease) {
                console.log(`Lease Status: ${v.lease.status}`);
                console.log(`Lease EndDate: ${v.lease.endDate}`);
                const isExpired = v.lease.endDate && new Date(v.lease.endDate) < new Date();
                console.log(`Is Expired: ${isExpired}`);
            } else {
                console.log(`Lease connected: NONE (This marks it Unauthorized immediately!)`);
            }
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debugVehicles();
