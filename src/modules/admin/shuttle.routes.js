const express = require('express');
const router = express.Router();
const shuttleController = require('./shuttle.controller');
const { checkPermission } = require('../../middlewares/permission.middleware');

// We use 'Shuttle' as the permission module name 

// 1. Daily Schedule (Trips)
router.get('/trips', checkPermission('Shuttle', 'view'), shuttleController.getTrips);
router.post('/trips', checkPermission('Shuttle', 'add'), shuttleController.createTrip);
router.put('/trips/:id', checkPermission('Shuttle', 'edit'), shuttleController.updateTrip);
router.delete('/trips/:id', checkPermission('Shuttle', 'delete'), shuttleController.deleteTrip);
router.post('/trips/duplicate', checkPermission('Shuttle', 'add'), shuttleController.duplicateDay);

// 2. Ride Requests (Inbox)
router.get('/requests', checkPermission('Shuttle', 'view'), shuttleController.getRequests);
router.post('/requests', checkPermission('Shuttle', 'add'), shuttleController.createRequest);
router.put('/requests/:id/status', checkPermission('Shuttle', 'edit'), shuttleController.updateRequestStatus);
router.post('/requests/:id/:action', checkPermission('Shuttle', 'edit'), shuttleController.updateRequestStatus); 

// 3. App Access / Drivers (Users)
router.get('/users', checkPermission('Shuttle', 'view'), shuttleController.getUsers);
router.post('/users', checkPermission('Shuttle', 'add'), shuttleController.createDriver);
router.put('/users/:id', checkPermission('Shuttle', 'edit'), shuttleController.updateUserStatus); // Specialized for status
router.patch('/users/:id/status', checkPermission('Shuttle', 'edit'), shuttleController.updateUserStatus); 
router.delete('/users/:id', checkPermission('Shuttle', 'delete'), shuttleController.deleteUser);
router.post('/send-invitation', checkPermission('Shuttle', 'add'), shuttleController.sendInvitation);
router.get('/email-templates', checkPermission('Shuttle', 'view'), shuttleController.getTemplates);
router.post('/invite-pms-tenants', checkPermission('Shuttle', 'add'), shuttleController.invitePMSTenants);
router.post('/bulk-status', checkPermission('Shuttle', 'edit'), shuttleController.bulkUpdateAccess);

// 4. Standard Locations
router.get('/trips/locations', checkPermission('Shuttle', 'view'), shuttleController.getLocations);
router.post('/trips/locations', checkPermission('Shuttle', 'add'), shuttleController.addLocation);
router.put('/trips/locations/:id', checkPermission('Shuttle', 'edit'), shuttleController.updateLocation);
router.delete('/trips/locations/:id', checkPermission('Shuttle', 'delete'), shuttleController.deleteLocation);

module.exports = router;
