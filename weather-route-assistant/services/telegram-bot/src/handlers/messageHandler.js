const axios = require('axios');
const logger = require('../utils/logger');

class MessageHandler {
  async handleTextMessage(ctx) {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;

    // Ignorar comandos que ya están manejados
    if (messageText.startsWith('/')) {
      return;
    }

    const statusMessage = await ctx.reply('🔍 Procesando tu consulta meteorológica...');

    try {
      // Validar entrada
      if (messageText.length < 10) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          '❌ Por favor, describe tu ruta con más detalle.\n\n' +
          '📝 <b>Ejemplo:</b>\n' +
          '"Ruta por La Pedriza subiendo al Yelmo mañana por la mañana"\n\n' +
          '💡 <b>Incluye:</b>\n' +
          '• Ubicación específica\n' +
          '• Día y hora aproximada\n' +
          '• Tipo de ruta (circular, lineal, etc.)',
          { parse_mode: 'HTML' }
        );
        return;
      }

      logger.info('Processing route description:', {
        userId,
        username: ctx.from.username,
        messageLength: messageText.length,
        preview: messageText.substring(0, 100)
      });

      // 1. Procesar descripción de ruta
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '🗺️ Analizando descripción de ruta...'
      );

      const routeData = await this.processRouteDescription(messageText, userId);

      // 2. Obtener datos meteorológicos
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '🌦️ Consultando fuentes meteorológicas...'
      );

      const weatherData = await this.getWeatherForRoute(routeData);

      // 3. Componer respuesta
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '📊 Generando briefing meteorológico...'
      );

      const briefing = await this.composeBriefing(weatherData, routeData);

      // 4. Enviar respuesta final
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id);

      if (briefing.keyboard) {
        await ctx.replyWithHTML(briefing.text, { reply_markup: briefing.keyboard });
      } else {
        await ctx.replyWithHTML(briefing.text);
      }

      // Log successful processing
      logger.info('Successfully processed route request:', {
        userId,
        username: ctx.from.username,
        routePoints: routeData.waypoints?.length || 0,
        weatherSources: weatherData.sources?.length || 0
      });

    } catch (error) {
      logger.error('Error processing text message:', error);

      let errorMessage = '⚠️ Error procesando la consulta.\n\n';

      if (error.message.includes('timeout') || error.message.includes('ECONNABORTED')) {
        errorMessage += '🕐 <b>Timeout:</b> Las APIs meteorológicas están tardando más de lo normal.\n';
      } else if (error.message.includes('API key') || error.message.includes('401')) {
        errorMessage += '🔑 <b>Error de autenticación:</b> Problema con las claves API.\n';
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage += '⏰ <b>Límite alcanzado:</b> Demasiadas consultas recientes.\n';
      } else if (error.message.includes('ubicación') || error.message.includes('not found')) {
        errorMessage += '📍 <b>Ubicación no encontrada:</b> Intenta ser más específico.\n';
      } else {
        errorMessage += '🔧 <b>Error técnico:</b> Problema temporal del sistema.\n';
      }

      errorMessage += '\n💡 <b>Sugerencias:</b>\n';
      errorMessage += '• Intenta de nuevo en unos momentos\n';
      errorMessage += '• Sé más específico con la ubicación\n';
      errorMessage += '• Usa nombres de lugares conocidos\n';
      errorMessage += '• Incluye día y hora de salida';

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        errorMessage,
        { parse_mode: 'HTML' }
      );
    }
  }

  async processRouteDescription(description, userId) {
    try {
      const response = await axios.post(
        `${process.env.ROUTE_PROCESSOR_URL}/process-description`,
        {
          description,
          userId,
          timestamp: new Date().toISOString()
        },
        { 
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout procesando la ruta');
      }
      if (error.response?.status === 400) {
        throw new Error('Descripción de ruta no válida');
      }
      if (error.response?.status === 404) {
        throw new Error('Ubicación no encontrada');
      }
      throw new Error(`Error en servicio de rutas: ${error.message}`);
    }
  }

  async getWeatherForRoute(routeData) {
    try {
      const response = await axios.post(
        `${process.env.WEATHER_ORCHESTRATOR_URL}/weather-for-route`,
        routeData,
        { 
          timeout: 45000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout obteniendo datos meteorológicos');
      }
      if (error.response?.status === 429) {
        throw new Error('Límite de rate limiting alcanzado');
      }
      throw new Error(`Error en servicio meteorológico: ${error.message}`);
    }
  }

  async composeBriefing(weatherData, routeData) {
    try {
      const response = await axios.post(
        `${process.env.RESPONSE_COMPOSER_URL}/compose-briefing`,
        {
          weatherData,
          routeData,
          timestamp: new Date().toISOString()
        },
        { 
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout componiendo respuesta');
      }
      throw new Error(`Error componiendo respuesta: ${error.message}`);
    }
  }
}

module.exports = new MessageHandler();
