const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

// Centralized Masteko DB client - used ONLY for user auth lookup
// All property data still uses the local property_2 DB via ../config/prisma
const masterPrisma = new PrismaClient({
    datasources: {
        db: { url: process.env.MASTER_DATABASE_URL }
    }
});

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

        // Look up user from Masteko (centralized) DB — users are managed there
        const user = await masterPrisma.user.findUnique({
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
        if (req.user.role !== role && req.user.role !== 'ADMIN') {
            if (req.user.role !== role) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }
        next();
    };
};
