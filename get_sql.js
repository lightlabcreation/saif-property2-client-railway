const { PrismaClient } = require('@prisma/client');

async function getSQL() {
    console.log(`-- 🛡️ ADDITIVE BACKWARDS-COMPATIBLE SQL SETUP`);
    console.log(`-- Run this inside your Railway SQL Editor or Git CI Pipeline`);
    console.log(`\n-- 1. Create Invoice Line Item Table`);
    console.log(`CREATE TABLE \`invoicelineitem\` (`);
    console.log(`  \`id\` INTEGER NOT NULL AUTO_INCREMENT,`);
    console.log(`  \`invoiceId\` INTEGER NOT NULL,`);
    console.log(`  \`description\` TEXT NOT NULL,`);
    console.log(`  \`amount\` DECIMAL(65,30) NOT NULL,`);
    console.log(`  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),`);
    console.log(`  \`updatedAt\` DATETIME(3) NOT NULL,`);
    console.log(`  PRIMARY KEY (\`id\`)`);
    console.log(`) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);

    console.log(`\n-- 2. Add Columns to RefundAdjustment Table`);
    console.log(`ALTER TABLE \`refundadjustment\` `);
    console.log(`  ADD COLUMN \`issuedDate\` DATETIME(3) NULL,`);
    console.log(`  ADD COLUMN \`method\` VARCHAR(191) NULL,`);
    console.log(`  ADD COLUMN \`referenceNumber\` VARCHAR(191) NULL,`);
    console.log(`  ADD COLUMN \`proofUrl\` VARCHAR(191) NULL,`);
    console.log(`  ADD COLUMN \`outcomeReason\` VARCHAR(191) NULL;`);

    console.log(`\n-- 3. Add Foreign Key constraints`);
    console.log(`ALTER TABLE \`invoicelineitem\` ADD CONSTRAINT \`invoicelineitem_invoiceId_fkey\` FOREIGN KEY (\`invoiceId\`) REFERENCES \`invoice\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE;`);
}

getSQL();
