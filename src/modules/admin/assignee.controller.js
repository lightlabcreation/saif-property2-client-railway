const prisma = require('../../config/prisma');

exports.getAssignees = async (req, res) => {
    try {
        const assignees = await prisma.ticketAssignee.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(assignees);
    } catch (e) {
        console.error('Error fetching ticket assignees:', e);
        res.status(500).json({ message: 'Server error fetching assignees' });
    }
};

exports.createAssignee = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Assignee name is required' });
        }

        const trimmedName = name.trim();
        const existing = await prisma.ticketAssignee.findUnique({
            where: { name: trimmedName }
        });

        if (existing) {
            return res.status(400).json({ message: 'Assignee already exists' });
        }

        const newAssignee = await prisma.ticketAssignee.create({
            data: { name: trimmedName }
        });

        res.status(201).json(newAssignee);
    } catch (e) {
        console.error('Error creating ticket assignee:', e);
        res.status(500).json({ message: 'Server error creating assignee' });
    }
};

exports.deleteAssignee = async (req, res) => {
    try {
        const { id } = req.params;
        const assigneeId = parseInt(id);

        if (isNaN(assigneeId)) {
            return res.status(400).json({ message: 'Invalid assignee ID' });
        }

        await prisma.ticketAssignee.delete({
            where: { id: assigneeId }
        });

        res.json({ message: 'Assignee deleted successfully' });
    } catch (e) {
        console.error('Error deleting ticket assignee:', e);
        res.status(500).json({ message: 'Server error deleting assignee' });
    }
};
