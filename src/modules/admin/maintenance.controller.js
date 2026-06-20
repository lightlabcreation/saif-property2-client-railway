const prisma = require('../../config/prisma');

// GET /api/admin/maintenance
exports.getTasks = async (req, res) => {
    try {
        const { propertyId } = req.query;
        const whereClause = {};
        if (propertyId && propertyId !== 'all') {
            whereClause.propertyId = parseInt(propertyId);
        }

        const tasks = await prisma.maintenanceTask.findMany({
            where: whereClause,
            include: { property: true },
            orderBy: { dueDate: 'asc' }
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Clear time for safe comparison

        const formatted = tasks.map(t => {
            let resolvedStatus = t.status || 'Upcoming';
            const taskDate = t.dueDate ? new Date(t.dueDate) : null;
            if (taskDate) {
                taskDate.setHours(0, 0, 0, 0);
            }

            if (resolvedStatus !== 'Completed' && taskDate && taskDate < today) {
                resolvedStatus = 'Overdue';
            }

            return {
                id: `MNT-${t.id + 100}`,
                dbId: t.id,
                name: t.name,
                building: t.property ? t.property.name : 'General',
                buildingId: t.propertyId,
                type: t.type,
                frequency: t.frequency,
                dueDate: t.dueDate?.toISOString().split('T')[0] || 'N/A',
                vendor: t.vendor,
                status: resolvedStatus,
                notes: t.notes
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/maintenance
exports.createTask = async (req, res) => {
    try {
        const { name, buildingId, type, frequency, dueDate, vendor, notes } = req.body;

        // Resolve Target Property IDs (supports "all" and comma-separated ids)
        let targetPropertyIds = [];
        if (buildingId === 'all') {
            const allProps = await prisma.property.findMany({ select: { id: true } });
            targetPropertyIds = allProps.map(p => p.id);
        } else if (buildingId) {
            targetPropertyIds = buildingId.toString().split(',').map(id => parseInt(id.trim())).filter(Boolean);
        }

        if (targetPropertyIds.length === 0) {
            targetPropertyIds = [null]; // Fallback if no building selected
        }

        const createdTasks = [];
        for (const pid of targetPropertyIds) {
            const newTask = await prisma.maintenanceTask.create({
                data: {
                    name,
                    propertyId: pid,
                    type,
                    frequency,
                    dueDate: new Date(dueDate),
                    vendor,
                    status: 'Upcoming',
                    notes
                }
            });
            createdTasks.push(newTask);
        }

        res.status(201).json(createdTasks.length === 1 ? createdTasks[0] : { success: true, count: createdTasks.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating task' });
    }
};

// PUT /api/admin/maintenance/:id
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name, notes, propertyId, type, frequency, dueDate, vendor } = req.body;

        const data = {};
        if (status) data.status = status;
        if (name) data.name = name;
        if (notes !== undefined) data.notes = notes;
        if (propertyId) data.propertyId = parseInt(propertyId);
        if (type) data.type = type;
        if (frequency) data.frequency = frequency;
        if (dueDate) data.dueDate = new Date(dueDate);
        if (vendor !== undefined) data.vendor = vendor;

        const updated = await prisma.maintenanceTask.update({
            where: { id: parseInt(id) },
            data
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating task' });
    }
};

// DELETE /api/admin/maintenance/:id
exports.deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.maintenanceTask.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Task deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting task' });
    }
};
