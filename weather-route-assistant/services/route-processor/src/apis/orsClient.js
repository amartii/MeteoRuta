const axios = require('axios');
const logger = require('../utils/logger');

class ORSClient {
  constructor() {
    this.baseUrl = 'https://api.openrouteservice.org/v2';
    this.apiKey = process.env.ORS_API_KEY;
    this.timeout = 15000;
  }

  async getRoute(startCoords, endCoords, profile = 'foot-walking') {
    if (!this.apiKey) {
      throw new Error('OpenRouteService API key not configured');
    }

    try {
      logger.info('Requesting route from ORS:', {
        start: startCoords,
        end: endCoords,
        profile
      });

      const url = `${this.baseUrl}/directions/${profile}`;

      const requestData = {
        coordinates: [
          [startCoords.lon, startCoords.lat],
          [endCoords.lon, endCoords.lat]
        ],
        format: 'geojson',
        instructions: true,
        elevation: true
      };

      const response = await axios.post(url, requestData, {
        headers: {
          'Authorization': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.processResponse(response.data);

    } catch (error) {
      this.handleError(error);
    }
  }

  async getMultipleRoutes(coordinates, profile = 'foot-walking') {
    if (!this.apiKey) {
      throw new Error('OpenRouteService API key not configured');
    }

    if (coordinates.length < 2) {
      throw new Error('At least 2 coordinates required for routing');
    }

    try {
      logger.info('Requesting multi-point route from ORS:', {
        points: coordinates.length,
        profile
      });

      const url = `${this.baseUrl}/directions/${profile}`;

      const requestData = {
        coordinates: coordinates.map(coord => [coord.lon, coord.lat]),
        format: 'geojson',
        instructions: true,
        elevation: true
      };

      const response = await axios.post(url, requestData, {
        headers: {
          'Authorization': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.processResponse(response.data);

    } catch (error) {
      this.handleError(error);
    }
  }

  processResponse(data) {
    if (!data.features || data.features.length === 0) {
      throw new Error('No route found');
    }

    const route = data.features[0];
    const geometry = route.geometry;
    const properties = route.properties;

    const waypoints = geometry.coordinates.map((coord, index) => ({
      lat: parseFloat(coord[1].toFixed(6)),
      lon: parseFloat(coord[0].toFixed(6)),
      elevation: coord[2] || null,
      segment: Math.floor(index / 10), // Agrupar cada 10 puntos
      distanceFromStart: properties.segments ? 
        (index / geometry.coordinates.length) * properties.summary.distance : 
        index * 100 // Estimación
    }));

    // Filtrar waypoints para evitar demasiados puntos
    const filteredWaypoints = this.filterWaypoints(waypoints, 12);

    return {
      waypoints: filteredWaypoints,
      totalDistance: Math.round(properties.summary.distance),
      estimatedDuration: Math.round(properties.summary.duration / 60), // convertir a minutos
      elevationGain: this.calculateElevationGain(filteredWaypoints),
      elevationLoss: this.calculateElevationLoss(filteredWaypoints),
      bounds: this.calculateBounds(filteredWaypoints),
      source: 'openrouteservice'
    };
  }

  filterWaypoints(waypoints, maxPoints) {
    if (waypoints.length <= maxPoints) {
      return waypoints;
    }

    const interval = Math.floor(waypoints.length / maxPoints);
    const filtered = [];

    for (let i = 0; i < waypoints.length; i += interval) {
      filtered.push(waypoints[i]);
    }

    // Asegurar que incluimos el último punto
    if (filtered[filtered.length - 1] !== waypoints[waypoints.length - 1]) {
      filtered.push(waypoints[waypoints.length - 1]);
    }

    return filtered;
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
      const data = error.response.data;

      if (status === 401) {
        throw new Error('OpenRouteService API key invalid or expired');
      } else if (status === 403) {
        throw new Error('OpenRouteService API access forbidden');
      } else if (status === 429) {
        throw new Error('OpenRouteService rate limit exceeded');
      } else if (status === 400) {
        throw new Error(`OpenRouteService request error: ${data.error?.message || 'Invalid request'}`);
      } else {
        throw new Error(`OpenRouteService API error: ${status} - ${data.error?.message || 'Unknown error'}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('OpenRouteService request timeout');
    } else {
      throw new Error(`OpenRouteService connection error: ${error.message}`);
    }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = new ORSClient();
