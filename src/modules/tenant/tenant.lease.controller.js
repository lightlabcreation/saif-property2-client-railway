const prisma = require('../../config/prisma');

// GET /api/tenant/lease
exports.getLeaseDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        console.log('Fetching lease for userId:', userId);

        const tenant = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                leases: {
                    include: {
                        unit: {
                            include: { property: true }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });

        console.log('Tenant found with ALL leases:', JSON.stringify(tenant, null, 2));

        if (!tenant || !tenant.leases || tenant.leases.length === 0) {
            console.log('No leases found for tenant:', userId);
            return res.json(null);
        }

        // Filter for relevant leases in JS if needed, or just take the latest
        const lease = tenant.leases.find(l => ['Active', 'DRAFT', 'Moved'].includes(l.status)) || tenant.leases[0];

        // 1. Try to get phone from System Settings
        const supportSetting = await prisma.systemSetting.findUnique({
            where: { key: 'support_phone' }
        });

        // 2. If not in settings, try to get from first Admin user
        let adminPhone = supportSetting?.value;
        if (!adminPhone) {
            const admin = await prisma.user.findFirst({
                where: { role: 'ADMIN', NOT: { phone: null } },
                select: { phone: true }
            });
            adminPhone = admin?.phone;
        }

        // 3. Fallback to hardcoded only if both DB checks fail
        adminPhone = adminPhone || '+1 (555) 0123';

        res.json({
            id: `LEASE-${lease.startDate ? new Date(lease.startDate).getFullYear() : new Date().getFullYear()}-${lease.id}`,
            property: lease.unit.property.name,
            unit: lease.unit.name,
            address: lease.unit.property.address,
            monthlyRent: lease.monthlyRent ? parseFloat(lease.monthlyRent) : 0,
            startDate: lease.startDate,
            endDate: lease.endDate,
            status: lease.status,
            deposit: lease.securityDeposit ? parseFloat(lease.securityDeposit) : 0,
            adminPhone: adminPhone
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
