const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const MeteoblueProvider = require('./providers/meteoblue');
const AemetProvider = require('./providers/aemet');
const WindyProvider = require('./providers/windy');
const MeteoredProvider = require('./providers/meteored');
const RateLimiter = require('./cache/rateLimiter');
const RedisClient = require('./cache/redisClient');
const logger = require('./utils/logger');

const app = express();
const port = process.env.PORT || 3002;

// Inicializar servicios
const rateLimiter = new RateLimiter();
const providers = {
  meteoblue: new MeteoblueProvider(),
  aemet: new AemetProvider(),
  windy: new WindyProvider(),
  meteored: new MeteoredProvider()
};

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { 
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const providerStatus = {};

  for (const [name, provider] of Object.entries(providers)) {
    providerStatus[name] = {
      available: provider.isAvailable(),
      configured: !!provider.apiKey
    };
  }

  res.json({ 
    status: 'OK', 
    service: 'weather-orchestrator',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    providers: providerStatus
  });
});

// Obtener clima para una ruta completa
app.post('/weather-for-route', async (req, res) => {
  try {
    const { waypoints, totalDistance, estimatedDuration } = req.body;

    if (!waypoints || !Array.isArray(waypoints) || waypoints.length === 0) {
      return res.status(400).json({ 
        error: 'Waypoints requeridos',
        details: 'Se requiere un array de waypoints válido'
      });
    }

    logger.info('Processing weather for route:', {
      waypoints: waypoints.length,
      distance: totalDistance,
      duration: estimatedDuration
    });

    const weatherResults = await getWeatherForWaypoints(waypoints);

    const response = {
      weatherData: weatherResults,
      summary: generateWeatherSummary(weatherResults),
      risks: identifyRisks(weatherResults),
      sources: getUsedSources(weatherResults),
      processedAt: new Date().toISOString()
    };

    logger.info('Weather processing completed:', {
      waypoints: waypoints.length,
      successfulResults: weatherResults.filter(r => r.weather).length,
      risks: response.risks.length
    });

    res.json(response);

  } catch (error) {
    logger.error('Error processing weather for route:', error);
    res.status(500).json({ 
      error: 'Error obteniendo datos meteorológicos',
      details: error.message 
    });
  }
});

