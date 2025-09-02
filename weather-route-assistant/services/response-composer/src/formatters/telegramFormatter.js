const BriefingTemplate = require('../templates/briefingTemplate');
const logger = require('../utils/logger');

class TelegramFormatter {
  constructor() {
    this.template = new BriefingTemplate();
    this.riskThresholds = {
      windSpeed: 25, // km/h
      precipitation: 5, // mm/h
      temperature: { min: 0, max: 35 }, // °C
      visibility: 1000 // metros
    };
  }

  async composeBriefing(weatherData, routeData) {
    try {
      const briefing = {
        header: this.generateHeader(routeData),
        segments: [],
        risks: [],
        links: {},
        summary: {}
      };

      // Procesar cada segmento de la ruta
      if (weatherData.weatherData && Array.isArray(weatherData.weatherData)) {
        for (const result of weatherData.weatherData) {
          if (result.weather) {
            const segment = this.processSegment(result);
            briefing.segments.push(segment);
          }
        }
      }

      // Usar riesgos ya identificados por el weather orchestrator
      briefing.risks = weatherData.risks || [];

      // Generar enlaces rápidos
      briefing.links = this.generateQuickLinks(routeData, weatherData);

      // Resumen general
      briefing.summary = weatherData.summary || this.generateSummary(briefing.segments, briefing.risks);

      return this.formatForTelegram(briefing);

    } catch (error) {
      logger.error('Error composing briefing:', error);
      throw error;
    }
  }

  generateHeader(routeData) {
    const startTime = new Date().toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const distance = routeData.totalDistance ? (routeData.totalDistance / 1000).toFixed(1) : 'N/A';
    const duration = routeData.estimatedDuration ? (routeData.estimatedDuration / 60).toFixed(1) : 'N/A';
    const elevation = routeData.elevationGain || 0;

    return {
      title: `🌤️ Briefing Meteorológico`,
      subtitle: `📍 Ruta de ${distance}km | ⏱️ ${duration}h`,
      timestamp: `Actualizado: ${startTime}`,
      elevationGain: `📈 Desnivel: +${elevation}m`,
      source: routeData.source || 'generada'
    };
  }

  processSegment(result) {
    const { weather, waypoint, timestamp } = result;
    const segmentTime = new Date(timestamp);

    return {
      time: segmentTime.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      location: `${waypoint.lat.toFixed(3)}, ${waypoint.lon.toFixed(3)}`,
      elevation: waypoint.elevation ? `${Math.round(waypoint.elevation)}m` : 'N/A',
      weather: {
        temperature: `${Math.round(weather.temperature)}°C`,
        windSpeed: `${Math.round(weather.windSpeed)} km/h`,
        windDirection: this.getWindDirectionText(weather.windDirection),
        precipitation: `${weather.precipitation?.toFixed(1) || 0}mm/h`,
        cloudCover: weather.cloudCover ? `${Math.round(weather.cloudCover)}%` : 'N/A',
        source: weather.primary || weather.provider || 'N/A'
      },
      conditions: this.getConditionEmoji(weather),
      description: waypoint.description || `Punto ${waypoint.segment + 1}`
    };
  }

  getWindDirectionText(direction) {
    if (typeof direction === 'string') return direction;
    if (typeof direction !== 'number') return 'Variable';

    const directions = [
      'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'
    ];

    const index = Math.round(direction / 22.5) % 16;
    return directions[index];
  }

  getConditionEmoji(weather) {
    const temp = weather.temperature;
    const wind = weather.windSpeed;
    const precip = weather.precipitation;
    const clouds = weather.cloudCover;

    // Prioridad: precipitación > viento > temperatura > nubes
    if (precip > 10) return '🌧️';
    if (precip > 5) return '🌦️';
    if (wind > 40) return '💨';
    if (wind > 25) return '🌬️';
    if (temp < 5) return '🥶';
    if (temp > 30) return '🌡️';
    if (clouds > 80) return '☁️';
    if (clouds < 20) return '☀️';

    return '⛅';
  }

