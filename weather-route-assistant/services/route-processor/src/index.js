const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const gpxParser = require('./parsers/gpxParser');
const orsClient = require('./apis/orsClient');
const osrmClient = require('./apis/osrmClient');
const logger = require('./utils/logger');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { 
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: req.get('Content-Length')
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'route-processor',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Procesar descripción de ruta
app.post('/process-description', async (req, res) => {
  try {
    const { description, userId } = req.body;

    if (!description || description.length < 5) {
      return res.status(400).json({ 
        error: 'Descripción de ruta requerida',
        details: 'La descripción debe tener al menos 5 caracteres'
      });
    }

    logger.info('Processing route description:', { 
      userId, 
      description: description.substring(0, 100) + (description.length > 100 ? '...' : '')
    });

    // Extraer información de la descripción
    const routeInfo = await parseRouteDescription(description);

    // Generar ruta si tenemos información suficiente
    const routeData = await generateRoute(routeInfo, userId);

    logger.info('Route processing completed:', {
      userId,
      waypoints: routeData.waypoints.length,
      distance: routeData.totalDistance,
      duration: routeData.estimatedDuration
    });

    res.json(routeData);

  } catch (error) {
    logger.error('Error processing route description:', error);
    res.status(400).json({ 
      error: 'Error procesando descripción de ruta',
      details: error.message 
    });
  }
});

// Procesar archivo GPX
app.post('/process-gpx', async (req, res) => {
  try {
    const { gpxContent, userId, fileName } = req.body;

    if (!gpxContent) {
      return res.status(400).json({ 
        error: 'Contenido GPX requerido',
        details: 'El campo gpxContent no puede estar vacío'
      });
    }

    logger.info('Processing GPX file:', { 
      userId, 
      fileName,
      contentLength: gpxContent.length 
    });

    const routeData = await gpxParser.parseGPXContent(gpxContent);

    // Añadir metadata
    routeData.source = 'gpx';
    routeData.originalFileName = fileName;
    routeData.processedAt = new Date().toISOString();

    logger.info('GPX processing completed:', {
      userId,
      fileName,
      waypoints: routeData.waypoints.length,
      distance: routeData.totalDistance
    });

    res.json(routeData);

  } catch (error) {
    logger.error('Error processing GPX:', error);
    res.status(400).json({ 
      error: 'Error procesando archivo GPX',
      details: error.message 
    });
  }
});

// Obtener información de una coordenada específica
app.get('/geocode/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ 
        error: 'Coordenadas inválidas',
        details: 'Latitud y longitud deben ser números válidos'
      });
    }

    const locationInfo = await reverseGeocode(latitude, longitude);
    res.json(locationInfo);

  } catch (error) {
    logger.error('Error in reverse geocoding:', error);
    res.status(500).json({ 
      error: 'Error en geocodificación inversa',
      details: error.message 
    });
  }
});

// Funciones auxiliares
async function parseRouteDescription(description) {
  // Análisis básico de la descripción usando patrones de regex
  const locationPatterns = [
    /(?:por|en|hacia|desde|subir|bajar|pasar por)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]{2,30})/gi,
    /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de|del|de la)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g
  ];

  const timePatterns = [
    /(?:mañana|tarde|noche)/gi,
    /(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)/gi,
    /\b\d{1,2}:\d{2}\b/g,
    /(?:a las|sobre las)\s+\d{1,2}(?::\d{2})?/gi
  ];

  const typePatterns = [
    /(?:circular|lineal|ida y vuelta|subida|ascensión)/gi,
    /(?:senderismo|hiking|trekking|montañismo|escalada)/gi
  ];

  let locations = [];
  let timeIndicators = [];
  let routeTypes = [];

  // Extraer ubicaciones
  locationPatterns.forEach(pattern => {
    const matches = description.match(pattern);
    if (matches) {
      locations = locations.concat(
        matches.map(m => m.replace(/^(?:por|en|hacia|desde|subir|bajar|pasar por)\s+/i, '').trim())
      );
    }
  });

  // Extraer indicadores de tiempo
  timePatterns.forEach(pattern => {
    const matches = description.match(pattern);
    if (matches) {
      timeIndicators = timeIndicators.concat(matches);
    }
  });

  // Extraer tipo de ruta
  typePatterns.forEach(pattern => {
    const matches = description.match(pattern);
    if (matches) {
      routeTypes = routeTypes.concat(matches);
    }
  });

  // Limpiar y deduplicar
  locations = [...new Set(locations.filter(loc => loc.length > 2))];
  timeIndicators = [...new Set(timeIndicators)];
  routeTypes = [...new Set(routeTypes)];

  // Geocodificar ubicación principal
  const mainLocation = locations[0] || extractMainLocationFallback(description);
  const coordinates = await geocodeLocation(mainLocation);

  return {
    description,
    locations,
    timeIndicators,
    routeTypes,
    mainLocation,
    coordinates,
    estimatedStartTime: parseTimeIndicators(timeIndicators)
  };
}

