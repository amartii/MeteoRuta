const { Telegraf } = require('telegraf');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const messageHandler = require('./handlers/messageHandler');
const fileHandler = require('./handlers/fileHandler');
const rateLimiter = require('./middleware/rateLimiter');
const logger = require('./utils/logger');

class WeatherBot {
  constructor() {
    this.bot = new Telegraf(process.env.BOT_TOKEN);
    this.app = express();
    this.setupMiddleware();
    this.setupHandlers();
    this.setupWebhook();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(rateLimiter);

    // Middleware para logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  setupHandlers() {
    // Handler para comando start
    this.bot.start((ctx) => {
      const welcomeMessage = `
🌤️ <b>¡Hola! Soy tu asistente meteorológico para rutas</b>

📍 <b>¿Qué puedo hacer?</b>
• Analizar rutas descritas en texto
• Procesar archivos GPX
• Darte briefings meteorológicos detallados
• Alertarte sobre riesgos climáticos

📝 <b>Ejemplos de uso:</b>
"Voy a hacer una ruta por La Pedriza y pasar por el Yelmo, ¿qué tiempo habrá?"
"Ruta circular por Siete Picos saliendo mañana a las 8:00"

📎 <b>También puedes enviarme un archivo GPX</b> y te daré el pronóstico para toda la ruta.

¡Prueba describiendo tu próxima aventura! 🥾

<i>Tip: Sé específico con ubicaciones y horarios para mejores resultados</i>
      `;

      ctx.replyWithHTML(welcomeMessage);
      logger.info('User started bot', { userId: ctx.from.id, username: ctx.from.username });
    });

    // Handler para comando help
    this.bot.help((ctx) => {
      const helpMessage = `
🆘 <b>Ayuda - Asistente Meteorológico</b>

<b>Comandos disponibles:</b>
/start - Iniciar el bot
/help - Mostrar esta ayuda

<b>Cómo usar:</b>
1️⃣ <b>Describe tu ruta:</b>
   "Ruta por el Parque Nacional de Ordesa mañana"
   "Subida a Peñalara desde Cotos el sábado"

2️⃣ <b>Sube un archivo GPX:</b>
   Arrastra tu archivo .gpx al chat

3️⃣ <b>Sé específico:</b>
   • Menciona ubicaciones exactas
   • Indica día y hora de salida
   • Describe el tipo de ruta

<b>El bot te responderá con:</b>
• Previsión meteorológica por tramos
• Avisos de riesgo (viento, lluvia, etc.)
• Enlaces a fuentes detalladas
• Recomendaciones de seguridad

<b>Fuentes meteorológicas:</b>
• meteoblue (datos de alta precisión)
• OpenRouteService (routing)

¿Necesitas más ayuda? Escribe al desarrollador.
      `;

      ctx.replyWithHTML(helpMessage);
    });

    // Handler para mensajes de texto
    this.bot.on('text', async (ctx) => {
      try {
        await messageHandler.handleTextMessage(ctx);
      } catch (error) {
        logger.error('Error handling text message:', error);
        await ctx.reply('⚠️ Error procesando tu mensaje. Inténtalo de nuevo en unos momentos.');
      }
    });

    // Handler para archivos
    this.bot.on('document', async (ctx) => {
      try {
        await fileHandler.handleFileUpload(ctx);
      } catch (error) {
        logger.error('Error handling file:', error);
        await ctx.reply('⚠️ Error procesando el archivo. Asegúrate de que sea un GPX válido.');
      }
    });

    // Handler para ubicaciones
    this.bot.on('location', async (ctx) => {
      const { latitude, longitude } = ctx.message.location;
      try {
        const message = `📍 Ubicación recibida: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n\nPor favor, describe también tu ruta planned para obtener un briefing completo.`;
        await ctx.reply(message);
      } catch (error) {
        logger.error('Error handling location:', error);
      }
    });

    // Handler para mensajes no soportados
    this.bot.on('message', (ctx) => {
      ctx.reply('🤔 Tipo de mensaje no soportado. Envía texto describiendo tu ruta o un archivo GPX.');
    });

    // Handler para errores
    this.bot.catch((err, ctx) => {
      logger.error('Bot error:', { error: err.message, userId: ctx?.from?.id });
      if (ctx) {
        ctx.reply('⚠️ Ocurrió un error inesperado. El equipo técnico ha sido notificado.');
      }
    });
  }

  setupWebhook() {
    this.app.use(this.bot.webhookCallback('/webhook'));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'OK',
        service: 'telegram-bot',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
    });

    // Webhook info endpoint
    this.app.get('/webhook-info', async (req, res) => {
      try {
        const webhookInfo = await this.bot.telegram.getWebhookInfo();
        res.json(webhookInfo);
      } catch (error) {
        logger.error('Error getting webhook info:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Bot info endpoint
    this.app.get('/bot-info', async (req, res) => {
      try {
        const botInfo = await this.bot.telegram.getMe();
        res.json(botInfo);
      } catch (error) {
        logger.error('Error getting bot info:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      res.json({
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV,
        nodeVersion: process.version
      });
    });
  }

  async start() {
    const port = process.env.PORT || 3000;

    try {
      // Verificar token del bot
      const botInfo = await this.bot.telegram.getMe();
      logger.info('Bot info retrieved:', { username: botInfo.username, id: botInfo.id });

      // Configurar webhook si está en producción
      if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
        await this.bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`, {
          max_connections: 40,
          allowed_updates: ['message', 'callback_query']
        });
        logger.info('Webhook configured:', process.env.WEBHOOK_URL);
      } else {
        // Eliminar webhook en desarrollo y usar polling
        await this.bot.telegram.deleteWebhook();
        this.bot.launch();
        logger.info('Bot started in polling mode for development');
      }

      this.app.listen(port, () => {
        logger.info(`Server started on port ${port}`);
      });

      // Graceful shutdown
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));

    } catch (error) {
      logger.error('Error starting bot:', error);
      process.exit(1);
    }
  }
}

// Iniciar bot
const bot = new WeatherBot();
bot.start().catch(error => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
