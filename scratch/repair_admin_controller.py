import os

path = r'c:\Users\Saif16\Desktop\clinet_property\backend\src\modules\admin\admin.controller.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Keep lines 1 to 1299 (0-indexed: 0 to 1298)
new_lines = lines[:1299]

# Append the correct getUsers function
get_users_code = """
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
"""

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
    f.write(get_users_code)

print("Successfully repaired admin.controller.js")
