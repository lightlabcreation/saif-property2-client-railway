const prisma = require('./config/prisma');

async function debugFilter() {
    try {
        const unread = await prisma.message.findMany({
            where: {
                direction: 'INBOUND',
                isReadByAdmin: false
            },
            include: {
                sender: {
                    include: {
                        leases: true,
                        residentLease: true
                    }
                }
            }
        });

        console.log(`Found ${unread.length} raw unread messages.`);

        const filtered = unread.filter(m => {
            const s = m.sender;
            if (!s) return false;
            
            // Check Owner
            if (s.role === 'OWNER') return true;
            
            // Check Tenant
            if (s.role === 'TENANT' && s.type !== 'RESIDENT') {
                const hasActiveLease = s.leases && s.leases.some(l => l.status === 'Active');
                if (hasActiveLease) return true;
            }
            
            // Check Resident
            if (s.type === 'RESIDENT') {
                const hasActiveResidentLease = s.residentLease && s.residentLease.status === 'Active';
                if (hasActiveResidentLease) return true;
            }
            
            return false;
        });

        console.log(`After Javascript filtering: ${filtered.length} messages.`);
        filtered.forEach(m => console.log(`- ID ${m.id} from ${m.sender.name || 'null'} (ID ${m.senderId})`));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debugFilter();
