const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const path = require('path');

// Ensure env variables are loaded from the project root .env file
require('dotenv').config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  console.log("=== DATABASE RESET AND SEED SCRIPT ===");
  console.log(`Using Database URL: ${process.env.DATABASE_URL}`);
  
  try {
    // 1. Disable foreign key checks
    console.log("Disabling foreign key checks...");
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');
    
    // 2. Fetch all table names dynamically
    console.log("Fetching all database tables...");
    const tables = await prisma.$queryRawUnsafe(`
      SELECT TABLE_NAME 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE();
    `);
    
    // 3. Truncate each table (except prisma migration history)
    for (const row of tables) {
      const tableName = row.TABLE_NAME || row.table_name;
      if (tableName === '_prisma_migrations') {
        console.log(`Skipping migration history table: ${tableName}`);
        continue;
      }
      console.log(`Clearing table: ${tableName}...`);
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${tableName}\`;`);
    }
    
    // 4. Re-enable foreign key checks
    console.log("Re-enabling foreign key checks...");
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');
    
    // 5. Seed credentials for admin, owner, and tenant
    console.log("Hashing password...");
    const hashedPassword = await bcrypt.hash("123456", 10);
    
    console.log("Creating Admin User...");
    await prisma.user.create({
      data: {
        email: "admin@property.com",
        name: "Super Admin",
        password: hashedPassword,
        role: "ADMIN",
        isActive: true,
        type: "INDIVIDUAL"
      }
    });
    
    console.log("Creating Owner User...");
    await prisma.user.create({
      data: {
        email: "owner@property.com",
        name: "Property Owner",
        password: hashedPassword,
        role: "OWNER",
        phone: "+1 (819) 555-0100",
        isActive: true,
        type: "INDIVIDUAL"
      }
    });
    
    console.log("Creating Tenant User...");
    await prisma.user.create({
      data: {
        email: "tenant@property.com",
        name: "Jean Dupont",
        password: hashedPassword,
        role: "TENANT",
        phone: "+1 (819) 555-0200",
        isActive: true,
        type: "INDIVIDUAL"
      }
    });

    // 6. Seed default unit types (optional, to keep backend happy)
    try {
      const { VALID_UNIT_TYPES } = require('./src/config/unitTypes');
      if (VALID_UNIT_TYPES && Array.isArray(VALID_UNIT_TYPES)) {
        console.log("Seeding unit types...");
        for (const typeName of VALID_UNIT_TYPES) {
          await prisma.unitType.create({
            data: {
              name: typeName,
              isActive: true
            }
          });
        }
      }
    } catch (utErr) {
      console.log("Skipping/Unable to seed unit types:", utErr.message);
    }

    // 7. Seed default service items (optional, to keep backend happy)
    try {
      console.log("Seeding default service fee items...");
      const serviceItems = [
        { name: "Cleaning fee", amount: 150 },
        { name: "Wall repair", amount: 200 },
        { name: "Paint touch-up", amount: 120 },
        { name: "Appliance damage", amount: 300 },
        { name: "Missing keys", amount: 50 },
        { name: "Missing FOB", amount: 75 },
        { name: "Garbage removal", amount: 90 },
        { name: "Furniture removal", amount: 150 },
        { name: "Other repair charges", amount: 0 }
      ];
      await prisma.serviceFeeItem.createMany({
        data: serviceItems
      });
    } catch (sfErr) {
      console.log("Skipping/Unable to seed service fee items:", sfErr.message);
    }

    console.log("\n=== DATABASE RESET AND SEED SUCCESSFUL! ===");
    console.log("Credentials Created:");
    console.log("-----------------------------------------");
    console.log("1. ADMIN Dashboard:");
    console.log("   Email:    admin@property.com");
    console.log("   Password: 123456");
    console.log("2. OWNER Dashboard:");
    console.log("   Email:    owner@property.com");
    console.log("   Password: 123456");
    console.log("3. TENANT Dashboard:");
    console.log("   Email:    tenant@property.com");
    console.log("   Password: 123456");
    console.log("-----------------------------------------");

  } catch (error) {
    console.error("❌ Error running script:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
