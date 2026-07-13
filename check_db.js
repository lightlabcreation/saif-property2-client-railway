const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://root:iaNGRpTFZqOBMuuhicnPBXdmLwdmbaLn@yamabiko.proxy.rlwy.net:18357/railway"
    }
  }
});

async function checkData() {
    try {
        console.log('Connecting to Railway DB...');
        const refund = await prisma.refundAdjustment.findUnique({
            where: { requestId: 'RA-00040' }
        });
        
        if (refund) {
            console.log('✅ SUCCESS: Found RA-00040 in this database!');
            console.log(refund);
        } else {
            console.log('❌ NOT FOUND: RA-00040 does not exist in this database.');
        }
    } catch (e) {
        console.error('Error connecting to DB:', e);
    } finally {
        await prisma.$disconnect();
    }
}

checkData();