  generateQuickLinks(routeData, weatherData) {
    const centerPoint = this.getCenterPoint(routeData.waypoints);

    return {
      windy: `https://windy.com/${centerPoint.lat}/${centerPoint.lon}?${centerPoint.lat},${centerPoint.lon},8`,
      meteoblue: `https://www.meteoblue.com/weather/week/${centerPoint.lat}N${centerPoint.lon}E`,
      aemet: this.getAemetLink(centerPoint),
      meteored: `https://www.tiempo.com/${centerPoint.lat}-${centerPoint.lon}.htm`
    };
  }

  getCenterPoint(waypoints) {
    if (!waypoints || waypoints.length === 0) {
      return { lat: 40.4168, lon: -3.7038 }; // Madrid por defecto
    }

    const lats = waypoints.map(p => p.lat);
    const lons = waypoints.map(p => p.lon);

    return {
      lat: (Math.max(...lats) + Math.min(...lats)) / 2,
      lon: (Math.max(...lons) + Math.min(...lons)) / 2
    };
  }

  getAemetLink(centerPoint) {
    // Para España, enlace a AEMET
    if (centerPoint.lat >= 36 && centerPoint.lat <= 44 && 
        centerPoint.lon >= -10 && centerPoint.lon <= 3) {
      return `https://www.aemet.es/es/eltiempo/prediccion/municipios`;
    }
    return 'https://www.aemet.es';
  }

  generateSummary(segments, risks) {
    if (segments.length === 0) {
      return { message: 'No hay datos meteorológicos disponibles' };
    }

    const temperatures = segments.map(s => parseFloat(s.weather.temperature)).filter(t => !isNaN(t));
    const windSpeeds = segments.map(s => parseFloat(s.weather.windSpeed)).filter(w => !isNaN(w));

    return {
      temperatureRange: {
        min: Math.min(...temperatures),
        max: Math.max(...temperatures)
      },
      windRange: {
        min: Math.min(...windSpeeds),
        max: Math.max(...windSpeeds)
      },
      riskLevel: this.calculateOverallRiskLevel(risks),
      dataPoints: segments.length
    };
  }

  calculateOverallRiskLevel(risks) {
    if (!risks || risks.length === 0) return 'bajo';

    const highRisks = risks.filter(r => r.level === 'high').length;
    const mediumRisks = risks.filter(r => r.level === 'medium').length;

    if (highRisks > 0) return 'alto';
    if (mediumRisks > 2) return 'medio';
    if (mediumRisks > 0) return 'medio-bajo';
    return 'bajo';
  }

