const axios = require('axios');
const logger = require('../utils/logger');

class FileHandler {
  async handleFileUpload(ctx) {
    const document = ctx.message.document;
    const userId = ctx.from.id;

    // Verificar que sea un archivo GPX
    if (!document.file_name || !document.file_name.toLowerCase().endsWith('.gpx')) {
      return ctx.reply(
        '📄 Solo acepto archivos GPX válidos.\n\n' +
        '💡 <b>Cómo obtener un archivo GPX:</b>\n' +
        '• Exportar desde Strava, Garmin Connect, etc.\n' +
        '• Descargar de Wikiloc\n' +
        '• Crear con aplicaciones como Komoot\n\n' +
        'Luego súbelo aquí para obtener tu briefing meteorológico 🌤️',
        { parse_mode: 'HTML' }
      );
    }

    // Verificar tamaño del archivo (máximo 10MB)
    if (document.file_size > 10 * 1024 * 1024) {
      return ctx.reply('⚠️ El archivo es demasiado grande. Máximo 10MB permitido.');
    }

    const statusMessage = await ctx.reply('📂 Descargando archivo GPX...');

    try {
      logger.info('Processing GPX file:', {
        userId,
        username: ctx.from.username,
        fileName: document.file_name,
        fileSize: document.file_size
      });

      // 1. Descargar archivo
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '📥 Descargando y analizando archivo GPX...'
      );

      const fileUrl = await ctx.telegram.getFileLink(document.file_id);
      const fileResponse = await axios.get(fileUrl, { 
        timeout: 30000,
        responseType: 'text'
      });
      const gpxContent = fileResponse.data;

      // 2. Procesar GPX
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '🗺️ Procesando track GPX y extrayendo waypoints...'
      );

      const routeData = await this.processGPXFile(gpxContent, userId, document.file_name);

      // 3. Obtener datos meteorológicos
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '🌦️ Consultando pronóstico meteorológico...'
      );

      const weatherData = await this.getWeatherForRoute(routeData);

      // 4. Componer respuesta
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        '📊 Generando briefing meteorológico...'
      );

      const briefing = await this.composeBriefing(weatherData, routeData);

      // 5. Enviar respuesta final
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id);

      if (briefing.keyboard) {
        await ctx.replyWithHTML(briefing.text, { reply_markup: briefing.keyboard });
      } else {
        await ctx.replyWithHTML(briefing.text);
      }

      // Log successful processing
      logger.info('Successfully processed GPX file:', {
        userId,
        username: ctx.from.username,
        fileName: document.file_name,
        routeDistance: routeData.totalDistance,
        routePoints: routeData.waypoints?.length || 0
      });

    } catch (error) {
      logger.error('Error processing GPX file:', error);

      let errorMessage = '⚠️ Error procesando el archivo GPX.\n\n';

      if (error.message.includes('parsing') || error.message.includes('GPX')) {
        errorMessage += '📄 <b>Archivo no válido:</b> El archivo GPX parece estar corrupto.\n';
      } else if (error.message.includes('timeout')) {
        errorMessage += '🕐 <b>Timeout:</b> El archivo es muy grande o las APIs están lentas.\n';
      } else if (error.message.includes('tracks') || error.message.includes('waypoints')) {
        errorMessage += '🗺️ <b>Sin datos de ruta:</b> El GPX no contiene tracks válidos.\n';
      } else {
        errorMessage += '🔧 <b>Error técnico:</b> Problema procesando el archivo.\n';
      }

      errorMessage += '\n💡 <b>Sugerencias:</b>\n';
      errorMessage += '• Verifica que el archivo sea un GPX válido\n';
      errorMessage += '• Prueba con un archivo más pequeño\n';
      errorMessage += '• Re-exporta desde tu aplicación\n';
      errorMessage += '• Intenta describir la ruta en texto';

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        undefined,
        errorMessage,
        { parse_mode: 'HTML' }
      );
    }
  }

  async processGPXFile(gpxContent, userId, fileName) {
    try {
      const response = await axios.post(
        `${process.env.ROUTE_PROCESSOR_URL}/process-gpx`,
        {
          gpxContent,
          userId,
          fileName,
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
        throw new Error('Timeout procesando archivo GPX');
      }
      if (error.response?.status === 400) {
        throw new Error('Archivo GPX no válido o corrupto');
      }
      throw new Error(`Error procesando GPX: ${error.message}`);
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
      throw new Error(`Error componiendo respuesta: ${error.message}`);
    }
  }
}

module.exports = new FileHandler();
