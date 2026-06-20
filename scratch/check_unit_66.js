const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUnit(id) {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: parseInt(id) },
      include: {
        property: true,
        leases: { include: { tenant: true }, orderBy: { startDate: 'desc' } },
        bedroomsList: { orderBy: { roomNumber: 'asc' } },
        reserved_by_user: true
      }
    });

    if (!unit) {
      console.log('Unit not found');
      return;
    }

    const activeLease = unit.leases.find(l => l.status === 'Active');
    const result = {
      ...unit,
      activeLease: activeLease ? { tenantName: activeLease.tenant.name, startDate: activeLease.startDate, endDate: activeLease.endDate, amount: activeLease.monthlyRent } : null,
    };

    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUnit(66);
