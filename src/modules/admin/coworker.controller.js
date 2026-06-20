const prisma = require('../../config/prisma');
const crypto = require('crypto');
const emailService = require('../../services/email.service');
const smsService = require('../../services/sms.service');

const modulesList = [
    'Dashboard',
    'Overview',
    'Vacancy Dashboard',
    'Revenue Dashboard',
    'Properties',
    'Buildings',
    'Units',
    'Unit Readiness',
    'Tenants',
    'Tenant List',
    'Vehicles',
    'Insurance',
    'Leases',
    'Rent Roll',
    'Documents',
    'Payments',
    'Invoices',
    'Payments Received',
    'Outstanding Dues',
    'Refunds',
    'Accounting',
    'General Ledger',
    'QuickBooks Sync',
    'Chart of Accounts',
    'Tax Settings',
    'Reports',
    'Communication',
    'Inbox',
    'Campaign Manager',
    'Templates',
    'Email Hub',
    'Send Email',
    'Email Templates',
    'Sent Emails',
    'Maintenance',
    'Tickets',
    'Inspections',
    'Inspection List',
    'Inspection Templates',
    'Unit Preparation',
    'Move-Out',
    'Move-In',
    'Shuttle',
    'Settings'
];

exports.getCoworkers = async (req, res) => {
    try {
        let coworkers = await prisma.user.findMany({
            where: { role: 'COWORKER' },
            include: { permissions: true },
            orderBy: { createdAt: 'desc' }
        });

        // Healing logic: add missing modules and remove extra ones
        for (const coworker of coworkers) {
            const existingModules = coworker.permissions.map(p => p.moduleName);
            const missingModules = modulesList.filter(m => !existingModules.includes(m));
            const extraModules = existingModules.filter(m => !modulesList.includes(m));

            if (missingModules.length > 0) {
                await prisma.permission.createMany({
                    data: missingModules.map(m => ({
                        userId: coworker.id,
                        moduleName: m,
                        canView: false,
                        canAdd: false,
                        canEdit: false,
                        canDelete: false
                    }))
                });
            }

            if (extraModules.length > 0) {
                await prisma.permission.deleteMany({
                    where: {
                        userId: coworker.id,
                        moduleName: { in: extraModules }
                    }
                });
            }
        }

        // Re-fetch to get the healed data
        coworkers = await prisma.user.findMany({
            where: { role: 'COWORKER' },
            include: { permissions: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json(coworkers);
    } catch (error) {
        console.error('Get Coworkers Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createCoworker = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, title, permissions } = req.body;

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const coworker = await prisma.user.create({
            data: {
                firstName: firstName || '',
                lastName: lastName || '',
                email,
                phone,
                title,
                role: 'COWORKER',
                isInvited: false,
                isActive: true,
                preferredLanguage: req.body.preferredLanguage || 'English',
                name: `${firstName || ''} ${lastName || ''}`.trim() || email,
                permissions: {
                    create: modulesList.map(module => {
                        const customPerm = permissions?.find(p => p.moduleName === module);
                        return {
                            moduleName: module,
                            canView: customPerm?.canView || false,
                            canAdd: customPerm?.canAdd || false,
                            canEdit: customPerm?.canEdit || false,
                            canDelete: customPerm?.canDelete || false
                        };
                    })
                }
            },
            include: { permissions: true }
        });

        res.json(coworker);
    } catch (error) {
        console.error('Create Coworker Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateCoworker = async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, email, phone, title, isActive, permissions } = req.body;

        const updateData = {
            firstName: firstName || '',
            lastName: lastName || '',
            email,
            phone,
            title,
            isActive,
            preferredLanguage: req.body.preferredLanguage,
            name: `${firstName || ''} ${lastName || ''}`.trim() || email
        };

        // If permissions are provided, update them as well
        if (permissions && permissions.length > 0) {
            updateData.permissions = {
                upsert: permissions.map(p => ({
                    where: { id: p.id || -1 }, // Use an ID that won't match if it's new
                    update: {
                        canView: p.canView,
                        canAdd: p.canAdd,
                        canEdit: p.canEdit,
                        canDelete: p.canDelete
                    },
                    create: {
                        moduleName: p.moduleName,
                        canView: p.canView,
                        canAdd: p.canAdd,
                        canEdit: p.canEdit,
                        canDelete: p.canDelete
                    }
                }))
            };
        }

        const coworker = await prisma.user.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        res.json(coworker);
    } catch (error) {
        console.error('Update Coworker Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteCoworker = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id);

        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Invalid User ID provided' });
        }
        
        // 1. Delete refresh tokens
        await prisma.refreshToken.deleteMany({ where: { userId } });

        // 2. Delete messages (as sender or receiver)
        await prisma.message.deleteMany({ 
            where: { 
                OR: [
                    { senderId: userId },
                    { receiverId: userId }
                ] 
            } 
        });

        // 3. Delete communication logs
        await prisma.communicationLog.deleteMany({ where: { recipientId: userId } });
        
        // 4. Delete permissions
        await prisma.permission.deleteMany({ where: { userId } });
        
        // 5. Delete the user
        await prisma.user.delete({ where: { id: userId } });

        res.json({ message: 'Coworker deleted successfully' });
    } catch (error) {
        console.error('Delete Coworker Error:', error);
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
};

exports.getPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const permissions = await prisma.permission.findMany({
            where: { userId: parseInt(id) }
        });
        res.json(permissions);
    } catch (error) {
        console.error('Get Permissions Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getMyPermissions = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const permissions = await prisma.permission.findMany({
            where: { userId: parseInt(userId) }
        });
        res.json(permissions);
    } catch (error) {
        console.error('Get My Permissions Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updatePermissions = async (req, res) => {
    try {
        const { id } = req.params; // User ID
        const { permissions } = req.body; 

        for (const p of permissions) {
            const { id: permId, moduleName, ...updateData } = p;
            
            // Search manually since unique constraint (userId_moduleName) is missing in schema
            let existing = null;
            const numericId = parseInt(permId);
            if (!isNaN(numericId) && numericId > 0) {
                existing = await prisma.permission.findUnique({ where: { id: numericId } });
            } else {
                existing = await prisma.permission.findFirst({
                    where: { userId: parseInt(id), moduleName }
                });
            }

            if (existing) {
                await prisma.permission.update({
                    where: { id: existing.id },
                    data: updateData
                });
            } else {
                await prisma.permission.create({
                    data: {
                        userId: parseInt(id),
                        moduleName,
                        ...updateData
                    }
                });
            }
        }

        res.json({ message: 'Permissions updated successfully' });
    } catch (error) {
        console.error('Update Permissions Error:', error);
        res.status(500).json({ message: 'Error updating permissions: ' + error.message });
    }
};

exports.sendInvitation = async (req, res) => {
    try {
        const { id } = req.params;
        const { templateId } = req.body;
        
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await prisma.user.update({
            where: { id: parseInt(id) },
            data: {
                inviteToken,
                inviteExpires,
                isInvited: true
            }
        });

        // Fetch coworker details with their preferred language
        const coworker = await prisma.user.findUnique({
            where: { id: parseInt(id) }
        });

        if (!coworker.email) {
            return res.status(400).json({ message: 'Coworker email is missing' });
        }

        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const inviteLink = `${baseUrl}/invite?token=${inviteToken}`;
        
        // --- PHASE 3: Template Logic ---
        const langCode = coworker.preferredLanguage?.toLowerCase().includes('french') ? 'fr' : 'en';
        
        let dbTemplate = null;
        const parsedTemplateId = parseInt(templateId);
        if (templateId && !isNaN(parsedTemplateId)) {
            // Manual selection from UI - Force Int type for Prisma
            dbTemplate = await prisma.emailTemplate.findUnique({
                where: { id: parsedTemplateId }
            });
            console.log(`[Invitation] Manual template selected: ${parsedTemplateId}, Found: ${!!dbTemplate}`);
        } else {
            // Auto-pick based on type and language
            dbTemplate = await prisma.emailTemplate.findFirst({
                where: {
                    type: 'INVITATION',
                    language: langCode
                }
            });
            console.log(`[Invitation] Auto-picking template for ${langCode}, Found: ${!!dbTemplate}`);
        }

        let subject = 'Team Invitation';
        let finalBody = `Hello ${coworker.name || 'Team Member'},<br/><br/>You've been invited to join the Property Management system.<br/><br/>Start here: <a href="${inviteLink}" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">${inviteLink}</a>`;

        if (dbTemplate) {
            subject = dbTemplate.subject;
            // First, substitute placeholders (name and link)
            const clickableLink = `<a href="${inviteLink}" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">${inviteLink}</a>`;
            let processedBody = dbTemplate.body
                .replace(/{{link}}/g, clickableLink)
                .replace(/{{name}}/g, coworker.name || (langCode === 'fr' ? 'Membre de l\'équipe' : 'Team Member'));

            // Second, handle formatting: Markdown bolding (**text**) to HTML (<b>text</b>)
            processedBody = processedBody.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

            // Third, handle newlines: Convert \n to <br/> so it's not "bunched up" in HTML
            finalBody = processedBody.replace(/\n/g, '<br/>');
        }
        // --- END PHASE 3 ---

        console.log(`[Invitation] Sending email to ${coworker.email} | Subject: ${subject} | Template Found: ${!!dbTemplate}`);
        const eRes = await emailService.sendEmail(coworker.email, subject, finalBody, { isHtml: true });
        
        if (!eRes.success) {
            console.error('Email failed to send:', eRes.error);
            return res.status(500).json({ 
                message: 'Failed to send invitation email. Please check email configuration.',
                error: eRes.error 
            });
        }

        res.json({ 
            message: 'Invitation sent successfully via email', 
            status: 'Invited'
        });
    } catch (error) {
        console.error('Send Invitation Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
