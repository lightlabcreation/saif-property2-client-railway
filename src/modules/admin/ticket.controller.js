const prisma = require('../../config/prisma');
const https = require('https');
const { uploadToCloudinary } = require('../../config/cloudinary');

// GET /api/admin/tickets
exports.getAllTickets = async (req, res) => {
    try {
        const { userId } = req.query;

        const where = {};
        if (userId) {
            where.userId = parseInt(userId);
        }

        const tickets = await prisma.ticket.findMany({
            where,
            include: {
                user: true,
                unit: { include: { property: true } },
                property: true,
                inspection: { include: { inspector: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = tickets.map(t => {
            // Priority 1: Direct unit link from ticket (for Move-Out/In deficiency)
            // Priority 2: Active lease unit
            let unitInfo = 'No Active Unit';
            if (t.unit) {
                unitInfo = `${t.unit.property.name} - ${t.unit.unitNumber}`;
            }

            return {
                id: `T-${t.id + 1000}`,
                dbId: t.id,
                tenant: t.user.name || 'Unknown',
                userRole: t.user.role,
                inspectorName: t.inspection?.inspector?.name || 'N/A',
                unit: unitInfo,
                subject: t.subject,
                category: t.category,
                priority: t.priority,
                status: t.status,
                desc: t.description,
                createdAt: t.createdAt.toLocaleString(),
                createdAtRaw: t.createdAt.toISOString(),
                date: t.createdAt.toISOString().split('T')[0],
                resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
                attachments: (() => {
                    try {
                        return t.attachmentUrls ? JSON.parse(t.attachmentUrls) : [];
                    } catch (e) {
                        return [];
                    }
                })(),
                tenantDetails: {
                    name: t.user.name,
                    property: t.unit?.property?.name || 'N/A',
                    unit: t.unit?.unitNumber || 'N/A',
                    leaseStatus: 'N/A',
                    email: t.user.email,
                    phone: t.user.phone,
                },
                propertyId: t.propertyId,
                unitId: t.unitId,
                tenantId: t.userId,
                isRequired: t.isRequired
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

const workflowService = require('../../services/workflow.service');

// PUT /api/admin/tickets/:id/status
exports.updateTicketStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const ticketId = parseInt(id);

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: { 
                status,
                resolvedAt: status === 'Resolved' ? new Date() : null
            }
        });

        // Trigger Auto-Progression for Unit Prep Flow if applicable
        if (updated.unitId && ['Closed', 'Completed', 'Resolved'].includes(status)) {
            await workflowService.checkAndProgressUnitPrep(updated.unitId);
        }

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tickets (Admin creating ticket for tenant)
exports.createTicket = async (req, res) => {
    try {
        const { tenantId, subject, description, priority, category, unitId } = req.body;
        let { propertyId } = req.body;

        const attachmentUrls = [];

        // Handle Images upload
        if (req.files && req.files.images) {
            const images = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
            for (const img of images) {
                const result = await uploadToCloudinary(img.tempFilePath, 'tickets/images');
                attachmentUrls.push({ type: 'image', url: result.secure_url });
            }
        }

        // Handle Video upload
        if (req.files && req.files.video) {
            const video = req.files.video;
            const result = await uploadToCloudinary(video.tempFilePath, 'tickets/videos');
            attachmentUrls.push({ type: 'video', url: result.secure_url });
        }

        // 1. Resolve Target Property IDs
        let targetPropertyIds = [];
        if (propertyId === 'all') {
            const allProps = await prisma.property.findMany({ select: { id: true } });
            targetPropertyIds = allProps.map(p => p.id);
        } else if (propertyId) {
            // Handle comma-separated list of IDs for multi-select (e.g., "1,2,3")
            targetPropertyIds = propertyId.toString().split(',').map(id => parseInt(id.trim())).filter(Boolean);
        }

        if (targetPropertyIds.length === 0) {
            targetPropertyIds = [null]; // Fallback to generic
        }

        // 2. Resolve Fallback Assignment User
        let assignId = parseInt(tenantId);
        if (!assignId) {
            const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
            assignId = admin ? admin.id : 1; 
        }

        const createdTickets = [];
        for (const pid of targetPropertyIds) {
            const ticket = await prisma.ticket.create({
                data: {
                    userId: assignId,
                    subject,
                    description,
                    priority,
                    category: category || null,
                    status: 'Open',
                    propertyId: pid,
                    unitId: pid ? (unitId ? parseInt(unitId) : null) : null, // Units only apply if 1 property selected usually
                    attachmentUrls: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null
                }
            });
            createdTickets.push(ticket);
        }

        // Return first or summary
        res.status(201).json(targetPropertyIds.length === 1 ? createdTickets[0] : { success: true, count: createdTickets.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating ticket' });
    }
};

// PUT /api/admin/tickets/:id
exports.updateTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, description, priority, category, status, propertyId, unitId, tenantId } = req.body;

        const updateData = {
            subject,
            description,
            priority,
            category,
            status,
            propertyId: propertyId ? parseInt(propertyId) : undefined,
            unitId: unitId ? parseInt(unitId) : undefined,
            userId: tenantId ? parseInt(tenantId) : undefined
        };

        if (status !== undefined) {
            updateData.resolvedAt = status === 'Resolved' ? new Date() : null;
        }

        const updated = await prisma.ticket.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Trigger Auto-Progression for Unit Prep Flow if applicable
        if (updated.unitId && status && ['Closed', 'Completed', 'Resolved'].includes(status)) {
            await workflowService.checkAndProgressUnitPrep(updated.unitId);
        }

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating ticket' });
    }
};

// DELETE /api/admin/tickets/:id
exports.deleteTicket = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.ticket.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Ticket deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting ticket' });
    }
};

// GET /api/admin/tickets/:ticketId/attachments/:attachmentId
exports.getTicketAttachment = async (req, res) => {
    try {
        const { ticketId, attachmentId } = req.params;
        const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(ticketId) }
        });

        if (!ticket || !ticket.attachmentUrls) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        let attachments;
        try {
            attachments = JSON.parse(ticket.attachmentUrls);
        } catch (e) {
            return res.status(500).json({ message: 'Corrupted attachment data' });
        }
        const attachment = attachments[parseInt(attachmentId)];

        if (!attachment || !attachment.url) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        // Proxy the file from Cloudinary 
        https.get(attachment.url, (response) => {
            if (response.statusCode !== 200) {
                return res.status(response.statusCode).json({ message: 'Failed to fetch attachment from storage' });
            }

            // Trust Cloudinary's content type or guess based on type
            const contentType = response.headers['content-type'] || (attachment.type === 'image' ? 'image/jpeg' : 'application/octet-stream');

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', response.headers['content-length']);
            // Force inline display for previewable types
            res.setHeader('Content-Disposition', 'inline');

            response.pipe(res);
        }).on('error', (err) => {
            console.error('Attachment Proxy Error:', err);
            res.status(500).json({ message: 'Error proxying attachment' });
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/tickets/export
exports.exportTickets = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const where = {};
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                if (!endDate.includes('T')) {
                    end.setHours(23, 59, 59, 999);
                }
                where.createdAt.lte = end;
            }
        }

        const tickets = await prisma.ticket.findMany({
            where,
            include: {
                user: true,
                unit: { include: { property: true } },
                property: true,
                inspection: { include: { inspector: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const rows = tickets.map(t => {
            const ticketNum = `T-${t.id + 1000}`;
            const submitted = t.createdAt ? t.createdAt.toISOString().replace('T', ' ').substring(0, 19) : '';
            
            const isAcknowledged = ['In Progress', 'Resolved', 'Closed', 'Completed'].includes(t.status);
            const acknowledged = isAcknowledged && t.updatedAt
                ? t.updatedAt.toISOString().replace('T', ' ').substring(0, 19)
                : 'N/A';

            const resolved = t.resolvedAt ? t.resolvedAt.toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
            const status = t.status || 'Open';
            
            // Clean Category / Type formatting
            const rawCat = t.category || t.type || 'N/A';
            const categoryType = rawCat.charAt(0).toUpperCase() + rawCat.slice(1).toLowerCase();
            
            const priority = t.priority || 'Low';
            const building = t.property?.name || t.unit?.property?.name || 'N/A';
            const unitNumber = t.unit?.unitNumber || 'N/A';
            const tenantName = t.user?.name || 'N/A';
            
            // Fix: Fallback to 'Unassigned'
            const assignee = t.inspection?.inspector?.name || 'Unassigned';
            
            let timeToAssignment = 'N/A';
            if (isAcknowledged && t.updatedAt && t.createdAt) {
                const diffMs = t.updatedAt.getTime() - t.createdAt.getTime();
                const diffHrs = (diffMs / (1000 * 60 * 60)).toFixed(2);
                timeToAssignment = `${diffHrs} hours`;
            }

            let timeToResolution = 'N/A';
            if (t.resolvedAt && t.createdAt) {
                const diffMs = t.resolvedAt.getTime() - t.createdAt.getTime();
                const diffHrs = (diffMs / (1000 * 60 * 60)).toFixed(2);
                timeToResolution = `${diffHrs} hours`;
            }

            const currentAssignee = assignee;
            const createdBy = t.user?.name || 'System';
            const lastUpdated = t.updatedAt ? t.updatedAt.toISOString().replace('T', ' ').substring(0, 19) : '';
            const completionNotes = t.unit?.status_note || 'N/A';

            return {
                ticketNum,
                submitted,
                acknowledged,
                resolved,
                status,
                categoryType,
                priority,
                building,
                unitNumber,
                tenantName,
                assignee,
                timeToAssignment,
                timeToResolution,
                currentAssignee,
                createdBy,
                lastUpdated,
                completionNotes
            };
        });

        // Build professional Excel XML/HTML structure with auto-row height (removed tr height attributes)
        let xlsContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>Tickets Operational Report</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  th {
    font-family: Arial, sans-serif;
    font-size: 11pt;
    font-weight: bold;
    color: #0f172a;
    background-color: #cbd5e1;
    border: 0.5pt solid #94a3b8;
    text-align: left;
    vertical-align: middle;
  }
  td {
    font-family: Arial, sans-serif;
    font-size: 10pt;
    border: 0.5pt solid #cbd5e1;
    vertical-align: middle;
  }
  .text-cell {
    mso-number-format:"\\@";
  }
  .date-cell {
    mso-number-format:"yyyy-mm-dd hh\\:mm\\:ss";
  }
</style>
</head>
<body>
<table>
  <colgroup>
    <col width="110"> <!-- Ticket Number -->
    <col width="160"> <!-- Date Submitted -->
    <col width="160"> <!-- Date Acknowledged -->
    <col width="160"> <!-- Date Resolved -->
    <col width="110"> <!-- Status -->
    <col width="180"> <!-- Category / Type -->
    <col width="90">  <!-- Priority -->
    <col width="140"> <!-- Building -->
    <col width="110"> <!-- Unit Number -->
    <col width="160"> <!-- Tenant Name -->
    <col width="200"> <!-- Assigned Employee -->
    <col width="200"> <!-- Time to Assignment -->
    <col width="200"> <!-- Total Time to Resolution -->
    <col width="200"> <!-- Current Assignee -->
    <col width="160"> <!-- Created By -->
    <col width="160"> <!-- Last Updated Date -->
    <col width="240"> <!-- Completion Notes -->
  </colgroup>
  <thead>
    <tr>
      <th>Ticket Number</th>
      <th>Date and Time Submitted</th>
      <th>Date and Time Acknowledged</th>
      <th>Date and Time Completed / Closed / Resolved</th>
      <th>Current Status</th>
      <th>Ticket Category / Type</th>
      <th>Priority</th>
      <th>Building</th>
      <th>Unit Number</th>
      <th>Tenant Name</th>
      <th>Assigned Employee / Contractor</th>
      <th>Time from Submission to Assignment</th>
      <th>Total Time to Resolution</th>
      <th>Current Assignee</th>
      <th>Created By</th>
      <th>Last Updated Date</th>
      <th>Completion Notes</th>
    </tr>
  </thead>
  <tbody>
`;

        rows.forEach(r => {
            xlsContent += `
    <tr>
      <td class="text-cell" style="font-weight: bold; color: #4f46e5;">${r.ticketNum}</td>
      <td class="date-cell">${r.submitted}</td>
      <td class="date-cell">${r.acknowledged}</td>
      <td class="date-cell">${r.resolved}</td>
      <td class="text-cell" style="font-weight: bold;">${r.status}</td>
      <td class="text-cell">${r.categoryType}</td>
      <td class="text-cell">${r.priority}</td>
      <td class="text-cell">${r.building}</td>
      <td class="text-cell">${r.unitNumber}</td>
      <td class="text-cell">${r.tenantName}</td>
      <td class="text-cell">${r.assignee}</td>
      <td class="text-cell">${r.timeToAssignment}</td>
      <td class="text-cell">${r.timeToResolution}</td>
      <td class="text-cell">${r.currentAssignee}</td>
      <td class="text-cell">${r.createdBy}</td>
      <td class="date-cell">${r.lastUpdated}</td>
      <td class="text-cell">${r.completionNotes}</td>
    </tr>`;
        });

        xlsContent += `
  </tbody>
</table>
</body>
</html>`;

        res.setHeader('Content-Type', 'application/vnd.ms-excel');
        res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${new Date().toISOString().slice(0, 10)}.xls`);
        res.status(200).send(xlsContent);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error generating tickets export' });
    }
};
