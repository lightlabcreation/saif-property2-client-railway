const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function repairInsuranceData() {
    try {
        console.log('Searching for Insurance records with null uploadedDocumentId...');
        const list = await prisma.insurance.findMany({
            where: { uploadedDocumentId: null }
        });

        console.log(`Found ${list.length} records needing repair.`);

        for (const ins of list) {
            console.log(`Processing Insurance ID: ${ins.id}, URL: ${ins.documentUrl}`);
            if (!ins.documentUrl) continue;

            // Search for a Document record created by this user with the same URL
            let doc = await prisma.document.findFirst({
                where: {
                    fileUrl: ins.documentUrl
                }
            });

            if (!doc) {
                console.log(`No existing Document found for URL. Creating one for User: ${ins.userId}...`);
                doc = await prisma.document.create({
                    data: {
                        userId: ins.userId,
                        name: 'Insurance_Document_' + ins.policyNumber,
                        type: 'Insurance',
                        fileUrl: ins.documentUrl,
                        leaseId: ins.leaseId || null,
                        unitId: ins.unitId || null
                    }
                });
                console.log(`Created Document with ID: ${doc.id}`);
            } else {
                console.log(`Found matching Document ID: ${doc.id}`);
            }

            // Update Insurance to link to this document
            await prisma.insurance.update({
                where: { id: ins.id },
                data: { uploadedDocumentId: doc.id }
            });
            console.log(`Updated Insurance ID ${ins.id} with uploadedDocumentId = ${doc.id}`);
        }
        
        console.log('Repair Complete!');
    } catch (e) {
        console.error('Error during repair:', e);
    } finally {
        await prisma.$disconnect();
    }
}

repairInsuranceData();
