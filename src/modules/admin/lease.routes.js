const express = require("express");
const router = express.Router();
const leaseController = require("./lease.controller");
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.get("/", leaseController.getLeaseHistory);
router.post("/", leaseController.createLease);
router.get("/units-with-tenants", leaseController.getUnitsWithTenants);
router.get("/active/:unitId", leaseController.getActiveLease);
router.post("/:id/activate", leaseController.activateLease);
router.post("/:id/send-credentials", leaseController.sendCredentials);
router.put("/:id", leaseController.updateLease);
router.delete("/:id", leaseController.deleteLease);

// GET locker rentals for a specific lease
router.get("/:id/lockers", async (req, res) => {
    try {
        const leaseId = parseInt(req.params.id);
        const rentals = await prisma.lockerRental.findMany({
            where: { leaseId },
            include: { locker: { include: { property: true } } },
            orderBy: { startDate: 'asc' }
        });
        res.json(rentals);
    } catch (err) {
        console.error('Failed to fetch lease lockers', err);
        res.status(500).json({ error: 'Failed to fetch locker rentals' });
    }
});

module.exports = router;
