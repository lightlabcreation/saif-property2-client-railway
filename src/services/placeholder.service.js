const prisma = require('../config/prisma');

class PlaceholderService {
    /**
     * Resolve all placeholders for a given tenant
     * @param {number} userId - The tenant's user ID
     * @returns {Promise<Object>} - Object with placeholder values
     */
    static async getPlaceholderData(userId, propertyId = null) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    building: true,
                    unit: {
                        include: {
                            property: true
                        }
                    },
                    leases: {
                        where: propertyId ? {
                            unit: { propertyId: parseInt(propertyId) },
                            status: 'Active'
                        } : { status: 'Active' },
                        orderBy: { createdAt: 'desc' },
                        include: {
                            unit: {
                                include: { property: true }
                            },
                            bedroom: true
                        }
                    },
                    insurances: {
                        where: { status: 'ACTIVE' },
                        orderBy: { endDate: 'desc' },
                        take: 1
                    },
                    invoices: {
                        where: { status: { not: 'paid' } }
                    }
                }
            });

            if (!user) return {};

            const activeLease = user.leases[0] || null;
            const activeInsurance = user.insurances[0] || null;

            // Calculate outstanding balance
            const outstandingBalance = user.invoices.reduce((acc, inv) => {
                const balance = parseFloat(inv.balanceDue || 0);
                return acc + balance;
            }, 0);

            const data = {
                name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Valued Recipient',
                tenantName: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                tenantFirstName: user.firstName || '',
                tenantLastName: user.lastName || '',
                tenantFullName: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                buildingName: activeLease?.unit?.property?.name || user.unit?.property?.name || user.building?.name || 'N/A',
                unitNumber: activeLease?.unit?.unitNumber || activeLease?.unit?.name || user.unit?.unitNumber || 'N/A',
                bedroomNumber: activeLease?.bedroom?.bedroomNumber || 'N/A',
                leaseEndDate: activeLease?.endDate ? new Date(activeLease.endDate).toLocaleDateString() : 'N/A',
                rentAmount: activeLease?.monthlyRent ? `$${parseFloat(activeLease.monthlyRent).toFixed(2)}` : '$0.00',
                outstandingBalance: `$${outstandingBalance.toFixed(2)}`,
                depositBalance: activeLease?.securityDeposit ? `$${parseFloat(activeLease.securityDeposit).toFixed(2)}` : '$0.00',
                moveOutDate: activeLease?.endDate ? new Date(activeLease.endDate).toLocaleDateString() : 'N/A',
                insuranceExpiryDate: activeInsurance?.endDate ? new Date(activeInsurance.endDate).toLocaleDateString() : 'N/A',
                link: process.env.PORTAL_URL || 'https://portal.campushabitations.com',
                month: new Date().toLocaleDateString('en-US', { month: 'long' }),
                year: new Date().getFullYear().toString()
            };

            return data;
        } catch (error) {
            console.error('[PlaceholderService] Error resolving placeholders:', error);
            return {};
        }
    }

    /**
     * Replace placeholders in a string
     * @param {string} text - The text containing {{placeholders}}
     * @param {Object} data - The data object from getPlaceholderData
     * @returns {string} - The processed text
     */
    static resolve(text, data) {
        if (!text) return '';
        let resolved = text;
        
        // Replace placeholders
        Object.keys(data).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            resolved = resolved.replace(regex, data[key] || '');
        });

        // Apply HTML formatting for clean display in email clients
        // 1. Convert newlines to <br/> tags
        resolved = resolved.replace(/\n/g, '<br/>');
        // 2. Convert markdown-style bold (**text**) to HTML bold (<b>text</b>)
        resolved = resolved.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

        return resolved;
    }
}

module.exports = PlaceholderService;
