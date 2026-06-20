const prisma = require('../../config/prisma');

// GET /api/admin/service-items
exports.getServiceItems = async (req, res) => {
    try {
        const items = await prisma.serviceFeeItem.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(items);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error fetching service items' });
    }
};

// POST /api/admin/service-items
exports.createServiceItem = async (req, res) => {
    try {
        const { name, amount } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });

        const item = await prisma.serviceFeeItem.create({
            data: {
                name,
                amount: parseFloat(amount) || 0
            }
        });
        res.status(201).json(item);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating service item' });
    }
};

// PUT /api/admin/service-items/:id
exports.updateServiceItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, amount } = req.body;

        const updated = await prisma.serviceFeeItem.update({
            where: { id: parseInt(id) },
            data: {
                name,
                amount: amount !== undefined ? parseFloat(amount) : undefined
            }
        });
        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating service item' });
    }
};

// DELETE /api/admin/service-items/:id
exports.deleteServiceItem = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.serviceFeeItem.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Service item deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting service item' });
    }
};
