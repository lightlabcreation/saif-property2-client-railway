const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOwnerAndProperties() {
    try {
        console.log("--- Checking Admin User ---");
        const adminUser = await prisma.user.findFirst({
            where: { email: 'admin@admin.com' } // Assuming this is the admin
        });
        console.log("Admin User:", adminUser ? adminUser.email : "Not found");

        console.log("\n--- Checking 'Property Owner' (from screenshot) ---");
        const owner = await prisma.user.findFirst({
            where: { email: 'owner@property.com' },
            include: {
                companyContacts: true,
            }
        });

        if (!owner) {
            console.log("Owner 'owner@property.com' not found.");
        } else {
            console.log(`Owner Found: ID=${owner.id}, Name=${owner.name}, CompanyID=${owner.companyId}, Role=${owner.role}`);

            console.log("\n--- Properties assigned to this Owner ID directly ---");
            const propertiesDirect = await prisma.property.findMany({
                where: { ownerId: owner.id }
            });
            console.log(`Count: ${propertiesDirect.length}`);
            propertiesDirect.forEach(p => console.log(` - Property: ${p.id} - ${p.name}`));

            if (owner.companyId) {
                console.log(`\n--- Properties assigned to Company ID ${owner.companyId} ---`);
                const propertiesCompany = await prisma.property.findMany({
                    where: { companyId: owner.companyId }
                });
                console.log(`Count: ${propertiesCompany.length}`);
                propertiesCompany.forEach(p => console.log(` - Property: ${p.id} - ${p.name}`));
            }
        }

        console.log("\n--- Recent Properties ---");
        const recentProps = await prisma.property.findMany({
            take: 5,
            orderBy: { updatedAt: 'desc' },
            select: { id: true, name: true, ownerId: true, companyId: true }
        });
        recentProps.forEach(p => console.log(` - ${p.name} (ID: ${p.id}) -> OwnerID: ${p.ownerId}, CompanyID: ${p.companyId}`));


    } catch (error) {
        console.error("Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

checkOwnerAndProperties();
