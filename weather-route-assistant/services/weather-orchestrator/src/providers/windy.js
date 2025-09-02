const axios = require('axios');
const logger = require('../utils/logger');

class WindyProvider {
  constructor() {
    this.apiKey = process.env.WINDY_API_KEY;
    this.baseUrl = 'https://api.windy.com/api/point-forecast/v2';
    this.name = 'windy';
    this.timeout = 15000;
  }

  async getWeatherForPoint(lat, lon, timestamp) {
    if (!this.isAvailable()) {
      throw new Error('Windy API key not configured');
    }

    try {
      logger.info(`Calling Windy API for ${lat}, ${lon}`);

      const requestData = {
        lat: parseFloat(lat.toFixed(4)),
        lon: parseFloat(lon.toFixed(4)),
        model: 'gfs', // Global Forecast System
        parameters: ['temp', 'wind', 'precip', 'rh', 'pressure', 'cloudcover'],
        levels: ['surface'],
        key: this.apiKey
      };

      const response = await axios.post(this.baseUrl, requestData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.parseResponse(response.data, timestamp);

    } catch (error) {
      this.handleError(error);
    }
  }

  parseResponse(data, targetTimestamp) {
    try {
      if (!data.ts || !Array.isArray(data.ts)) {
        throw new Error('Invalid Windy response format');
      }

      // Encontrar el timestamp más cercano
      const targetTime = new Date(targetTimestamp).getTime();
      let closestIndex = 0;
      let minDiff = Math.abs(data.ts[0] - targetTime);

      for (let i = 1; i < data.ts.length; i++) {
        const diff = Math.abs(data.ts[i] - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }

      const weatherData = {
        temperature: this.getParameterValue(data, 'temp', closestIndex),
        windSpeed: this.calculateWindSpeed(data, closestIndex),
        windDirection: this.getParameterValue(data, 'wind_u', closestIndex), // Simplificado
        precipitation: this.getParameterValue(data, 'precip', closestIndex) || 0,
        humidity: this.getParameterValue(data, 'rh', closestIndex),
        pressure: this.getParameterValue(data, 'pressure', closestIndex),
        cloudCover: this.getParameterValue(data, 'cloudcover', closestIndex),
        visibility: null, // Windy no proporciona visibilidad en esta API
        timestamp: new Date(data.ts[closestIndex]).toISOString(),
        provider: this.name,
        confidence: this.calculateConfidence(minDiff)
      };

      return weatherData;

    } catch (error) {
      logger.error('Error parsing Windy response:', error);
      throw new Error(`Error parsing Windy data: ${error.message}`);
    }
  }

  getParameterValue(data, parameter, index) {
    const paramData = data[`${parameter}-surface`];
    if (!paramData || !Array.isArray(paramData)) return null;

    return paramData[index] !== undefined ? paramData[index] : null;
  }

  calculateWindSpeed(data, index) {
    const windU = this.getParameterValue(data, 'wind_u', index);
    const windV = this.getParameterValue(data, 'wind_v', index);

    if (windU === null || windV === null) return null;

    // Calcular velocidad del viento desde componentes U y V
    const windSpeed = Math.sqrt(windU * windU + windV * windV);
    return Math.round(windSpeed * 3.6); // Convertir m/s a km/h
  }

  calculateConfidence(timeDifference) {
    // Confianza basada en la diferencia temporal
    const hoursOff = timeDifference / (1000 * 60 * 60);

    if (hoursOff <= 1) return 0.90;
    if (hoursOff <= 3) return 0.80;
    if (hoursOff <= 6) return 0.70;
    if (hoursOff <= 12) return 0.60;
    return 0.45;
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 429) {
        throw new Error('Windy rate limit exceeded');
      } else if (status === 401 || status === 403) {
        throw new Error('Windy API key invalid or expired');
      } else if (status === 400) {
        throw new Error(`Windy API request error: ${data?.message || 'Invalid request'}`);
      } else {
        throw new Error(`Windy API error: ${status}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Windy API timeout');
    } else {
      throw new Error(`Windy connection error: ${error.message}`);
    }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = WindyProvider;