function extractMainLocationFallback(description) {
  // Fallback para extraer ubicación cuando los patrones principales fallan
  const commonSpanishPlaces = [
    'Madrid', 'Barcelona', 'Sevilla', 'Valencia', 'Bilbao',
    'Pedriza', 'Guadarrama', 'Gredos', 'Pirineos', 'Picos de Europa',
    'Segovia', 'Ávila', 'Toledo', 'Sierra Nevada', 'Ordesa'
  ];

  for (const place of commonSpanishPlaces) {
    if (description.toLowerCase().includes(place.toLowerCase())) {
      return place;
    }
  }

  return 'Madrid'; // Fallback final
}

async function generateRoute(routeInfo, userId) {
  try {
    const { coordinates, routeTypes, timeIndicators } = routeInfo;

    // Determinar si es una ruta circular o lineal
    const isCircular = routeTypes.some(type => /circular|vuelta/i.test(type));

    // Crear waypoints alrededor del punto principal
    const radius = isCircular ? 0.03 : 0.05; // Radio en grados (~3-5km)
    const numPoints = isCircular ? 8 : 6;
    const waypoints = [];

    // Punto de inicio
    waypoints.push({
      lat: parseFloat(coordinates.lat.toFixed(6)),
      lon: parseFloat(coordinates.lon.toFixed(6)),
      elevation: await estimateElevation(coordinates.lat, coordinates.lon),
      estimatedTimeFromStart: 0,
      segment: 0,
      distanceFromStart: 0,
      description: 'Inicio de ruta'
    });

    if (isCircular) {
      // Ruta circular
      for (let i = 1; i < numPoints; i++) {
        const angle = (i / (numPoints - 1)) * 2 * Math.PI;
        const lat = coordinates.lat + radius * Math.cos(angle);
        const lon = coordinates.lon + radius * Math.sin(angle);

        waypoints.push({
          lat: parseFloat(lat.toFixed(6)),
          lon: parseFloat(lon.toFixed(6)),
          elevation: await estimateElevation(lat, lon),
          estimatedTimeFromStart: i * 30, // cada 30 minutos
          segment: i,
          distanceFromStart: i * 1000, // ~1km por segmento
          description: `Punto ${i}`
        });
      }

      // Volver al inicio
      waypoints.push(waypoints[0]);

    } else {
      // Ruta lineal
      for (let i = 1; i < numPoints; i++) {
        const progress = i / (numPoints - 1);
        const lat = coordinates.lat + radius * progress;
        const lon = coordinates.lon + radius * progress * 0.8;

        waypoints.push({
          lat: parseFloat(lat.toFixed(6)),
          lon: parseFloat(lon.toFixed(6)),
          elevation: await estimateElevation(lat, lon),
          estimatedTimeFromStart: i * 25,
          segment: i,
          distanceFromStart: i * 800,
          description: i === numPoints - 1 ? 'Final de ruta' : `Punto ${i}`
        });
      }
    }

    const totalDistance = waypoints[waypoints.length - 1].distanceFromStart;
    const estimatedDuration = waypoints[waypoints.length - 1].estimatedTimeFromStart;

    return {
      waypoints,
      totalDistance,
      elevationGain: calculateElevationGain(waypoints),
      elevationLoss: calculateElevationLoss(waypoints),
      estimatedDuration,
      bounds: calculateBounds(waypoints),
      source: 'generated',
      originalDescription: routeInfo.description,
      routeType: isCircular ? 'circular' : 'lineal',
      estimatedStartTime: routeInfo.estimatedStartTime
    };

  } catch (error) {
    logger.error('Error generating route:', error);
    throw error;
  }
}

