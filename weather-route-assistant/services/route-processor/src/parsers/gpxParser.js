const { parseGPX } = require('@we-gold/gpxjs');
const logger = require('../utils/logger');

class GPXParser {
  async parseGPXContent(gpxString) {
    try {
      const [parsedGPX, error] = parseGPX(gpxString);
      if (error) {
        throw new Error(`Error parsing GPX: ${error.message}`);
      }

      return this.extractWaypoints(parsedGPX);
    } catch (error) {
      logger.error('GPX parsing failed:', error);
      throw error;
    }
  }

  extractWaypoints(gpx) {
    if (!gpx.tracks || gpx.tracks.length === 0) {
      throw new Error('No se encontraron tracks en el archivo GPX');
    }

    const track = gpx.tracks[0];
    if (!track.points || track.points.length === 0) {
      throw new Error('El track no contiene puntos válidos');
    }

    const points = track.points;
    const totalPoints = points.length;

    // Muestrear puntos: máximo 15 waypoints para evitar saturar las APIs meteorológicas
    const maxWaypoints = 15;
    const sampleInterval = Math.max(1, Math.floor(totalPoints / maxWaypoints));
    const waypoints = [];

    for (let i = 0; i < totalPoints; i += sampleInterval) {
      const point = points[i];
      const estimatedMinutes = this.calculateETA(i, totalPoints, track.distance?.total || 0);

      waypoints.push({
        lat: parseFloat(point.lat.toFixed(6)),
        lon: parseFloat(point.lon.toFixed(6)),
        elevation: point.elevation || null,
        time: point.time || null,
        estimatedTimeFromStart: estimatedMinutes,
        segment: Math.floor(i / sampleInterval),
        distanceFromStart: (i / (totalPoints - 1)) * (track.distance?.total || 0),
        description: i === 0 ? 'Inicio' : i >= totalPoints - sampleInterval ? 'Final' : `Punto ${Math.floor(i / sampleInterval)}`
      });
    }

    // Asegurar que incluimos el punto final si no está ya incluido
    if (totalPoints > 1 && (totalPoints - 1) % sampleInterval !== 0) {
      const finalPoint = points[totalPoints - 1];
      waypoints.push({
        lat: parseFloat(finalPoint.lat.toFixed(6)),
        lon: parseFloat(finalPoint.lon.toFixed(6)),
        elevation: finalPoint.elevation || null,
        time: finalPoint.time || null,
        estimatedTimeFromStart: this.calculateTotalDuration(track.distance?.total || 0),
        segment: waypoints.length,
        distanceFromStart: track.distance?.total || 0,
        description: 'Final'
      });
    }

    const result = {
      waypoints,
      totalDistance: Math.round(track.distance?.total || this.calculateDistance(waypoints)),
      elevationGain: Math.round(track.elevation?.pos || this.calculateElevationGain(waypoints)),
      elevationLoss: Math.round(track.elevation?.neg || this.calculateElevationLoss(waypoints)),
      estimatedDuration: this.calculateTotalDuration(track.distance?.total || 0),
      bounds: this.calculateBounds(waypoints)
    };

    logger.info('GPX parsed successfully:', {
      waypoints: result.waypoints.length,
      distance: result.totalDistance,
      elevationGain: result.elevationGain,
      duration: result.estimatedDuration
    });

    return result;
  }

  calculateETA(currentIndex, totalPoints, totalDistance) {
    if (totalPoints <= 1) return 0;

    const progress = currentIndex / (totalPoints - 1);
    const distanceKm = (totalDistance * progress) / 1000;

    // Velocidad promedio hiking considerando desnivel
    // Regla de Naismith: 1 hora por cada 5km + 1 hora por cada 600m de desnivel
    const baseSpeedKmH = 4;
    const timeHours = distanceKm / baseSpeedKmH;

    return Math.round(timeHours * 60); // minutos
  }

  calculateTotalDuration(distanceMeters) {
    const distanceKm = distanceMeters / 1000;

    if (distanceKm <= 5) {
      // Rutas cortas: 4 km/h
      return Math.round((distanceKm / 4) * 60);
    } else if (distanceKm <= 15) {
      // Rutas medias: 3.5 km/h
      return Math.round((distanceKm / 3.5) * 60);
    } else {
      // Rutas largas: 3 km/h
      return Math.round((distanceKm / 3) * 60);
    }
  }

  calculateDistance(waypoints) {
    if (waypoints.length < 2) return 0;

    let totalDistance = 0;

    for (let i = 1; i < waypoints.length; i++) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];

      // Fórmula haversine para calcular distancia
      const R = 6371e3; // Radio de la Tierra en metros
      const φ1 = prev.lat * Math.PI / 180;
      const φ2 = curr.lat * Math.PI / 180;
      const Δφ = (curr.lat - prev.lat) * Math.PI / 180;
      const Δλ = (curr.lon - prev.lon) * Math.PI / 180;

      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

      totalDistance += R * c;
    }

    return totalDistance;
  }

  calculateElevationGain(waypoints) {
    let gain = 0;

    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].elevation && waypoints[i-1].elevation) {
        const diff = waypoints[i].elevation - waypoints[i-1].elevation;
        if (diff > 0) gain += diff;
      }
    }

    return gain;
  }

  calculateElevationLoss(waypoints) {
    let loss = 0;

    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].elevation && waypoints[i-1].elevation) {
        const diff = waypoints[i-1].elevation - waypoints[i].elevation;
        if (diff > 0) loss += diff;
      }
    }

    return loss;
  }

  calculateBounds(waypoints) {
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
}

module.exports = new GPXParser();
