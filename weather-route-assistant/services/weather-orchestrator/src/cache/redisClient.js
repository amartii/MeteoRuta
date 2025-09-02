const Redis = require('ioredis');
const logger = require('../utils/logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connect();
  }

  connect() {
    try {
      this.client = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true,
        connectTimeout: 10000,
        commandTimeout: 5000
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected successfully');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        logger.error('Redis connection error:', err);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });

    } catch (error) {
      logger.error('Failed to initialize Redis client:', error);
      this.client = null;
    }
  }

  async get(key) {
    if (!this.isAvailable()) {
      logger.warn('Redis not available for GET operation');
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  async set(key, value, ttl = null) {
    if (!this.isAvailable()) {
      logger.warn('Redis not available for SET operation');
      return false;
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  async setex(key, ttl, value) {
    return await this.set(key, value, ttl);
  }

  async incr(key) {
    if (!this.isAvailable()) {
      logger.warn('Redis not available for INCR operation');
      return 1; // Fallback
    }

    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Redis INCR error for key ${key}:`, error);
      return 1; // Fallback
    }
  }

  async expire(key, seconds) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  async ttl(key) {
    if (!this.isAvailable()) {
      return -1;
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error(`Redis TTL error for key ${key}:`, error);
      return -1;
    }
  }

  async del(key) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  async keys(pattern) {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      return [];
    }
  }

  async flushall() {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client.flushall();
      logger.info('Redis FLUSHALL executed');
      return true;
    } catch (error) {
      logger.error('Redis FLUSHALL error:', error);
      return false;
    }
  }

  isAvailable() {
    return this.client && this.isConnected;
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      hasClient: !!this.client,
      status: this.client?.status || 'disconnected'
    };
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
        logger.info('Redis client disconnected gracefully');
      } catch (error) {
        logger.error('Error disconnecting Redis client:', error);
      }
    }
  }
}

// Exportar instancia singleton
module.exports = new RedisClient();
