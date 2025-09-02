const axios = require('axios');
const logger = require('../utils/logger');

class MeteoblueProvider {
  constructor() {
    this.apiKey = process.env.METEOBLUE_API_KEY;
    this.baseUrl = 'https://my.meteoblue.com/packages';
    this.name = 'meteoblue';
    this.timeout = 15000;
  }

  async getWeatherForPoint(lat, lon, timestamp) {
    if (!this.isAvailable()) {
      throw new Error('meteoblue API key not configured');
    }

    try {
      const url = `${this.baseUrl}/basic-1h`;
      const params = {
        lat: lat.toFixed(4),
        lon: lon.toFixed(4),
        apikey: this.apiKey,
        format: 'json',
        timeformat: 'iso8601'
      };

      logger.info(`Calling meteoblue API for ${lat}, ${lon}`);

      const response = await axios.get(url, { 
        params, 
        timeout: this.timeout 
      });

      return this.parseResponse(response.data, timestamp);

    } catch (error) {
      this.handleError(error);
    }
  }

  parseResponse(data, targetTimestamp) {
    try {
      if (!data.data_1h || !data.data_1h.time) {
        throw new Error('Invalid meteoblue response format');
      }

      // Encontrar el índice de tiempo más cercano al objetivo
      const targetTime = new Date(targetTimestamp);
      const times = data.data_1h.time.map(t => new Date(t));

      let closestIndex = 0;
      let minDiff = Math.abs(times[0].getTime() - targetTime.getTime());

      for (let i = 1; i < times.length; i++) {
        const diff = Math.abs(times[i].getTime() - targetTime.getTime());
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }

      const weatherData = {
        temperature: this.getValueAtIndex(data.data_1h.temperature, closestIndex),
        windSpeed: this.getValueAtIndex(data.data_1h.windspeed, closestIndex),
        windDirection: this.getValueAtIndex(data.data_1h.winddirection, closestIndex),
        precipitation: this.getValueAtIndex(data.data_1h.precipitation, closestIndex) || 0,
        humidity: this.getValueAtIndex(data.data_1h.relativehumidity, closestIndex),
        pressure: this.getValueAtIndex(data.data_1h.sealevelpressure, closestIndex),
        cloudCover: this.getValueAtIndex(data.data_1h.totalcloudcover, closestIndex),
        visibility: this.getValueAtIndex(data.data_1h.visibility, closestIndex),
        timestamp: times[closestIndex].toISOString(),
        provider: this.name,
        confidence: this.calculateConfidence(minDiff)
      };

      // Validar datos críticos
      if (weatherData.temperature === null || weatherData.windSpeed === null) {
        throw new Error('Missing critical weather data from meteoblue');
      }

      return weatherData;

    } catch (error) {
      logger.error('Error parsing meteoblue response:', error);
      throw new Error(`Error parsing meteoblue data: ${error.message}`);
    }
  }

  getValueAtIndex(array, index) {
    return array && array[index] !== undefined ? array[index] : null;
  }

  calculateConfidence(timeDifference) {
    // Confianza basada en la diferencia temporal (en milisegundos)
    const hoursOff = timeDifference / (1000 * 60 * 60);

    if (hoursOff <= 1) return 0.95;
    if (hoursOff <= 3) return 0.85;
    if (hoursOff <= 6) return 0.75;
    if (hoursOff <= 12) return 0.65;
    return 0.50;
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 429) {
        throw new Error('meteoblue rate limit exceeded');
      } else if (status === 401 || status === 403) {
        throw new Error('meteoblue API key invalid or expired');
      } else if (status === 400) {
        throw new Error(`meteoblue API request error: ${data?.error || 'Invalid request'}`);
      } else {
        throw new Error(`meteoblue API error: ${status}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('meteoblue API timeout');
    } else {
      throw new Error(`meteoblue connection error: ${error.message}`);
    }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = MeteoblueProvider;
