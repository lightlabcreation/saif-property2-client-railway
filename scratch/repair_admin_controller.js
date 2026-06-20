const fs = require('fs');
const path = 'c:/Users/Saif16/Desktop/clinet_property/backend/src/modules/admin/admin.controller.js';

try {
    const content = fs.readFileSync(path, 'utf8');
    const lines = content.split('\n');

    // Keep lines up to 1299
    const newLines = lines.slice(0, 1299);

    const getUsersCode = `
exports.getUsers = async (req, res) => {
    try {
        const { role } = req.query;
        let where = {};

        if (role) {
            const roles = role.split(',');
            where = { role: { in: roles } };
        } else {
            where = { role: { in: ['ADMIN', 'COWORKER'] } };
        }

        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                name: true,
                email: true,
                role: true,
                title: true
            },
            orderBy: { name: 'asc' }
        });

        res.json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
`;

    fs.writeFileSync(path, newLines.join('\n') + getUsersCode);
    console.log('Successfully repaired admin.controller.js');
} catch (err) {
    console.error('Repair failed:', err);
    process.exit(1);
}