async function geocodeLocation(location) {
  // Coordenadas predefinidas para ubicaciones comunes en España
  const knownLocations = {
    'La Pedriza': { lat: 40.7539, lon: -3.8742 },
    'Pedriza': { lat: 40.7539, lon: -3.8742 },
    'Yelmo': { lat: 40.7486, lon: -3.8644 },
    'Siete Picos': { lat: 40.7858, lon: -3.8864 },
    'Guadarrama': { lat: 40.6736, lon: -4.1106 },
    'Madrid': { lat: 40.4168, lon: -3.7038 },
    'Segovia': { lat: 40.9429, lon: -4.1088 },
    'Gredos': { lat: 40.3461, lon: -5.1350 },
    'Ordesa': { lat: 42.6186, lon: -0.0363 },
    'Pirineos': { lat: 42.6186, lon: 1.0363 },
    'Picos de Europa': { lat: 43.1567, lon: -4.8551 },
    'Sierra Nevada': { lat: 37.0545, lon: -3.3986 },
    'Peñalara': { lat: 40.8400, lon: -3.9580 },
    'Navacerrada': { lat: 40.7833, lon: -4.0167 },
    'Cercedilla': { lat: 40.7333, lon: -4.0500 }
  };

  // Buscar coincidencia exacta
  if (knownLocations[location]) {
    return knownLocations[location];
  }

  // Buscar coincidencia parcial
  for (const [place, coords] of Object.entries(knownLocations)) {
    if (location.toLowerCase().includes(place.toLowerCase()) ||
        place.toLowerCase().includes(location.toLowerCase())) {
      return coords;
    }
  }

  // Fallback a Madrid
  return knownLocations.Madrid;
}

async function reverseGeocode(lat, lon) {
  // Geocodificación inversa simplificada
  const knownAreas = [
    { name: 'Sierra de Guadarrama', bounds: { n: 41.0, s: 40.5, e: -3.5, w: -4.5 } },
    { name: 'La Pedriza', bounds: { n: 40.8, s: 40.7, e: -3.8, w: -3.9 } },
    { name: 'Madrid Centro', bounds: { n: 40.5, s: 40.3, e: -3.6, w: -3.8 } }
  ];

  for (const area of knownAreas) {
    const b = area.bounds;
    if (lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e) {
      return {
        name: area.name,
        coordinates: { lat, lon },
        elevation: await estimateElevation(lat, lon)
      };
    }
  }

  return {
    name: 'Ubicación desconocida',
    coordinates: { lat, lon },
    elevation: await estimateElevation(lat, lon)
  };
}

async function estimateElevation(lat, lon) {
  // Estimación simplificada de elevación basada en coordenadas
  // En un sistema real, usarías una API de elevación como USGS o Google

  // Sierra de Guadarrama (zona montañosa)
  if (lat > 40.5 && lat < 41.0 && lon > -4.5 && lon < -3.5) {
    return Math.round(800 + Math.random() * 800); // 800-1600m
  }

  // Zona de Madrid (meseta)
  if (lat > 40.3 && lat < 40.7 && lon > -3.9 && lon < -3.5) {
    return Math.round(600 + Math.random() * 200); // 600-800m
  }

  // Default
  return Math.round(500 + Math.random() * 300);
}

function parseTimeIndicators(indicators) {
  const now = new Date();
  let startTime = new Date(now);

  // Ajustar según indicadores encontrados
  if (indicators.some(i => /mañana/i.test(i))) {
    startTime.setHours(8, 0, 0, 0);
  } else if (indicators.some(i => /tarde/i.test(i))) {
    startTime.setHours(15, 0, 0, 0);
  } else {
    startTime.setHours(9, 0, 0, 0); // default
  }

  // Si menciona "mañana" (día siguiente)
  if (indicators.some(i => /^mañana$/i.test(i))) {
    startTime.setDate(startTime.getDate() + 1);
  }

  // Buscar hora específica
  const timeMatch = indicators.find(i => /\d{1,2}:\d{2}/.test(i));
  if (timeMatch) {
    const [hours, minutes] = timeMatch.match(/\d{1,2}:\d{2}/)[0].split(':');
    startTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  }

  return startTime;
}

function calculateElevationGain(waypoints) {
  let gain = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const diff = waypoints[i].elevation - waypoints[i-1].elevation;
    if (diff > 0) gain += diff;
  }
  return Math.round(gain);
}

function calculateElevationLoss(waypoints) {
  let loss = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const diff = waypoints[i-1].elevation - waypoints[i].elevation;
    if (diff > 0) loss += diff;
  }
  return Math.round(loss);
}

function calculateBounds(waypoints) {
  if (waypoints.length === 0) return null;

  const lats = waypoints.map(p => p.lat);
  const lons = waypoints.map(p => p.lon);

  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons)
  };
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
  logger.info(`Route processor listening on port ${port}`);
});
