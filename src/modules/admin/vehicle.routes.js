const express = require('express');
const router = express.Router();
const vehicleController = require('./vehicle.controller');

const { checkPermission } = require('../../middlewares/permission.middleware');

router.get('/', checkPermission('Vehicles', 'view'), vehicleController.getAllVehicles);
router.get('/:id', checkPermission('Vehicles', 'view'), vehicleController.getVehicleById);
router.post('/', checkPermission('Vehicles', 'add'), vehicleController.createVehicle);
router.put('/:id', checkPermission('Vehicles', 'edit'), vehicleController.updateVehicle);
router.delete('/:id', checkPermission('Vehicles', 'delete'), vehicleController.deleteVehicle);

module.exports = router;
