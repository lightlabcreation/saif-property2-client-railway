const axios = require('axios');
const catchAsync = require('../../utils/catchAsync');
const prisma = require('../../config/prisma');

// The external Shuttle API URL
// In production, this should be set in .env (e.g. process.env.SHUTTLE_API_URL || 'http://localhost:5001')
const SHUTTLE_API_URL = (process.env.SHUTTLE_API_URL || 'http://localhost:5001').replace(/^["'](.+)["']$/, '$1');

/**
 * Helper to proxy requests to the Morgan Shuttle Backend
 */
const proxyRequest = async (method, url, data = null, params = {}, headers = {}) => {
  try {
    const fullUrl = `${SHUTTLE_API_URL}/api${url}`;
    console.log(`[ShuttleProxy] Calling: ${method} ${fullUrl}`);
    const config = {
      method,
      url: fullUrl,
      params,
      timeout: 10000,
      headers: { 
        ...headers,
        'User-Agent': 'PMS-Backend-Proxy',
        'x-shuttle-proxy-key': process.env.SH_INTERNAL_KEY || 'shuttle_secret_123'
      }
    };

    if (data && method !== 'GET') {
      config.data = data;
      config.headers['Content-Type'] = 'application/json';
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`[ShuttleProxy] Error ${error.response.status}:`, error.response.data);
      throw { status: error.response.status, message: error.response.data.message || 'Shuttle API Error', data: error.response.data };
    }
    console.error(`[ShuttleProxy] Network Error:`, error.message);
    throw { status: 500, message: 'Shuttle Server Unreachable', error: error.message };
  }
};

/**
 * @desc    Get all active trips (Daily Schedule)
 * @route   GET /api/admin/shuttle/trips
 */
const getTrips = catchAsync(async (req, res) => {
  try {
    const { date } = req.query;
    const data = await proxyRequest('GET', '/trips', null, { date }); 
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Create a one-off trip or base trip
 * @route   POST /api/admin/shuttle/trips
 */
const createTrip = catchAsync(async (req, res) => {
  try {
    const { seats_total, ...rest } = req.body;
    const data = await proxyRequest('POST', '/trips', {
      ...rest,
      seats_total: parseInt(seats_total, 10) || 7
    });
    res.json({ success: true, trip: data.trip });
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Create a new ride request on behalf of a tenant
 * @route   POST /api/admin/shuttle/requests
 */
const createRequest = catchAsync(async (req, res) => {
  try {
    const { passengers, ...rest } = req.body;
    
    // Proxy to Shuttle Backend: POST /api/trips/request
    // We parse passengers to Int to ensure Prisma compatibility in the Shuttle backend
    const data = await proxyRequest('POST', '/trips/request', {
      ...rest,
      passengers: parseInt(passengers, 10) || 1,
      source: 'admin_pms'
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Get all ride requests (Inbox)
 * @route   GET /api/admin/shuttle/requests
 */
const getRequests = catchAsync(async (req, res) => {
  try {
    const data = await proxyRequest('GET', '/trips/requests'); 
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Approve or Reject a Ride Request
 * @route   PUT /api/admin/shuttle/requests/:id/status
 */
const updateRequestStatus = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const action = status === 'approved' ? 'approve' : 'reject';
    
    // Proxy the approval to the shuttle backend
    // Route: POST /api/trips/requests/:id/approve (or reject)
    const data = await proxyRequest('POST', `/trips/requests/${id}/${action}`);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Get all shuttle users/drivers for access management
 * @route   GET /api/admin/shuttle/users
 */
const getUsers = catchAsync(async (req, res) => {
  try {
    const data = await proxyRequest('GET', '/users');
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Delete a specific trip
 */
const deleteTrip = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const data = await proxyRequest('DELETE', `/trips/${id}`);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Update a specific trip
 * @route   PUT /api/admin/shuttle/trips/:id
 */
const updateTrip = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { seats_total, ...rest } = req.body;
    
    // We use PATCH because the Shuttle Backend expects PATCH for specific updates
    const data = await proxyRequest('PATCH', `/trips/${id}`, {
      ...rest,
      seats_total: seats_total !== undefined ? parseInt(seats_total, 10) : undefined
    });
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Duplicate a day's schedule to another date
 */
const duplicateDay = catchAsync(async (req, res) => {
  try {
    const { sourceDate, targetDate } = req.body;
    
    // 1. Get source trips
    const sourceData = await proxyRequest('GET', '/trips', null, { date: sourceDate });
    const sourceTrips = sourceData.trips || [];
    
    if (sourceTrips.length === 0) {
      return res.status(400).json({ success: false, message: 'No trips found on source date to duplicate.' });
    }

    // 2. Map trips to target date and remove IDs
    const newTrips = sourceTrips.map(t => ({
      time: t.time,
      date: targetDate,
      origin: t.origin,
      destination: t.destination,
      seats_total: t.seats_total,
      is_special: t.is_special
    }));

    // 3. Sequential Create (or handle bulk if shuttle backend supports it)
    const results = [];
    for (const tripData of newTrips) {
      const result = await proxyRequest('POST', '/trips', tripData);
      results.push(result.trip);
    }

    res.json({ success: true, duplicated: results.length, trips: results });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to duplicate day', error: error.message });
  }
});

/**
 * @desc    Create a new driver/staff user
 * @route   POST /api/admin/shuttle/users
 */
const createDriver = catchAsync(async (req, res) => {
  try {
    const data = await proxyRequest('POST', '/auth/internal-create', req.body);
    res.status(201).json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Update a shuttle user (Tenant or Driver)
 * @route   PUT /api/admin/shuttle/users/:id
 */
const updateUserStatus = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const data = await proxyRequest('PATCH', `/users/${id}/status`, req.body);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Delete a shuttle user
 * @route   DELETE /api/admin/shuttle/users/:id
 */
const deleteUser = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const data = await proxyRequest('DELETE', `/users/${id}`);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Send bulk shuttle invitations to users
 */
/**
 * @desc    Get all available email templates for invitations
 */
const getTemplates = catchAsync(async (req, res) => {
  try {
    const templates = await prisma.emailTemplate.findMany({
      where: { type: 'INVITATION' },
      select: { id: true, name: true, subject: true }
    });
    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' });
  }
});

/**
 * @desc    Invite selected PMS tenants to the Shuttle app
 */
const invitePMSTenants = catchAsync(async (req, res) => {
  try {
    const { tenantIds, templateId } = req.body;
    const EmailService = require('../../services/email.service');
    const crypto = require('crypto');

    if (!tenantIds || !Array.isArray(tenantIds) || tenantIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No tenants selected' });
    }

    // 1. Fetch tenants and template
    const [tenants, template] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: tenantIds.map(id => parseInt(id)) } } }),
      templateId ? prisma.emailTemplate.findUnique({ where: { id: parseInt(templateId) } }) : null
    ]);

    const results = [];
    for (const tenant of tenants) {
      if (!tenant.email) continue;

      // 2. Proxied Create in Shuttle Backend
      // This ensures they have an account in the mobile app system
      try {
        await proxyRequest('POST', '/auth/internal-create', {
          name: tenant.name || `${tenant.firstName} ${tenant.lastName}`,
          email: tenant.email,
          phone: tenant.phone || '',
          role: 'tenant',
          source: 'PMS_INVITE'
        });

        // 3. Send Email
        const baseUrl = process.env.FRONTEND_URL || 'https://masteko-pm.ca';
        const inviteLink = `${baseUrl}/tenant/invite`; // Generic link or specific one if needed
        
        let subject = template?.subject || 'Invitation to Morgan Shuttle App';
        let body = template?.body || `Hello ${tenant.name}, \n\nYou have been invited to join the Morgan Shuttle app. \n\nGet started here: ${inviteLink}`;

        // Simple variable replacement
        body = body.replace(/{{name}}/g, tenant.name || 'Tenant')
                   .replace(/{{link}}/g, inviteLink);

        await EmailService.sendEmail(tenant.email, subject, body, { isHtml: true });
        results.push({ email: tenant.email, status: 'success' });
      } catch (err) {
        results.push({ email: tenant.email, status: 'failed', error: err.message });
      }
    }

    res.json({ success: true, processed: results.length, details: results });
  } catch (error) {
    console.error('Invite PMS Tenants Error:', error);
    res.status(500).json({ success: false, message: 'Process failed' });
  }
});

const sendInvitation = catchAsync(async (req, res) => {
  try {
    const data = await proxyRequest('POST', '/auth/send-invitation', req.body);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

module.exports = {
  proxyRequest,
  getTrips,
  createTrip,
  deleteTrip,
  duplicateDay,
  getRequests,
  updateRequestStatus,
  getUsers,
  updateTrip,
  createRequest,
  createDriver,
  updateUserStatus,
  deleteUser,
  sendInvitation,
  getTemplates,
  invitePMSTenants,
  bulkUpdateAccess: catchAsync(async (req, res) => {
    try {
      const { userIds, status } = req.body;
      if (!userIds || !Array.isArray(userIds)) {
        return res.status(400).json({ success: false, message: 'Invalid userIds' });
      }

      // Call Shuttle's Bulk Status Endpoint directly - Much more efficient!
      const data = await proxyRequest('POST', '/users/bulk-status', { ids: userIds, status });
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json(error);
    }
  }),
  getLocations: catchAsync(async (req, res) => {
    try {
      const data = await proxyRequest('GET', '/trips/locations');
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json(error);
    }
  }),
  addLocation: catchAsync(async (req, res) => {
    try {
      const data = await proxyRequest('POST', '/trips/locations', req.body);
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json(error);
    }
  }),
  updateLocation: catchAsync(async (req, res) => {
    try {
      const { id } = req.params;
      const data = await proxyRequest('PUT', `/trips/locations/${id}`, req.body);
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json(error);
    }
  }),
  deleteLocation: catchAsync(async (req, res) => {
    try {
      const { id } = req.params;
      const data = await proxyRequest('DELETE', `/trips/locations/${id}`);
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json(error);
    }
  })
};
