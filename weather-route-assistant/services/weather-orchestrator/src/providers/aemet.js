const axios = require('axios');
const logger = require('../utils/logger');

class AemetProvider {
  constructor() {
    this.apiKey = process.env.AEMET_API_KEY;
    this.baseUrl = 'https://opendata.aemet.es/opendata/api';
    this.name = 'aemet';
    this.timeout = 15000;
  }

  async getWeatherForPoint(lat, lon, timestamp) {
    if (!this.isAvailable()) {
      throw new Error('AEMET API key not configured');
    }

    try {
      // AEMET solo cubre territorio español
      if (!this.isSpanishTerritory(lat, lon)) {
        throw new Error('AEMET only covers Spanish territory');
      }

      logger.info(`Calling AEMET API for ${lat}, ${lon}`);

      // Obtener predicción municipal más cercana
      const forecast = await this.getMunicipalityForecast(lat, lon);

      return this.parseResponse(forecast, timestamp);

    } catch (error) {
      this.handleError(error);
    }
  }

  async getMunicipalityForecast(lat, lon) {
    try {
      // Para simplificar, usar predicción general de Madrid
      // En un sistema real, buscarías el municipio más cercano
      const municipalityCode = this.findNearestMunicipality(lat, lon);

      const url = `${this.baseUrl}/prediccion/especifica/municipio/diaria/${municipalityCode}`;
      const params = { api_key: this.apiKey };

      const response = await axios.get(url, { 
        params, 
        timeout: this.timeout 
      });

      if (response.data.estado !== 200) {
        throw new Error(`AEMET API error: ${response.data.descripcion}`);
      }

      // AEMET devuelve una URL de datos, hacer segunda llamada
      const dataResponse = await axios.get(response.data.datos, { 
        timeout: this.timeout 
      });

      return dataResponse.data;

    } catch (error) {
      logger.error('Error getting AEMET forecast:', error);
      throw error;
    }
  }

  findNearestMunicipality(lat, lon) {
    // Mapeo simplificado de coordenadas a códigos de municipio AEMET
    const municipalities = {
      '28079': { name: 'Madrid', lat: 40.4168, lon: -3.7038 },
      '40194': { name: 'Segovia', lat: 40.9429, lon: -4.1088 },
      '05019': { name: 'Ávila', lat: 40.6564, lon: -4.6813 },
      '45168': { name: 'Toledo', lat: 39.8628, lon: -4.0273 }
    };

    let nearestCode = '28079'; // Default Madrid
    let minDistance = Infinity;

    for (const [code, muni] of Object.entries(municipalities)) {
      const distance = this.calculateDistance(lat, lon, muni.lat, muni.lon);
      if (distance < minDistance) {
        minDistance = distance;
        nearestCode = code;
      }
    }

    return nearestCode;
  }

  parseResponse(forecastData, targetTimestamp) {
    try {
      if (!Array.isArray(forecastData) || forecastData.length === 0) {
        throw new Error('No forecast data available from AEMET');
      }

      // Tomar el primer elemento del array de predicción
      const forecast = forecastData[0];

      if (!forecast.prediccion || !forecast.prediccion.dia || forecast.prediccion.dia.length === 0) {
        throw new Error('Invalid AEMET forecast structure');
      }

      // Obtener predicción del día más cercano al timestamp objetivo
      const targetDate = new Date(targetTimestamp);
      const today = forecast.prediccion.dia[0];

      // AEMET tiene estructura compleja, extraer datos básicos
      const weatherData = {
        temperature: this.extractTemperature(today.temperatura),
        windSpeed: this.extractWindSpeed(today.viento),
        windDirection: this.extractWindDirection(today.viento),
        precipitation: this.extractPrecipitation(today.precipitacion),
        humidity: this.extractHumidity(today.humedadRelativa),
        pressure: null, // AEMET no siempre incluye presión en predicción municipal
        cloudCover: this.extractCloudCover(today.estadoCielo),
        visibility: null,
        timestamp: targetDate.toISOString(),
        provider: this.name,
        confidence: 0.80 // AEMET es fuente oficial para España
      };

      return weatherData;

    } catch (error) {
      logger.error('Error parsing AEMET response:', error);
      throw new Error(`Error parsing AEMET data: ${error.message}`);
    }
  }

  extractTemperature(tempData) {
    if (!tempData) return null;

    // Buscar temperatura máxima, mínima o media
    if (tempData.maxima !== undefined) return parseInt(tempData.maxima);
    if (tempData.minima !== undefined) return parseInt(tempData.minima);
    if (tempData.media !== undefined) return parseInt(tempData.media);

    return 20; // Fallback
  }

  extractWindSpeed(windData) {
    if (!windData || !Array.isArray(windData) || windData.length === 0) return 10;

    const wind = windData[0];
    if (wind.velocidad !== undefined) return parseInt(wind.velocidad);

    return 10; // Fallback
  }

  extractWindDirection(windData) {
    if (!windData || !Array.isArray(windData) || windData.length === 0) return 'Variable';

    const wind = windData[0];
    return wind.direccion || 'Variable';
  }

  extractPrecipitation(precipData) {
    if (!precipData || !Array.isArray(precipData) || precipData.length === 0) return 0;

    const precip = precipData[0];
    if (precip.value !== undefined) return parseFloat(precip.value);

    return 0;
  }

  extractHumidity(humidityData) {
    if (!humidityData) return null;

    if (humidityData.maxima !== undefined) return parseInt(humidityData.maxima);
    if (humidityData.minima !== undefined) return parseInt(humidityData.minima);
    if (humidityData.media !== undefined) return parseInt(humidityData.media);

    return null;
  }

  extractCloudCover(skyData) {
    if (!skyData || !Array.isArray(skyData) || skyData.length === 0) return null;

    // Mapear descripción del cielo a porcentaje de nubes (simplificado)
    const sky = skyData[0];
    if (!sky.descripcion) return null;

    const desc = sky.descripcion.toLowerCase();
    if (desc.includes('despejado')) return 10;
    if (desc.includes('poco nuboso')) return 25;
    if (desc.includes('intervalos')) return 50;
    if (desc.includes('nuboso')) return 75;
    if (desc.includes('cubierto')) return 90;

    return 50; // Default
  }

  isSpanishTerritory(lat, lon) {
    // Verificación del territorio español (simplificada)
    // España peninsular: lat 36-44, lon -10 a 3
    // Incluir aproximadamente Baleares, Canarias
    return (lat >= 27 && lat <= 44 && lon >= -18 && lon <= 5);
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    // Fórmula haversine para distancia en km
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;

      if (status === 429) {
        throw new Error('AEMET rate limit exceeded');
      } else if (status === 401 || status === 403) {
        throw new Error('AEMET API key invalid or expired');
      } else if (status === 404) {
        throw new Error('AEMET data not found for location');
      } else {
        throw new Error(`AEMET API error: ${status}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('AEMET API timeout');
    } else {
      throw new Error(`AEMET connection error: ${error.message}`);
    }
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

module.exports = AemetProvider;
