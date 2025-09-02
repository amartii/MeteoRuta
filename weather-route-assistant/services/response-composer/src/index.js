const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const BriefingComposer = require('./formatters/telegramFormatter');
const BriefingTemplate = require('./templates/briefingTemplate');
const logger = require('./utils/logger');

const app = express();
const port = process.env.PORT || 3003;

// Instanciar servicios
const briefingComposer = new BriefingComposer();
const briefingTemplate = new BriefingTemplate();

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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'response-composer',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Componer briefing meteorológico completo
app.post('/compose-briefing', async (req, res) => {
  try {
    const { weatherData, routeData, timestamp } = req.body;

    if (!weatherData || !routeData) {
      return res.status(400).json({ 
        error: 'Datos meteorológicos y de ruta requeridos',
        details: 'Se requieren weatherData y routeData'
      });
    }

    logger.info('Composing briefing:', {
      weatherDataPoints: weatherData.weatherData?.length || 0,
      routeWaypoints: routeData.waypoints?.length || 0,
      routeDistance: routeData.totalDistance
    });

    // Generar briefing completo
    const briefing = await briefingComposer.composeBriefing(weatherData, routeData);

    logger.info('Briefing composed successfully:', {
      textLength: briefing.text?.length || 0,
      hasKeyboard: !!briefing.keyboard,
      risksCount: weatherData.risks?.length || 0
    });

    res.json(briefing);

  } catch (error) {
    logger.error('Error composing briefing:', error);
    res.status(500).json({ 
      error: 'Error componiendo briefing meteorológico',
      details: error.message 
    });
  }
});

// Generar resumen ejecutivo
app.post('/executive-summary', async (req, res) => {
  try {
    const { weatherData, routeData } = req.body;

    const summary = await briefingComposer.generateExecutiveSummary(weatherData, routeData);

    res.json(summary);

  } catch (error) {
    logger.error('Error generating executive summary:', error);
    res.status(500).json({ 
      error: 'Error generando resumen ejecutivo',
      details: error.message 
    });
  }
});

// Generar alertas de riesgo
app.post('/risk-alerts', async (req, res) => {
  try {
    const { weatherData, routeData } = req.body;

    const alerts = await briefingComposer.generateRiskAlerts(weatherData, routeData);

    res.json(alerts);

  } catch (error) {
    logger.error('Error generating risk alerts:', error);
    res.status(500).json({ 
      error: 'Error generando alertas de riesgo',
      details: error.message 
    });
  }
});

// Generar enlaces rápidos
app.post('/quick-links', async (req, res) => {
  try {
    const { routeData, weatherData } = req.body;

    const links = await briefingComposer.generateQuickLinks(routeData, weatherData);

    res.json(links);

  } catch (error) {
    logger.error('Error generating quick links:', error);
    res.status(500).json({ 
      error: 'Error generando enlaces rápidos',
      details: error.message 
    });
  }
});

// Formatear mensaje para Telegram
app.post('/format-telegram', async (req, res) => {
  try {
    const { briefingData } = req.body;

    const formatted = await briefingComposer.formatForTelegram(briefingData);

    res.json(formatted);

  } catch (error) {
    logger.error('Error formatting for Telegram:', error);
    res.status(500).json({ 
      error: 'Error formateando para Telegram',
      details: error.message 
    });
  }
});

// Obtener templates disponibles
app.get('/templates', (req, res) => {
  try {
    const templates = briefingTemplate.getAvailableTemplates();
    res.json(templates);
  } catch (error) {
    logger.error('Error getting templates:', error);
    res.status(500).json({ 
      error: 'Error obteniendo templates',
      details: error.message 
    });
  }
});

// Error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: error.message 
  });
});

app.listen(port, () => {
  logger.info(`Response composer listening on port ${port}`);
});
