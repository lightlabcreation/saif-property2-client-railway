const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const smsService = require('../../services/sms.service');

// Send a message
exports.sendMessage = async (req, res) => {
    try {
        const { receiverId, content } = req.body;
        const senderId = req.user.id; // Assumes auth middleware populates req.user

        // Handle Resident ID prefix from frontend
        const targetId = typeof receiverId === 'string' && receiverId.startsWith('resident_')
            ? parseInt(receiverId.replace('resident_', ''))
            : parseInt(receiverId);

        if (isNaN(targetId) || !content) {
            return res.status(400).json({ error: 'Valid Receiver ID and content are required' });
        }

        // Get receiver details to check for phone number and app access
        const receiver = await prisma.user.findUnique({
            where: { id: targetId },
            select: { id: true, name: true, phone: true, email: true, type: true, password: true }
        });

        if (!receiver) {
            return res.status(404).json({ error: 'Receiver not found' });
        }

        // Get sender details for SMS
        const sender = await prisma.user.findUnique({
            where: { id: parseInt(senderId) },
            select: { name: true, role: true }
        });

        let smsSid = null;
        let smsStatus = null;
        const hasAppAccess = receiver.type !== 'RESIDENT' && receiver.password;
        let sentVia = hasAppAccess ? 'app' : 'sms';

        // Send SMS if receiver has a phone number
        if (receiver.phone) {
            const smsMessage = content;
            const smsResult = await smsService.sendSMS(receiver.phone, smsMessage);

            if (smsResult.success) {
                smsSid = smsResult.sid;
                smsStatus = 'sent';
                // If they have app access, it's both. If not (like Residents), it's SMS only.
                sentVia = hasAppAccess ? 'both' : 'sms';
                console.log(`✅ SMS sent to ${receiver.phone} (SID: ${smsSid})`);
            } else {
                console.error(`❌ SMS failed to ${receiver.phone}:`, smsResult.error);
                smsStatus = 'failed';
                sentVia = hasAppAccess ? 'app' : 'none';
            }


        }

        // Create message in database
        const message = await prisma.message.create({
            data: {
                content,
                senderId: parseInt(senderId),
                receiverId: targetId, // Use the numeric ID (works for both regular users and residents)
                isRead: false,
                smsSid,
                smsStatus,
                sentVia
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true, email: true }
                },
                receiver: {
                    select: { id: true, name: true, role: true, email: true, phone: true }
                }
            }
        });

        // Log to CommunicationLog for auditing
        try {
            await prisma.communicationLog.create({
                data: {
                    channel: sentVia.includes('sms') ? 'SMS' : 'App',
                    eventType: 'MANUAL_MESSAGE',
                    recipient: receiver.email || receiver.phone || 'Unknown',
                    recipientId: receiver.id,
                    content: content,
                    status: (sentVia === 'sms' && smsStatus === 'failed') ? 'Failed' : 'Sent'
                }
            });
        } catch (logError) {
            console.error('Error logging individual message:', logError);
        }

        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

// Get chat history with a specific user
exports.getHistory = async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const userRole = req.user.role;
        const rawId = req.params.userId;
        const otherUserId = typeof rawId === 'string' && rawId.startsWith('resident_')
            ? parseInt(rawId.replace('resident_', ''))
            : parseInt(rawId);

        if (isNaN(otherUserId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Shared Inbox Logic for Admins & Coworkers:
        // Management staff see all messages between the target user and ANY admin/staff.
        // Residents/Tenants only see messages between them and the management team.
        const isAdminOrStaff = userRole === 'ADMIN' || userRole === 'COWORKER';
        const whereClause = isAdminOrStaff
            ? {
                OR: [
                    { senderId: otherUserId, receiver: { role: { in: ['ADMIN', 'COWORKER'] } } },
                    { sender: { role: { in: ['ADMIN', 'COWORKER'] } }, receiverId: otherUserId }
                ]
            }
            : {
                OR: [
                    { senderId: currentUserId, receiverId: otherUserId },
                    { senderId: otherUserId, receiverId: currentUserId }
                ]
            };

        const messages = await prisma.message.findMany({
            where: whereClause,
            orderBy: {
                createdAt: 'asc'
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true }
                }
            }
        });

        res.json(messages);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
};


