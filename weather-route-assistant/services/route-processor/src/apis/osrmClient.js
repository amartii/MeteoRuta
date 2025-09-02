const axios = require('axios');
const logger = require('../utils/logger');

class OSRMClient {
  constructor() {
    this.baseUrl = process.env.OSRM_URL || 'http://router.project-osrm.org';
    this.timeout = 10000;
  }

  async getRoute(startCoords, endCoords, profile = 'foot') {
    try {
      logger.info('Requesting route from OSRM:', {
        start: startCoords,
        end: endCoords,
        profile
      });

      const url = `${this.baseUrl}/route/v1/${profile}/${startCoords.lon},${startCoords.lat};${endCoords.lon},${endCoords.lat}`;

      const params = {
        overview: 'full',
        geometries: 'geojson',
        steps: true
      };

      const response = await axios.get(url, { 
        params,
        timeout: this.timeout 
      });

      if (response.data.code !== 'Ok') {
        throw new Error(`OSRM routing failed: ${response.data.message || 'Unknown error'}`);
      }

      return this.processResponse(response.data);

    } catch (error) {
      this.handleError(error);
    }
  }

  async getMultipleRoutes(coordinates, profile = 'foot') {
    if (coordinates.length < 2) {
      throw new Error('At least 2 coordinates required for routing');
    }

    try {
      logger.info('Requesting multi-point route from OSRM:', {
        points: coordinates.length,
        profile
      });

      const coordsString = coordinates
        .map(coord => `${coord.lon},${coord.lat}`)
        .join(';');

      const url = `${this.baseUrl}/route/v1/${profile}/${coordsString}`;

      const params = {
        overview: 'full',
        geometries: 'geojson',
        steps: true
      };

      const response = await axios.get(url, { 
        params,
        timeout: this.timeout 
      });

      if (response.data.code !== 'Ok') {
        throw new Error(`OSRM routing failed: ${response.data.message || 'Unknown error'}`);
      }

      return this.processResponse(response.data);

    } catch (error) {
      this.handleError(error);
    }
  }

  processResponse(data) {
    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }

    const route = data.routes[0];
    const geometry = route.geometry;

    if (!geometry || !geometry.coordinates) {
      throw new Error('Invalid route geometry');
    }

    const waypoints = geometry.coordinates.map((coord, index) => ({
      lat: parseFloat(coord[1].toFixed(6)),
      lon: parseFloat(coord[0].toFixed(6)),
      elevation: null, // OSRM no proporciona elevación por defecto
      segment: Math.floor(index / 10),
      distanceFromStart: (index / geometry.coordinates.length) * route.distance,
      estimatedTimeFromStart: Math.round((index / geometry.coordinates.length) * (route.duration / 60))
    }));

    // Filtrar waypoints para evitar demasiados puntos
    const filteredWaypoints = this.filterWaypoints(waypoints, 12);

    // Estimar elevación para waypoints filtrados
    this.addElevationEstimates(filteredWaypoints);

    return {
      waypoints: filteredWaypoints,
      totalDistance: Math.round(route.distance),
      estimatedDuration: Math.round(route.duration / 60), // convertir a minutos
      elevationGain: this.calculateElevationGain(filteredWaypoints),
      elevationLoss: this.calculateElevationLoss(filteredWaypoints),
      bounds: this.calculateBounds(filteredWaypoints),
      source: 'osrm'
    };
  }

  filterWaypoints(waypoints, maxPoints) {
    if (waypoints.length <= maxPoints) {
      return waypoints;
    }

    const interval = Math.floor(waypoints.length / maxPoints);
    const filtered = [];

    // Siempre incluir el primer punto
    filtered.push(waypoints[0]);

    for (let i = interval; i < waypoints.length - interval; i += interval) {
      filtered.push(waypoints[i]);
    }

    // Siempre incluir el último punto
    filtered.push(waypoints[waypoints.length - 1]);

    return filtered;
  }

  addElevationEstimates(waypoints) {
    // Estimación básica de elevación basada en coordenadas
    // En un sistema real, usarías una API de elevación

    waypoints.forEach(waypoint => {
      waypoint.elevation = this.estimateElevation(waypoint.lat, waypoint.lon);
    });
  }

  estimateElevation(lat, lon) {
    // Estimación simplificada para España
    if (lat > 40.5 && lat < 41.0 && lon > -4.5 && lon < -3.5) {
      // Sierra de Guadarrama
      return Math.round(800 + Math.random() * 800);
    } else if (lat > 40.3 && lat < 40.7 && lon > -3.9 && lon < -3.5) {
      // Zona de Madrid
      return Math.round(600 + Math.random() * 200);
    } else {
      // Default
      return Math.round(500 + Math.random() * 300);
    }
  }

  calculateElevationGain(waypoints) {
    let gain = 0;
    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].elevation && waypoints[i-1].elevation) {
        const diff = waypoints[i].elevation - waypoints[i-1].elevation;
        if (diff > 0) gain += diff;
      }
    }
    return Math.round(gain);
  }

  calculateElevationLoss(waypoints) {
    let loss = 0;
    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].elevation && waypoints[i-1].elevation) {
        const diff = waypoints[i-1].elevation - waypoints[i].elevation;
        if (diff > 0) loss += diff;
      }
    }
    return Math.round(loss);
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

  handleError(error) {
    if (error.response) {
      const status = error.response.status;

      if (status === 400) {
        throw new Error('OSRM: Invalid coordinates or request format');
      } else if (status === 404) {
        throw new Error('OSRM: No route found between coordinates');
      } else if (status >= 500) {
        throw new Error('OSRM: Server error, try again later');
      } else {
        throw new Error(`OSRM API error: ${status}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('OSRM request timeout');
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('OSRM server not available');
    } else {
      throw new Error(`OSRM connection error: ${error.message}`);
    }
  }

  isAvailable() {
    return true; // OSRM público siempre disponible
  }
}

module.exports = new OSRMClient();
