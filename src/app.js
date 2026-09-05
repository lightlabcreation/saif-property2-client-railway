const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fileUpload = require('express-fileupload');
const os = require('os');
const routes = require('./routes');
const internalRoutes = require('./modules/internal/internal.routes');

const app = express();








// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "https://api.cloudinary.com", "http://localhost:5000", "http://localhost:5173", "https://*.up.railway.app"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'self'", "blob:", "https://res.cloudinary.com"],
      frameSrc: ["'self'", "blob:", "https://res.cloudinary.com"],
      upgradeInsecureRequests: null,
    },
  },
}));

const allowedOrigins = require('./config/allowedOrigins');


app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server or curl requests
      if (!origin) return callback(null, true);

      // Allow all origins in development
      if (process.env.NODE_ENV === 'development' || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error("CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],
  })
);
// Configure this properly for production later
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('dev'));
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
  next();
});

// File Upload Middleware
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: os.tmpdir(),
  createParentPath: true,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
}));



app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Property Saif Backend is Running 🚀",
  });
});


// Register Tenant Routes
app.use('/api/tenant/auth', tenantAuthRoutes);
app.use('/api/tenant/dashboard', tenantDashboardRoutes);
app.use('/api/tenant/lease', tenantLeaseRoutes);
app.use('/api/tenant/invoices', tenantInvoiceRoutes);
app.use('/api/tenant/payments', tenantPaymentRoutes);
app.use('/api/tenant/documents', tenantDocumentRoutes);
app.use('/api/tenant/insurance', tenantInsuranceRoutes);
app.use('/api/tenant/vehicles', tenantVehicleRoutes);
app.use('/api/tenant/tickets', tenantTicketRoutes);
app.use('/api/tenant/reports', tenantReportRoutes);

// Register Internal Routes
app.use('/api/internal', internalRoutes);


// Routes
app.use('/api', routes);
app.use('/uploads', express.static('uploads'));

// Error Handling
const globalErrorHandler = require('./middlewares/globalError.middleware');
const AppError = require('./utils/AppError');

// Error Handling
// Handle undefined routes
app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