// Obtener clima para un punto específico
app.post('/weather-for-point', async (req, res) => {
  try {
    const { lat, lon, timestamp } = req.body;

    if (!lat || !lon) {
      return res.status(400).json({ 
        error: 'Coordenadas requeridas',
        details: 'Se requieren latitud y longitud válidas'
      });
    }

    const targetTimestamp = timestamp ? new Date(timestamp) : new Date();

    logger.info('Processing weather for point:', { lat, lon, timestamp: targetTimestamp });

    const weatherData = await getWeatherForPoint({ lat, lon }, targetTimestamp);

    res.json({
      weather: weatherData,
      location: { lat, lon },
      timestamp: targetTimestamp.toISOString(),
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error processing weather for point:', error);
    res.status(500).json({ 
      error: 'Error obteniendo datos meteorológicos',
      details: error.message 
    });
  }
});

// Obtener estado de APIs
app.get('/providers-status', async (req, res) => {
  const status = {};

  for (const [name, provider] of Object.entries(providers)) {
    try {
      status[name] = {
        available: provider.isAvailable(),
        configured: !!provider.apiKey,
        rateLimitStatus: await rateLimiter.getStatus(name)
      };
    } catch (error) {
      status[name] = {
        available: false,
        configured: !!provider.apiKey,
        error: error.message
      };
    }
  }

  res.json(status);
});

// Funciones principales
async function getWeatherForWaypoints(waypoints) {
  const results = [];
  const now = new Date();

  for (let i = 0; i < waypoints.length; i++) {
    const waypoint = waypoints[i];

    try {
      // Calcular timestamp estimado para este waypoint
      const estimatedTime = new Date(now.getTime() + (waypoint.estimatedTimeFromStart || 0) * 60000);

      const weatherData = await getWeatherForPoint(waypoint, estimatedTime);

      results.push({ 
        waypoint, 
        weather: weatherData,
        timestamp: estimatedTime.toISOString()
      });

    } catch (error) {
      logger.error(`Error getting weather for waypoint ${i}:`, error);
      results.push({ 
        waypoint, 
        weather: null, 
        error: error.message,
        timestamp: new Date(now.getTime() + (waypoint.estimatedTimeFromStart || 0) * 60000).toISOString()
      });
    }
  }

  return results;
}

async function getWeatherForPoint(point, timestamp) {
  const weatherSources = [];
  const providerPriority = ['meteoblue', 'aemet', 'windy', 'meteored'];

  for (const providerName of providerPriority) {
    const provider = providers[providerName];

    if (!provider.isAvailable()) {
      continue;
    }

    try {
      // Verificar cache primero
      const cacheKey = `weather:${providerName}:${point.lat.toFixed(3)}:${point.lon.toFixed(3)}:${Math.floor(timestamp.getTime()/3600000)}`;
      const cached = await RedisClient.get(cacheKey);

      if (cached) {
        weatherSources.push({ 
          provider: providerName, 
          data: JSON.parse(cached), 
          cached: true 
        });
        continue;
      }

      // Verificar rate limit
      const canMakeRequest = await rateLimiter.checkRateLimit(providerName);
      if (!canMakeRequest) {
        logger.warn(`Rate limit exceeded for ${providerName}`);
        continue;
      }

      // Obtener datos frescos
      const weatherData = await provider.getWeatherForPoint(point.lat, point.lon, timestamp);

      // Cachear resultado por 30 minutos
      await RedisClient.setex(cacheKey, 1800, JSON.stringify(weatherData));

      weatherSources.push({ 
        provider: providerName, 
        data: weatherData, 
        cached: false 
      });

      // Lograr uso de API
      await rateLimiter.logApiCall(providerName, true);

    } catch (error) {
      logger.error(`${providerName} failed:`, error.message);
      await rateLimiter.logApiCall(providerName, false);
      continue;
    }
  }

  if (weatherSources.length === 0) {
    throw new Error('No se pudieron obtener datos meteorológicos de ninguna fuente');
  }

  return mergeWeatherData(weatherSources);
}

function mergeWeatherData(sources) {
  // Prioridad: meteoblue > aemet > windy > meteored
  const priority = { meteoblue: 4, aemet: 3, windy: 2, meteored: 1 };

  const sortedSources = sources.sort((a, b) => 
    priority[b.provider] - priority[a.provider]
  );

  const merged = {
    temperature: null,
    windSpeed: null,
    windDirection: null,
    precipitation: null,
    humidity: null,
    pressure: null,
    cloudCover: null,
    visibility: null,
    sources: sources.map(s => s.provider),
    primary: sortedSources[0].provider,
    confidence: calculateConfidence(sources),
    warnings: []
  };

  // Usar datos del proveedor con mayor prioridad
  const primaryData = sortedSources[0].data;
  Object.assign(merged, primaryData);

  // Detectar discrepancias entre fuentes
  if (sources.length > 1) {
    detectWeatherInconsistencies(merged, sources);
  }

  return merged;
}

function calculateConfidence(sources) {
  if (sources.length === 1) return 0.75;
  if (sources.length === 2) return 0.85;
  if (sources.length >= 3) return 0.95;
  return 0.5;
}

function detectWeatherInconsistencies(merged, sources) {
  if (sources.length < 2) return;

  const temperatures = sources.map(s => s.data.temperature).filter(t => t !== null);
  const windSpeeds = sources.map(s => s.data.windSpeed).filter(w => w !== null);

  // Detectar variación excesiva en temperatura
  if (temperatures.length >= 2) {
    const tempRange = Math.max(...temperatures) - Math.min(...temperatures);
    if (tempRange > 5) {
      merged.warnings.push(`Gran variación en temperatura entre fuentes: ${tempRange.toFixed(1)}°C`);
    }
  }

  // Detectar variación excesiva en viento
  if (windSpeeds.length >= 2) {
    const windRange = Math.max(...windSpeeds) - Math.min(...windSpeeds);
    if (windRange > 15) {
      merged.warnings.push(`Gran variación en viento entre fuentes: ${windRange.toFixed(1)} km/h`);
    }
  }
}

function generateWeatherSummary(weatherResults) {
  const validResults = weatherResults.filter(r => r.weather);

  if (validResults.length === 0) {
    return { message: 'No se pudieron obtener datos meteorológicos válidos' };
  }

  const temperatures = validResults.map(r => r.weather.temperature).filter(t => t !== null);
  const windSpeeds = validResults.map(r => r.weather.windSpeed).filter(w => w !== null);
  const precipitations = validResults.map(r => r.weather.precipitation).filter(p => p !== null);

  return {
    temperatureRange: {
      min: Math.min(...temperatures),
      max: Math.max(...temperatures),
      avg: Math.round(temperatures.reduce((a, b) => a + b, 0) / temperatures.length)
    },
    windRange: {
      min: Math.min(...windSpeeds),
      max: Math.max(...windSpeeds),
      avg: Math.round(windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length)
    },
    totalPrecipitation: precipitations.reduce((a, b) => a + b, 0),
    dataPoints: validResults.length,
    coveragePercentage: Math.round((validResults.length / weatherResults.length) * 100)
  };
}

function identifyRisks(weatherResults) {
  const risks = [];
  const riskThresholds = {
    windSpeed: 25, // km/h
    precipitation: 5, // mm/h
    temperature: { min: 0, max: 35 }, // °C
    visibility: 1000 // metros
  };

  weatherResults.forEach((result, index) => {
    if (!result.weather) return;

    const { weather, waypoint } = result;

    // Viento fuerte
    if (weather.windSpeed > riskThresholds.windSpeed) {
      risks.push({
        type: 'wind',
        level: weather.windSpeed > 40 ? 'high' : 'medium',
        message: `Viento fuerte: ${weather.windSpeed} km/h`,
        location: `Punto ${index + 1}`,
        coordinates: { lat: waypoint.lat, lon: waypoint.lon },
        timestamp: result.timestamp
      });
    }

    // Precipitación
    if (weather.precipitation > riskThresholds.precipitation) {
      risks.push({
        type: 'precipitation',
        level: weather.precipitation > 15 ? 'high' : 'medium',
        message: `Lluvia intensa: ${weather.precipitation} mm/h`,
        location: `Punto ${index + 1}`,
        coordinates: { lat: waypoint.lat, lon: waypoint.lon },
        timestamp: result.timestamp
      });
    }

    // Temperatura extrema
    if (weather.temperature < riskThresholds.temperature.min || 
        weather.temperature > riskThresholds.temperature.max) {
      risks.push({
        type: 'temperature',
        level: 'medium',
        message: `Temperatura extrema: ${weather.temperature}°C`,
        location: `Punto ${index + 1}`,
        coordinates: { lat: waypoint.lat, lon: waypoint.lon },
        timestamp: result.timestamp
      });
    }

    // Visibilidad reducida
    if (weather.visibility && weather.visibility < riskThresholds.visibility) {
      risks.push({
        type: 'visibility',
        level: weather.visibility < 500 ? 'high' : 'medium',
        message: `Visibilidad reducida: ${weather.visibility}m`,
        location: `Punto ${index + 1}`,
        coordinates: { lat: waypoint.lat, lon: waypoint.lon },
        timestamp: result.timestamp
      });
    }
  });

  return risks;
}

function getUsedSources(weatherResults) {
  const sources = new Set();

  weatherResults.forEach(result => {
    if (result.weather && result.weather.sources) {
      result.weather.sources.forEach(source => sources.add(source));
    }
  });

  return Array.from(sources);
}

// Error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: error.message 
  });
});

app.listen(port, () => {
  logger.info(`Weather orchestrator listening on port ${port}`);
});
