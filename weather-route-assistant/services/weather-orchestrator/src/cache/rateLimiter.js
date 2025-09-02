const RedisClient = require('./redisClient');
const logger = require('../utils/logger');

class RateLimiter {
  constructor() {
    // Límites por API (por hora)
    this.limits = {
      meteoblue: { max: 200, window: 3600 }, // ~5k/año ≈ 200/hora máx
      aemet: { max: 500, window: 3600 },     // Generoso para uso público
      windy: { max: 400, window: 3600 },     // 10k/día ≈ 400/hora
      meteored: { max: 300, window: 3600 }   // Conservador
    };
  }

  async checkRateLimit(apiName, userId = 'global') {
    try {
      const key = `ratelimit:${apiName}:${userId}`;
      const limit = this.limits[apiName];

      if (!limit) {
        logger.warn(`Unknown API for rate limiting: ${apiName}`);
        return true; // Permitir si no conocemos el API
      }

      const current = await RedisClient.incr(key);

      if (current === 1) {
        await RedisClient.expire(key, limit.window);
      }

      if (current > limit.max) {
        const ttl = await RedisClient.ttl(key);

        logger.warn(`Rate limit exceeded for ${apiName}:`, {
          current,
          max: limit.max,
          resetIn: ttl
        });

        return false;
      }

      logger.debug(`Rate limit check for ${apiName}:`, {
        current,
        max: limit.max,
        remaining: limit.max - current
      });

      return true;

    } catch (error) {
      logger.error(`Error checking rate limit for ${apiName}:`, error);
      return true; // En caso de error, permitir la request
    }
  }

  async getRemainingRequests(apiName, userId = 'global') {
    try {
      const key = `ratelimit:${apiName}:${userId}`;
      const limit = this.limits[apiName];

      if (!limit) return null;

      const current = await RedisClient.get(key);
      const used = current ? parseInt(current) : 0;

      return Math.max(0, limit.max - used);

    } catch (error) {
      logger.error(`Error getting remaining requests for ${apiName}:`, error);
      return null;
    }
  }

  async getResetTime(apiName, userId = 'global') {
    try {
      const key = `ratelimit:${apiName}:${userId}`;
      const ttl = await RedisClient.ttl(key);

      if (ttl > 0) {
        return new Date(Date.now() + ttl * 1000);
      }

      return null;

    } catch (error) {
      logger.error(`Error getting reset time for ${apiName}:`, error);
      return null;
    }
  }

  async getStatus(apiName, userId = 'global') {
    try {
      const limit = this.limits[apiName];
      if (!limit) return null;

      const remaining = await this.getRemainingRequests(apiName, userId);
      const resetTime = await this.getResetTime(apiName, userId);

      return {
        limit: limit.max,
        remaining,
        resetTime,
        windowSeconds: limit.window
      };

    } catch (error) {
      logger.error(`Error getting status for ${apiName}:`, error);
      return null;
    }
  }

  async logApiCall(apiName, success = true, responseTime = 0) {
    try {
      const timestamp = new Date().toISOString();
      const key = `api_stats:${apiName}:${timestamp.substring(0, 13)}`; // Por hora

      const stats = {
        calls: 1,
        successes: success ? 1 : 0,
        errors: success ? 0 : 1,
        totalResponseTime: responseTime,
        avgResponseTime: responseTime
      };

      // Obtener estadísticas existentes
      const existing = await RedisClient.get(key);
      if (existing) {
        const existingStats = JSON.parse(existing);
        stats.calls += existingStats.calls;
        stats.successes += existingStats.successes;
        stats.errors += existingStats.errors;
        stats.totalResponseTime += existingStats.totalResponseTime;
        stats.avgResponseTime = stats.totalResponseTime / stats.calls;
      }

      await RedisClient.setex(key, 86400, JSON.stringify(stats)); // Guardar por 24h

      logger.debug(`API call logged for ${apiName}:`, {
        success,
        responseTime,
        totalCalls: stats.calls
      });

    } catch (error) {
      logger.error(`Error logging API call for ${apiName}:`, error);
    }
  }

  async getApiStats(apiName, hours = 24) {
    try {
      const stats = {
        totalCalls: 0,
        successes: 0,
        errors: 0,
        avgResponseTime: 0,
        hourlyBreakdown: []
      };

      const now = new Date();

      for (let i = 0; i < hours; i++) {
        const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
        const key = `api_stats:${apiName}:${hour.toISOString().substring(0, 13)}`;

        const hourStats = await RedisClient.get(key);
        if (hourStats) {
          const parsed = JSON.parse(hourStats);
          stats.totalCalls += parsed.calls;
          stats.successes += parsed.successes;
          stats.errors += parsed.errors;
          stats.hourlyBreakdown.push({
            hour: hour.toISOString().substring(0, 13),
            ...parsed
          });
        }
      }

      if (stats.totalCalls > 0) {
        stats.successRate = (stats.successes / stats.totalCalls) * 100;
        stats.errorRate = (stats.errors / stats.totalCalls) * 100;
      }

      return stats;

    } catch (error) {
      logger.error(`Error getting API stats for ${apiName}:`, error);
      return null;
    }
  }

  async resetLimits(apiName, userId = 'global') {
    try {
      const key = `ratelimit:${apiName}:${userId}`;
      await RedisClient.del(key);

      logger.info(`Rate limits reset for ${apiName}, user: ${userId}`);
      return true;

    } catch (error) {
      logger.error(`Error resetting limits for ${apiName}:`, error);
      return false;
    }
  }

  getLimits() {
    return { ...this.limits };
  }

  setLimit(apiName, maxRequests, windowSeconds) {
    this.limits[apiName] = {
      max: maxRequests,
      window: windowSeconds
    };

    logger.info(`Rate limit updated for ${apiName}:`, this.limits[apiName]);
  }
}

module.exports = RateLimiter;
