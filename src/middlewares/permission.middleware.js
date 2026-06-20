const prisma = require('../config/prisma');

exports.checkPermission = (moduleName, action) => {
    return async (req, res, next) => {
        try {
            // Get user info from auth middleware (req.user)
            const userId = req.user?.id;
            const userRole = req.user?.role;

            if (!userId) {
                return res.status(401).json({ message: 'Unauthorized: User ID missing' });
            }

            // ADMIN has full access (bypass)
            if (userRole === 'ADMIN') {
                return next();
            }

            // Only COWORKER role is subject to this granular permission check for now
            if (userRole !== 'COWORKER') {
                return next();
            }

            // Find the permission record for this user and specific module
            const permission = await prisma.permission.findFirst({
                where: {
                    userId: parseInt(userId),
                    moduleName: moduleName
                }
            });

            if (!permission) {
                return res.status(403).json({ 
                    message: `Access denied. You do not have permissions for the ${moduleName} section.` 
                });
            }

            // Map action to specific boolean field
            let hasAccess = false;
            const requiredAction = action.toLowerCase();

            if (requiredAction === 'view') hasAccess = permission.canView;
            else if (requiredAction === 'add') hasAccess = permission.canAdd;
            else if (requiredAction === 'edit') hasAccess = permission.canEdit;
            else if (requiredAction === 'delete') hasAccess = permission.canDelete;

            if (!hasAccess) {
                return res.status(403).json({ 
                    message: `Permission denied. You are not authorized to ${requiredAction} in the ${moduleName} section.` 
                });
            }

            next();
        } catch (error) {
            console.error('Check Permission Middleware Error:', error);
            res.status(500).json({ message: 'Internal server error checking permissions' });
        }
    };
};

exports.checkAnyPermission = (moduleNames, action) => {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            const userRole = req.user?.role;
            if (!userId) return res.status(401).json({ message: 'Unauthorized' });
            if (userRole === 'ADMIN' || userRole !== 'COWORKER') return next();

            const permissions = await prisma.permission.findMany({
                where: {
                    userId: parseInt(userId),
                    moduleName: { in: moduleNames }
                }
            });

            const hasAccess = permissions.some(p => {
                const requiredAction = action.toLowerCase();
                if (requiredAction === 'view') return p.canView;
                if (requiredAction === 'add') return p.canAdd;
                if (requiredAction === 'edit') return p.canEdit;
                if (requiredAction === 'delete') return p.canDelete;
                return false;
            });

            if (hasAccess) return next();
            
            return res.status(403).json({ 
                message: `Permission denied. You need access to any of: ${moduleNames.join(', ')}` 
            });
        } catch (error) {
            console.error('Check Any Permission Middleware Error:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
};
