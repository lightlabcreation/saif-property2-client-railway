const prisma = require('../../config/prisma');
const https = require('https');
const { uploadToCloudinary } = require('../../config/cloudinary');

// GET /api/admin/tickets
exports.getAllTickets = async (req, res) => {
    try {
        const { userId, startDate, endDate, propertyId, status, category, priority, assignedToId } = req.query;

        const where = {};
        if (userId) {
            where.userId = parseInt(userId);
        }
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
        if (propertyId && propertyId !== 'all') {
            where.propertyId = parseInt(propertyId);
        }
        if (status && status !== 'All') {
            where.status = status;
        }
        if (category) {
            where.category = category;
        }
        if (priority && priority !== 'All') {
            where.priority = priority;
        }
        if (assignedToId) {
            where.assignedToId = parseInt(assignedToId);
        }

        const tickets = await prisma.ticket.findMany({
            where,
            include: {
                user: true,
                unit: { include: { property: true } },
                property: true,
                inspection: { include: { inspector: true } },
                assignedTo: true,
                assignedBy: true
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
                assignedToName: t.assignedTo?.name || 'Unassigned',
                assignedToId: t.assignedToId,
                assignedByName: t.assignedBy?.name || 'N/A',
                assignedById: t.assignedById,
                assignedAt: t.assignedAt ? t.assignedAt.toISOString() : null,
                completedAt: t.completedAt ? t.completedAt.toISOString() : null,
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

        const updateObj = { status };
        if (status === 'Resolved') {
            updateObj.resolvedAt = new Date();
        } else if (status === 'Completed') {
            updateObj.completedAt = new Date();
        }

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: updateObj
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
        const { subject, description, priority, category, status, propertyId, unitId, tenantId, assignedToId } = req.body;

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
            if (status === 'Completed') {
                updateData.completedAt = new Date();
            }
        }

        if (assignedToId !== undefined) {
            if (assignedToId === null || assignedToId === '' || assignedToId === 0) {
                updateData.assignedToId = null;
                updateData.assignedById = null;
                updateData.assignedAt = null;
            } else {
                updateData.assignedToId = parseInt(assignedToId);
                // Track who assigned it and when
                updateData.assignedById = req.user?.id || null;
                updateData.assignedAt = new Date();
                // Automatically transition status to Assigned if currently New/Open
                const currentTicket = await prisma.ticket.findUnique({ where: { id: parseInt(id) } });
                if (currentTicket && (!status || currentTicket.status === 'New' || currentTicket.status === 'Open')) {
                    updateData.status = 'Assigned';
                }
            }
        }

        const updated = await prisma.ticket.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Trigger Auto-Progression for Unit Prep Flow if applicable
        if (updated.unitId && updated.status && ['Closed', 'Completed', 'Resolved'].includes(updated.status)) {
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
        const { startDate, endDate, propertyId, status, category, priority, assignedToId, userId, format } = req.query;

        const where = {};
        if (userId) {
            where.userId = parseInt(userId);
        }
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
        if (propertyId && propertyId !== 'all') {
            where.propertyId = parseInt(propertyId);
        }
        if (status && status !== 'All') {
            where.status = status;
        }
        if (category) {
            where.category = category;
        }
        if (priority && priority !== 'All') {
            where.priority = priority;
        }
        if (assignedToId) {
            where.assignedToId = parseInt(assignedToId);
        }

        const tickets = await prisma.ticket.findMany({
            where,
            include: {
                user: true,
                unit: { include: { property: true } },
                property: true,
                inspection: { include: { inspector: true } },
                assignedTo: true,
                assignedBy: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatFriendlyDuration = (ms) => {
            if (!ms || isNaN(ms) || ms < 0) return 'N/A';
            const totalMinutes = Math.floor(ms / (1000 * 60));
            const totalHours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            const hours = totalHours % 24;
            const days = Math.floor(totalHours / 24);

            let parts = [];
            if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
            if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
            if (mins > 0 || parts.length === 0) parts.push(`${mins} min`);
            return parts.join(' ');
        };

        const rows = tickets.map(t => {
            const ticketNum = `T-${t.id + 1000}`;
            const submitted = t.createdAt ? t.createdAt.toISOString().replace('T', ' ').substring(0, 19) : '';
            
            const isAcknowledged = ['In Progress', 'Resolved', 'Closed', 'Completed', 'Assigned'].includes(t.status) || t.assignedAt;
            const acknowledged = t.assignedAt 
                ? t.assignedAt.toISOString().replace('T', ' ').substring(0, 19)
                : (isAcknowledged && t.updatedAt ? t.updatedAt.toISOString().replace('T', ' ').substring(0, 19) : 'N/A');

            const resolved = t.completedAt 
                ? t.completedAt.toISOString().replace('T', ' ').substring(0, 19)
                : (t.resolvedAt ? t.resolvedAt.toISOString().replace('T', ' ').substring(0, 19) : 'N/A');
            
            const statusStr = t.status || 'Open';
            
            const rawCat = t.category || t.type || 'N/A';
            const categoryType = rawCat.charAt(0).toUpperCase() + rawCat.slice(1).toLowerCase();
            
            const priorityStr = t.priority || 'Low';
            const building = t.property?.name || t.unit?.property?.name || 'N/A';
            const unitNumber = t.unit?.unitNumber || 'N/A';
            const tenantName = t.user?.name || 'N/A';
            
            const assignee = t.assignedTo?.name || t.inspection?.inspector?.name || 'Unassigned';
            const assignedBy = t.assignedBy?.name || 'N/A';
            const dateAssigned = t.assignedAt ? t.assignedAt.toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
            
            let timeToAssignment = 'N/A';
            let responseTimeHours = 'N/A';
            const assignTime = t.assignedAt || (isAcknowledged ? t.updatedAt : null);
            if (assignTime && t.createdAt) {
                const diffMs = assignTime.getTime() - t.createdAt.getTime();
                timeToAssignment = formatFriendlyDuration(diffMs);
                responseTimeHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
            }

            let timeToResolution = 'N/A';
            let resolutionTimeHours = 'N/A';
            const compTime = t.completedAt || t.resolvedAt;
            if (compTime && t.createdAt) {
                const diffMs = compTime.getTime() - t.createdAt.getTime();
                timeToResolution = formatFriendlyDuration(diffMs);
                resolutionTimeHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
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
                status: statusStr,
                categoryType,
                priority: priorityStr,
                building,
                unitNumber,
                tenantName,
                assignee,
                assignedBy,
                dateAssigned,
                timeToAssignment,
                responseTimeHours,
                timeToResolution,
                resolutionTimeHours,
                currentAssignee,
                createdBy,
                lastUpdated,
                completionNotes
            };
        });

        // 1. CSV Format
        if (format === 'csv') {
            const headers = [
                'S.No', 'Ticket Number', 'Date and Time Submitted', 'Date and Time Acknowledged', 
                'Date and Time Completed / Closed / Resolved', 'Current Status', 'Ticket Category / Type', 
                'Priority', 'Building', 'Unit Number', 'Tenant Name', 'Assigned Employee / Contractor',
                'Assigned By', 'Date and Time Assigned',
                'Time from Submission to Assignment', 'Response Time (Hours)', 
                'Total Time to Resolution', 'Resolution Time (Hours)', 'Current Assignee', 
                'Created By', 'Last Updated Date', 'Completion Notes'
            ];

            const csvRows = [headers.join(',')];
            rows.forEach((r, idx) => {
                const values = [
                    (idx + 1).toString(), r.ticketNum, r.submitted, r.acknowledged, r.resolved, r.status, r.categoryType,
                    r.priority, r.building, r.unitNumber, r.tenantName, r.assignee, r.assignedBy, r.dateAssigned,
                    r.timeToAssignment, r.responseTimeHours, r.timeToResolution, r.resolutionTimeHours,
                    r.currentAssignee, r.createdBy, r.lastUpdated, r.completionNotes
                ].map(val => {
                    const clean = (val || '').toString().replace(/"/g, '""');
                    return clean.includes(',') || clean.includes('\n') || clean.includes('"') ? `"${clean}"` : clean;
                });
                csvRows.push(values.join(','));
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${new Date().toISOString().slice(0, 10)}.csv`);
            return res.status(200).send(csvRows.join('\n'));
        }

        // 2. Excel XML/HTML Format
        let xlsContent = `<html>
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
  .number-cell {
    mso-number-format:"0\\.00";
  }
</style>
</head>
<body>
<table>
  <colgroup>
    <col width="60"> <!-- S.No -->
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
    <col width="160"> <!-- Assigned By -->
    <col width="160"> <!-- Date Assigned -->
    <col width="200"> <!-- Time to Assignment -->
    <col width="150"> <!-- Response Time Hours -->
    <col width="200"> <!-- Total Time to Resolution -->
    <col width="150"> <!-- Resolution Time Hours -->
    <col width="200"> <!-- Current Assignee -->
    <col width="160"> <!-- Created By -->
    <col width="160"> <!-- Last Updated Date -->
    <col width="240"> <!-- Completion Notes -->
  </colgroup>
  <thead>
    <tr>
      <th>S.No</th>
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
      <th>Assigned By</th>
      <th>Date and Time Assigned</th>
      <th>Time from Submission to Assignment</th>
      <th>Response Time (Hours)</th>
      <th>Total Time to Resolution</th>
      <th>Resolution Time (Hours)</th>
      <th>Current Assignee</th>
      <th>Created By</th>
      <th>Last Updated Date</th>
      <th>Completion Notes</th>
    </tr>
  </thead>
  <tbody>`;

        rows.forEach((r, idx) => {
            xlsContent += `<tr><td class="text-cell" style="text-align: center;">${idx + 1}</td><td class="text-cell" style="font-weight: bold; color: #4f46e5;">${r.ticketNum}</td><td class="date-cell">${r.submitted}</td><td class="date-cell">${r.acknowledged}</td><td class="date-cell">${r.resolved}</td><td class="text-cell" style="font-weight: bold;">${r.status}</td><td class="text-cell">${r.categoryType}</td><td class="text-cell">${r.priority}</td><td class="text-cell">${r.building}</td><td class="text-cell">${r.unitNumber}</td><td class="text-cell">${r.tenantName}</td><td class="text-cell">${r.assignee}</td><td class="text-cell">${r.assignedBy}</td><td class="date-cell">${r.dateAssigned}</td><td class="text-cell">${r.timeToAssignment}</td><td class="number-cell">${r.responseTimeHours}</td><td class="text-cell">${r.timeToResolution}</td><td class="number-cell">${r.resolutionTimeHours}</td><td class="text-cell">${r.currentAssignee}</td><td class="text-cell">${r.createdBy}</td><td class="date-cell">${r.lastUpdated}</td><td class="text-cell">${r.completionNotes}</td></tr>`;
        });

        xlsContent += `</tbody></table></body></html>`;

        res.setHeader('Content-Type', 'application/vnd.ms-excel');
        res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${new Date().toISOString().slice(0, 10)}.xls`);
        res.status(200).send(xlsContent);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error generating tickets export' });
    }
};
