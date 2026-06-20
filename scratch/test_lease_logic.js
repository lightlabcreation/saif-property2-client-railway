const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testLeaseLogic() {
  try {
    const unitId = 1; // Change to a valid unit ID in your DB
    const tenantId = 2; // Change to a valid tenant ID in your DB
    const startDate = "2026-04-13";
    const endDate = "2027-04-12";
    const monthlyRent = 1000;
    const securityDeposit = 1000;

    const uId = parseInt(unitId);
    const tId = parseInt(tenantId);
    const bId = null;

    console.log("Starting test...");

    const targetTenant = await prisma.user.findUnique({ where: { id: tId } });
    if (!targetTenant) {
        console.error("Tenant not found");
        return;
    }

    const unit = await prisma.unit.findUnique({
        where: { id: uId },
        include: {
            bedroomsList: true,
            leases: {
                where: { status: { in: ['Active', 'DRAFT'] } },
                include: { tenant: { select: { type: true } } }
            }
        }
    });

    if (!unit) {
        console.error("Unit not found");
        return;
    }

    const today = new Date();
    today.setHours(0,0,0,0);
    const leaseEndRaw = new Date(endDate);
    const leaseEnd = new Date(leaseEndRaw.getUTCFullYear(), leaseEndRaw.getUTCMonth(), leaseEndRaw.getUTCDate());

    const leaseData = {
        startDate: new Date(startDate),
        endDate: leaseEndRaw,
        monthlyRent: parseFloat(monthlyRent) || 0,
        securityDeposit: parseFloat(securityDeposit) || 0,
        status: leaseEnd < today ? 'Expired' : 'Active',
        leaseType: 'FULL_UNIT',
        bedroomId: bId
    };

    console.log("Lease Data:", leaseData);

    // Skip actual creation, check invoice logic
    const startRaw = new Date(startDate);
    const start = new Date(startRaw.getUTCFullYear(), startRaw.getUTCMonth(), startRaw.getUTCDate());
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const effectiveEnd = leaseEnd < currentMonthStart ? leaseEnd : currentMonthStart;
    
    let iterDate = new Date(start.getFullYear(), start.getMonth(), 1);
    console.log("Effective End:", effectiveEnd);
    console.log("Iter Date Start:", iterDate);

    while (iterDate <= effectiveEnd) {
        const currentIterMonthStr = iterDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        console.log("Would create invoice for:", currentIterMonthStr);
        iterDate.setMonth(iterDate.getMonth() + 1);
        if (iterDate.getFullYear() > 2100) break; // safety
    }

    console.log("Logic test finished successfully");
  } catch (error) {
    console.error("Logic test failed with error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testLeaseLogic();