  formatForTelegram(briefing) {
    let message = `${briefing.header.title}\n`;
    message += `${briefing.header.subtitle}\n`;
    message += `${briefing.header.timestamp} | ${briefing.header.elevationGain}\n\n`;

    // Resumen de riesgos si existen
    if (briefing.risks.length > 0) {
      message += `🚨 <b>AVISOS DE RIESGO:</b>\n`;

      const highRisks = briefing.risks.filter(r => r.level === 'high');
      const mediumRisks = briefing.risks.filter(r => r.level === 'medium');

      if (highRisks.length > 0) {
        highRisks.forEach(risk => {
          message += `• <b>${risk.message}</b> (${risk.location})\n`;
        });
      }

      if (mediumRisks.length > 0) {
        mediumRisks.forEach(risk => {
          message += `• ${risk.message} (${risk.location})\n`;
        });
      }

      message += '\n';
    }

    // Segmentos de la ruta (máximo 6 para no saturar)
    const displaySegments = briefing.segments.slice(0, 6);

    if (displaySegments.length > 0) {
      message += `📍 <b>PREVISIÓN POR TRAMOS:</b>\n\n`;

      displaySegments.forEach((segment, index) => {
        message += `<b>${index + 1}. ${segment.time}</b> | ${segment.elevation}\n`;
        message += `   ${segment.conditions} ${segment.weather.temperature} | `;
        message += `💨 ${segment.weather.windSpeed} ${segment.weather.windDirection} | `;
        message += `🌧️ ${segment.weather.precipitation}\n`;

        if (segment.description !== `Punto ${index + 1}`) {
          message += `   📍 ${segment.description}\n`;
        }

        message += `   <i>📡 ${segment.weather.source}</i>\n\n`;
      });

      if (briefing.segments.length > 6) {
        message += `<i>... y ${briefing.segments.length - 6} puntos más</i>\n\n`;
      }
    }

    // Resumen estadístico
    if (briefing.summary.temperatureRange) {
      message += `📊 <b>RESUMEN:</b>\n`;
      message += `🌡️ Temperatura: ${briefing.summary.temperatureRange.min}°C - ${briefing.summary.temperatureRange.max}°C\n`;
      message += `💨 Viento: ${briefing.summary.windRange.min} - ${briefing.summary.windRange.max} km/h\n`;
      message += `⚠️ Nivel de riesgo: ${briefing.summary.riskLevel}\n\n`;
    }

    // Información de fuentes
    message += `<i>Consulta fuentes detalladas usando los botones de abajo</i>`;

    // Enlaces rápidos como keyboard
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🌊 Windy', url: briefing.links.windy },
          { text: '🔬 meteoblue', url: briefing.links.meteoblue }
        ],
        [
          { text: '🇪🇸 AEMET', url: briefing.links.aemet },
          { text: '☀️ Meteored', url: briefing.links.meteored }
        ]
      ]
    };

    return {
      text: message,
      keyboard: keyboard
    };
  }

  async generateExecutiveSummary(weatherData, routeData) {
    const summary = {
      route: {
        distance: routeData.totalDistance ? `${(routeData.totalDistance / 1000).toFixed(1)} km` : 'N/A',
        duration: routeData.estimatedDuration ? `${(routeData.estimatedDuration / 60).toFixed(1)} h` : 'N/A',
        elevation: `${routeData.elevationGain || 0} m`
      },
      weather: weatherData.summary || {},
      risks: {
        total: weatherData.risks?.length || 0,
        high: weatherData.risks?.filter(r => r.level === 'high').length || 0,
        medium: weatherData.risks?.filter(r => r.level === 'medium').length || 0
      },
      recommendation: this.generateRecommendation(weatherData, routeData)
    };

    return summary;
  }

  async generateRiskAlerts(weatherData, routeData) {
    const alerts = weatherData.risks || [];

    return {
      alerts,
      totalCount: alerts.length,
      highPriority: alerts.filter(a => a.level === 'high'),
      mediumPriority: alerts.filter(a => a.level === 'medium'),
      recommendations: this.generateRiskRecommendations(alerts)
    };
  }

  generateRecommendation(weatherData, routeData) {
    const risks = weatherData.risks || [];
    const highRisks = risks.filter(r => r.level === 'high');
    const mediumRisks = risks.filter(r => r.level === 'medium');

    if (highRisks.length > 0) {
      return {
        level: 'no_recomendado',
        message: 'Ruta no recomendada debido a condiciones meteorológicas adversas',
        details: highRisks.map(r => r.message)
      };
    }

    if (mediumRisks.length > 2) {
      return {
        level: 'precaucion',
        message: 'Ruta posible con precauciones especiales',
        details: mediumRisks.map(r => r.message)
      };
    }

    if (mediumRisks.length > 0) {
      return {
        level: 'atencion',
        message: 'Ruta recomendada con atención a las condiciones',
        details: mediumRisks.map(r => r.message)
      };
    }

    return {
      level: 'recomendado',
      message: 'Condiciones meteorológicas favorables para la ruta',
      details: []
    };
  }

  generateRiskRecommendations(alerts) {
    const recommendations = [];

    alerts.forEach(alert => {
      switch (alert.type) {
        case 'wind':
          recommendations.push('Llevar ropa cortaviento y asegurar objetos sueltos');
          break;
        case 'precipitation':
          recommendations.push('Llevar ropa impermeable y considerar diferir la salida');
          break;
        case 'temperature':
          if (alert.message.includes('extrema')) {
            recommendations.push('Revisar equipamiento térmico y hidratación');
          }
          break;
        case 'visibility':
          recommendations.push('Llevar linterna y GPS, evitar rutas técnicas');
          break;
      }
    });

    return [...new Set(recommendations)]; // Eliminar duplicados
  }
}

module.exports = TelegramFormatter;
