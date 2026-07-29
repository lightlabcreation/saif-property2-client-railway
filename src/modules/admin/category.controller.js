const prisma = require('../../config/prisma');

const defaultCategories = [
    'General Maintenance',
    'Plumbing',
    'Electrical',
    'HVAC',
    'Appliance',
    'Cleaning',
    'Painting',
    'Carpentry',
    'Doors & Windows',
    'Locks & Keys',
    'Pest Control',
    'Landscaping',
    'Snow Removal',
    'Inspection Deficiency',
    'Move-In',
    'Move-Out',
    'Complaint',
    'Emergency',
    'Other'
];

exports.getCategories = async (req, res) => {
    try {
        let categories = await prisma.ticketCategory.findMany({
            orderBy: { name: 'asc' }
        });

        // Seed with default categories if empty
        if (categories.length === 0) {
            await prisma.ticketCategory.createMany({
                data: defaultCategories.map(name => ({ name })),
                skipDuplicates: true
            });
            categories = await prisma.ticketCategory.findMany({
                orderBy: { name: 'asc' }
            });
        }

        res.json(categories);
    } catch (e) {
        console.error('Error fetching ticket categories:', e);
        res.status(500).json({ message: 'Server error fetching categories' });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Category name is required' });
        }

        const trimmedName = name.trim();
        const existing = await prisma.ticketCategory.findUnique({
            where: { name: trimmedName }
        });

        if (existing) {
            return res.status(400).json({ message: 'Category already exists' });
        }

        const newCategory = await prisma.ticketCategory.create({
            data: { name: trimmedName }
        });

        res.status(201).json(newCategory);
    } catch (e) {
        console.error('Error creating ticket category:', e);
        res.status(500).json({ message: 'Server error creating category' });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const categoryId = parseInt(id);

        if (isNaN(categoryId)) {
            return res.status(400).json({ message: 'Invalid category ID' });
        }

        await prisma.ticketCategory.delete({
            where: { id: categoryId }
        });

        res.json({ message: 'Category deleted successfully' });
    } catch (e) {
        console.error('Error deleting ticket category:', e);
        res.status(500).json({ message: 'Server error deleting category' });
    }
};
