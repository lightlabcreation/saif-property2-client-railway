const prisma = require('../../config/prisma');

const executeAiSql = async (req, res) => {
    try {
        const { sql } = req.body;
        const serviceToken = req.headers['x-service-token'];
        const validToken = process.env.INTERNAL_SERVICE_TOKEN || 'saif-ai-super-secret-token';

        if (serviceToken !== validToken) {
            return res.status(403).json({ error: "Unauthorized. Invalid service token." });
        }

        if (!sql) {
            return res.status(400).json({ error: "SQL query is required." });
        }

        console.log(`Executing AI Proxy SQL on Backend 2...`);
        const resultData = await prisma.$queryRawUnsafe(sql);

        return res.status(200).json({
            success: true,
            data: resultData
        });

    } catch (error) {
        console.error("Internal AI Controller Error:", error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || "An error occurred while executing proxied AI request." 
        });
    }
};

module.exports = {
    executeAiSql
};
