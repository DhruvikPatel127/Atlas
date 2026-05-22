const prometheus = require('prom-client');
const winston = require('winston');
const Sentry = require("@sentry/node");

// Prometheus metrics
const register = new prometheus.Registry();
prometheus.collectDefaultMetrics({ register });

const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});
register.registerMetric(httpRequestDuration);

const aiRequestCounter = new prometheus.Counter({
  name: 'ai_requests_total',
  help: 'Total AI API requests',
  labelNames: ['feature', 'model', 'status'],
});
register.registerMetric(aiRequestCounter);

const activeWebSocketConnections = new prometheus.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
});
register.registerMetric(activeWebSocketConnections);

const aiTokensUsed = new prometheus.Counter({
  name: 'ai_tokens_total',
  help: 'Total tokens used in AI API calls',
  labelNames: ['feature', 'token_type'],
});
register.registerMetric(aiTokensUsed);

// Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Sentry error tracking
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    environment: process.env.NODE_ENV
  });
}

// Express middleware
const monitoringMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;
    httpRequestDuration
      .labels(req.method, route, res.statusCode)
      .observe(duration);
  });

  next();
};

module.exports = {
  logger,
  monitoringMiddleware,
  aiRequestCounter,
  activeWebSocketConnections,
  aiTokensUsed,
  httpRequestDuration,
  Sentry,
  register
};
