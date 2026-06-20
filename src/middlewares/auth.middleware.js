const jwt = require('jsonwebtoken');

const prisma = require('../config/prisma');

exports.authenticate = async (req, res, next) => {
    let token = '';
    const authHeader = req.headers.authorization;

    if (authHeader) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) return res.status(401).json({ message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Forced Logout: Check if user is still active in the database
        const user = await prisma.user.findUnique({
            where: { id: decoded.id }
        });

        if (!user || !user.isActive) {
            return res.status(401).json({ message: 'Access revoked' });
        }

        // Attach DB user to ensure current roles/status are used
        req.user = user;
        next();
    } catch (err) {
        console.error('JWT Verification Error:', err.message);
        return res.status(401).json({ message: 'Invalid token: ' + err.message });
    }
};

exports.authorize = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role && req.user.role !== 'ADMIN') { // Admin can access all usually, but stick to role
            if (req.user.role !== role) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }
        next();
    };
};
