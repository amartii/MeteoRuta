const Redis = require('ioredis');
const logger = require('../utils/logger');

let redis;

try {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    lazyConnect: true
  });

  redis.on('error', (err) => {
    logger.error('Redis connection error:', err);
  });

  redis.on('connect', () => {
    logger.info('Redis connected for rate limiting');
  });
} catch (error) {
  logger.error('Failed to initialize Redis:', error);
  redis = null;
}

const rateLimiter = async (req, res, next) => {
  try {
    // Si Redis no está disponible, permitir el request pero loguearlo
    if (!redis) {
      logger.warn('Rate limiter bypassed - Redis not available');
      return next();
    }

    const userId = req.body?.from?.id || req.body?.message?.from?.id || req.ip;
    const key = `rate_limit:${userId}`;

    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30;

    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, Math.ceil(windowMs / 1000));
    }

    if (current > maxRequests) {
      const ttl = await redis.ttl(key);

      logger.warn('Rate limit exceeded:', {
        userId,
        current,
        maxRequests,
        resetIn: ttl
      });

      return res.status(429).json({
        error: 'Too many requests',
        message: `Límite de ${maxRequests} requests por minuto excedido`,
        resetTime: ttl,
        current,
        limit: maxRequests
      });
    }

    // Agregar headers informativos
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
    res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + (windowMs / 1000));

    next();
  } catch (error) {
    // Si hay error en Redis, permitir el request pero loguearlo
    logger.error('Rate limiter error:', error);
    next();
  }
};

module.exports = rateLimiter;
