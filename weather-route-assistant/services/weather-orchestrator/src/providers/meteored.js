const axios = require('axios');
const logger = require('../utils/logger');

class MeteoredProvider {
  constructor() {
    this.apiKey = process.env.METEORED_API_KEY;
    this.baseUrl = 'https://api.tiempo.com';
    this.name = 'meteored';
    this.timeout = 15000;
  }

  async getWeatherForPoint(lat, lon, timestamp) {
    if (!this.isAvailable()) {
      throw new Error('Meteored API key not configured');
    }

    try {
      logger.info(`Calling Meteored API for ${lat}, ${lon}`);

      // Meteored API endpoint (simplificado para el ejemplo)
      const url = `${this.baseUrl}/api/location/${lat}/${lon}/weather.json`;

      const params = {
        affiliate_id: this.apiKey,
        language: 'es'
      };

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
      // Estructura simplificada basada en la documentación de Meteored
      if (!data.weather || !Array.isArray(data.weather.forecast)) {
        throw new Error('Invalid Meteored response format');
      }

      const forecasts = data.weather.forecast;
      const targetDate = new Date(targetTimestamp);

      // Buscar predicción más cercana al timestamp objetivo
      let closestForecast = forecasts[0];
      let minDiff = Math.abs(new Date(forecasts[0].date).getTime() - targetDate.getTime());

      for (const forecast of forecasts) {
        const diff = Math.abs(new Date(forecast.date).getTime() - targetDate.getTime());
        if (diff < minDiff) {
          minDiff = diff;
          closestForecast = forecast;
        }
      }

      const weatherData = {
        temperature: this.extractTemperature(closestForecast),
        windSpeed: this.extractWindSpeed(closestForecast),
        windDirection: this.extractWindDirection(closestForecast),
        precipitation: this.extractPrecipitation(closestForecast),
        humidity: this.extractHumidity(closestForecast),
        pressure: this.extractPressure(closestForecast),
        cloudCover: this.extractCloudCover(closestForecast),
        visibility: null, // No disponible en Meteored básico
        timestamp: targetDate.toISOString(),
        provider: this.name,
        confidence: this.calculateConfidence(minDiff)
      };

      return weatherData;

    } catch (error) {
      logger.error('Error parsing Meteored response:', error);
      throw new Error(`Error parsing Meteored data: ${error.message}`);
    }
  }

  extractTemperature(forecast) {
    if (forecast.temperature) {
      return Math.round((forecast.temperature.max + forecast.temperature.min) / 2);
    }
    if (forecast.temp) return Math.round(forecast.temp);
    return null;
  }

  extractWindSpeed(forecast) {
    if (forecast.wind && forecast.wind.speed) {
      return Math.round(forecast.wind.speed);
    }
    return null;
  }

  extractWindDirection(forecast) {
    if (forecast.wind && forecast.wind.direction) {
      return forecast.wind.direction;
    }
    return 'Variable';
  }

  extractPrecipitation(forecast) {
    if (forecast.precipitation) {
      return parseFloat(forecast.precipitation);
    }
    if (forecast.rain) return parseFloat(forecast.rain);
    return 0;
  }

  extractHumidity(forecast) {
    if (forecast.humidity) return Math.round(forecast.humidity);
    return null;
  }

  extractPressure(forecast) {
    if (forecast.pressure) return Math.round(forecast.pressure);
    return null;
  }

  extractCloudCover(forecast) {
    if (forecast.cloudiness) return Math.round(forecast.cloudiness);
    if (forecast.clouds) return Math.round(forecast.clouds);
    return null;
  }

  calculateConfidence(timeDifference) {
    const hoursOff = timeDifference / (1000 * 60 * 60);

    if (hoursOff <= 2) return 0.75;
    if (hoursOff <= 6) return 0.65;
    if (hoursOff <= 12) return 0.55;
    if (hoursOff <= 24) return 0.45;
    return 0.35;
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;

      if (status === 429) {
        throw new Error('Meteored rate limit exceeded');
      } else if (status === 401 || status === 403) {
        throw new Error('Meteored API key invalid or expired');
      } else if (status === 404) {
        throw new Error('Meteored location not found');
      } else {
        throw new Error(`Meteored API error: ${status}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Meteored API timeout');
    } else {
      throw new Error(`Meteored connection error: ${error.message}`);
    }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = MeteoredProvider;
