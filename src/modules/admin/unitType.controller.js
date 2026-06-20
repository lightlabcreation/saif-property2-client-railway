const prisma = require('../../config/prisma');

// GET /api/admin/unit-types
exports.getUnitTypes = async (req, res) => {
    try {
        const types = await prisma.unitTypeRate.findMany({
            orderBy: { typeName: 'asc' }
        });
        res.json(types);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error fetching unit types' });
    }
};

// POST /api/admin/unit-types
exports.createUnitType = async (req, res) => {
    try {
        const { typeName, fullUnitRate, singleBedroomRate } = req.body;
        if (!typeName) return res.status(400).json({ message: 'Type Name is required' });

        const type = await prisma.unitTypeRate.create({
            data: {
                typeName,
                fullUnitRate: parseFloat(fullUnitRate) || 0,
                singleBedroomRate: parseFloat(singleBedroomRate) || 0
            }
        });
        res.status(201).json(type);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating unit type' });
    }
};

// PUT /api/admin/unit-types/:id
exports.updateUnitType = async (req, res) => {
    try {
        const { id } = req.params;
        const { fullUnitRate, singleBedroomRate } = req.body;

        const updated = await prisma.unitTypeRate.update({
            where: { id: parseInt(id) },
            data: {
                fullUnitRate: fullUnitRate !== undefined ? parseFloat(fullUnitRate) : undefined,
                singleBedroomRate: singleBedroomRate !== undefined ? parseFloat(singleBedroomRate) : undefined
            }
        });
        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating unit type' });
    }
};

// DELETE /api/admin/unit-types/:id
exports.deleteUnitType = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.unitTypeRate.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Unit type deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting unit type' });
    }
};