// Get list of conversations (Recent chats + All users depending on role)
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        // For simplicity:
        // If Admin: fetch ALL Tenants and Owners.
        // If Tenant/Owner: fetch ONLY Admin(s).

        const isAdminOrStaff = userRole === 'ADMIN' || userRole === 'COWORKER';
        if (isAdminOrStaff) {
            // Fetch all users except self (Owners and Tenants)
            const users = await prisma.user.findMany({
                where: {
                    id: { not: userId },
                    role: { in: ['TENANT', 'OWNER', 'COWORKER'] },
                    type: { not: 'RESIDENT' },
                    OR: [
                        { role: 'OWNER' },
                        { role: 'COWORKER' },
                        { AND: [
                            { role: 'TENANT' },
                            { leases: { some: { status: 'Active' } } }
                        ]}
                    ]
                },
                select: {
                    id: true,
                    name: true,
                    role: true,
                    email: true,
                    phone: true,
                    type: true,
                    buildingId: true,
                    leases: {
                        where: { status: 'Active' },
                        select: { unit: { select: { propertyId: true } } }
                    },
                    properties: {
                        select: { id: true }
                    }
                }
            });

            const formattedUsers = users.map(u => ({
                id: u.id,
                name: u.name,
                role: u.role,
                email: u.email,
                phone: u.phone,
                type: u.type,
                buildingIds: [
                    u.buildingId,
                    ...(u.leases || []).map(l => l.unit?.propertyId),
                    ...(u.properties || []).map(p => p.id)
                ].filter(Boolean)
            }));

            // Fetch all Residents (Occupants)
            const residents = await prisma.user.findMany({
                where: { 
                    type: 'RESIDENT',
                    OR: [
                        { residentLease: { status: 'Active' } },
                        { parent: { leases: { some: { status: 'Active' } } } }
                    ]
                },
                include: {
                    parent: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            leases: {
                                where: { status: 'Active' },
                                select: {
                                    id: true,
                                    unitId: true,
                                    unit: { select: { propertyId: true } }
                                }
                            }
                        }
                    },
                    unit: {
                        select: { propertyId: true }
                    },
                    residentLease: {
                        select: {
                            id: true,
                            unit: { select: { propertyId: true } }
                        }
                    }
                }
            });

            // Filter out residents whose parent's active lease does not match their assigned unit
            const activeResidents = residents.filter(r => {
                if (r.residentLease) return true;
                if (r.parentId && r.unitId) {
                    return r.parent?.leases?.some(l => l.unitId === r.unitId);
                }
                return false;
            });

            // Format residents to match user structure for communication
            const formattedResidents = activeResidents.map(r => {
                const parentActiveLease = r.parent?.leases?.find(l => l.unitId === r.unitId) || r.parent?.leases?.[0];
                const parentBuildingIds = (r.parent?.leases || []).map(l => l.unit?.propertyId).filter(Boolean);
                return {
                    id: `resident_${r.id}`, // Prefix to distinguish from user IDs
                    name: r.name || `${r.firstName} ${r.lastName}`.trim(),
                    role: 'RESIDENT',
                    email: r.email || r.parent?.email || null,
                    phone: r.phone,
                    type: 'RESIDENT',
                    tenantId: r.parentId,
                    tenantName: r.parent?.name,
                    leaseId: r.leaseId || (parentActiveLease?.id || null),
                    isResident: true,
                    buildingIds: [
                        r.buildingId,
                        r.unit?.propertyId,
                        r.residentLease?.unit?.propertyId,
                        ...parentBuildingIds
                    ].filter(Boolean)
                };
            });

            // Combine users and residents
            const allRecipients = [...formattedUsers, ...formattedResidents];

            // Attach metadata (unread count, last message)
            const recipientsWithMetadata = await Promise.all(allRecipients.map(async (recipient) => {
                const targetNumericId = typeof recipient.id === 'string' && recipient.id.startsWith('resident_')
                    ? parseInt(recipient.id.replace('resident_', ''))
                    : recipient.id;

                // Count unread messages from this user to ANY management staff
                const unreadCount = await prisma.message.count({
                    where: {
                        senderId: targetNumericId,
                        receiver: { role: { in: ['ADMIN', 'COWORKER'] } },
                        isReadByAdmin: false
                    }
                });

                // Find the last message exchanged between this user and ANY management staff
                const lastMessage = await prisma.message.findFirst({
                    where: {
                        OR: [
                            { senderId: targetNumericId, receiver: { role: { in: ['ADMIN', 'COWORKER'] } } },
                            { sender: { role: { in: ['ADMIN', 'COWORKER'] } }, receiverId: targetNumericId }
                        ]
                    },
                    orderBy: { createdAt: 'desc' }
                });
                return { ...recipient, unreadCount, lastMessage };
            }));

            res.json(recipientsWithMetadata);


        } else {
            // Find Admins to chat with
            const admins = await prisma.user.findMany({
                where: { role: 'ADMIN' },
                select: { id: true, name: true, role: true }
            });
            res.json(admins);
        }

    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const senderId = parseInt(req.body.senderId); // The person whose messages I am reading

        // Mark messages as read from this person to ANY management staff
        const isAdminOrStaff = userRole === 'ADMIN' || userRole === 'COWORKER';
        const updateWhere = isAdminOrStaff
            ? {
                senderId: senderId,
                receiver: { role: { in: ['ADMIN', 'COWORKER'] } },
                OR: [
                    { isRead: false },
                    { isReadByAdmin: false }
                ]
            }
            : {
                senderId: senderId,
                receiverId: userId,
                isRead: false
            };

        await prisma.message.updateMany({
            where: updateWhere,
            data: { 
                isRead: true,
                isReadByAdmin: true
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
};

