const prisma = require("../src/config/prisma");
const bcrypt = require("bcrypt");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

async function main() {
  console.log("🌱 Starting seed with basic users only...");

  const hashedPassword = await bcrypt.hash("123456", 10);

  // 1. Create Admin User
  await prisma.user.upsert({
    where: { email: "admin@property.com" },
    update: {
      password: hashedPassword,
      name: "Super Admin",
      role: "ADMIN",
    },
    create: {
      email: "admin@property.com",
      name: "Super Admin",
      password: hashedPassword,
      role: "ADMIN",
    },
  });
  console.log("✅ Admin user created: admin@property.com / 123456");

  // 2. Create Owner User
  await prisma.user.upsert({
    where: { email: "owner@property.com" },
    update: {
      password: hashedPassword,
      name: "Property Owner",
      role: "OWNER",
    },
    create: {
      email: "owner@property.com",
      name: "Property Owner",
      password: hashedPassword,
      role: "OWNER",
      phone: "+1 (819) 555-0100",
    },
  });
  console.log("✅ Owner user created: owner@property.com / 123456");

  // 3. Create Tenant User
  await prisma.user.upsert({
    where: { email: "tenant@property.com" },
    update: {
      password: hashedPassword,
      name: "Jean Dupont",
      role: "TENANT",
    },
    create: {
      email: "tenant@property.com",
      password: hashedPassword,
      name: "Jean Dupont",
      role: "TENANT",
      phone: "+1 (819) 555-0200",
      type: "INDIVIDUAL",
    },
  });
  console.log("✅ Tenant user created: tenant@property.com / 123456");

  console.log("\n🌱 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
