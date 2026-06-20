const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listAllOwners() {
    try {
        console.log("--- Listing All Users with Role OWNER ---");
        const owners = await prisma.user.findMany({
            where: { role: 'OWNER' },
            include: {
                properties: true, // This uses the 'OwnerProperties' relation
                company: {
                    include: { properties: true } // Properties via company
                }
            }
        });

        console.log(`Found ${owners.length} owners.`);
        owners.forEach(o => {
            console.log(`\nOwner: ${o.name} (${o.email}) - ID: ${o.id}`);

            const directProps = o.properties.map(p => p.name).join(", ");
            console.log(`  Direct Properties (${o.properties.length}): ${directProps}`);

            if (o.company) {
                const companyProps = o.company.properties.map(p => p.name).join(", ");
                console.log(`  Company Properties (${o.company.properties.length}): ${companyProps}`);
            } else {
                console.log(`  No Company assigned.`);
            }
        });

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

listAllOwners();
