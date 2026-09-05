const prisma = require('../config/prisma');
const documentProcessor = require('./documentProcessor.service');
require('dotenv').config();

async function syncOldDocuments() {
  console.log('Starting Qdrant historical document sync...');
  
  try {
    // Get all documents from the database
    const documents = await prisma.document.findMany({
      where: {
        fileUrl: {
          contains: '.pdf'
        }
      },
      include: {
        unit: true
      }
    });

    console.log(`Found ${documents.length} historical PDF documents to process.`);

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      console.log(`Processing ${i + 1}/${documents.length}: ${doc.name}`);
      
      const propertyId = doc.propertyId || (doc.unit ? doc.unit.propertyId : null);
      
      if (propertyId && doc.fileUrl.startsWith('http')) {
        try {
          await documentProcessor.processAndSave(doc.fileUrl, propertyId, doc.type || 'historical');
        } catch (err) {
          console.error(`Failed to process document ${doc.id}:`, err.message);
        }
      } else {
        console.log(`Skipping document ${doc.id} - missing propertyId or not a remote URL.`);
      }
      
      // Delay to avoid hitting API rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('Sync complete!');
  } catch (error) {
    console.error('Fatal error during sync:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

// Do not execute automatically unless explicitly run via CLI
if (require.main === module) {
  syncOldDocuments();
}
