const express = require('express');
const router = express.Router();
const lockerController = require('./locker.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Apply authentication middleware to all routes
router.use(authenticate);

// Locker inventory management
router.get('/', lockerController.getLockers);
router.post('/', lockerController.createLocker);
router.put('/:id', lockerController.updateLocker);
router.delete('/:id', lockerController.deleteLocker);

module.exports = router;
