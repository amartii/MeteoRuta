class BriefingTemplate {
  constructor() {
    this.templates = {
      standard: {
        name: 'Briefing Estándar',
        description: 'Formato completo con todos los detalles',
        sections: ['header', 'risks', 'segments', 'summary', 'links']
      },
      compact: {
        name: 'Briefing Compacto',
        description: 'Formato reducido para rutas simples',
        sections: ['header', 'risks', 'summary', 'links']
      },
      detailed: {
        name: 'Briefing Detallado',
        description: 'Formato extendido con análisis completo',
        sections: ['header', 'risks', 'segments', 'analysis', 'summary', 'recommendations', 'links']
      },
      emergency: {
        name: 'Alerta de Emergencia',
        description: 'Solo riesgos críticos y recomendaciones',
        sections: ['risks', 'recommendations']
      }
    };
  }

  getTemplate(templateName = 'standard') {
    return this.templates[templateName] || this.templates.standard;
  }

  getAvailableTemplates() {
    return Object.keys(this.templates).map(key => ({
      key,
      ...this.templates[key]
    }));
  }

  generateHeaderTemplate(routeData) {
    return {
      format: '🌤️ {title}\n📍 {subtitle}\n{timestamp} | {elevation}\n\n',
      variables: {
        title: 'Briefing Meteorológico',
        subtitle: `Ruta de {distance}km | ⏱️ {duration}h`,
        timestamp: 'Actualizado: {time}',
        elevation: '📈 Desnivel: +{gain}m'
      }
    };
  }

  generateRiskTemplate() {
    return {
      format: '🚨 <b>AVISOS DE RIESGO:</b>\n{risks}\n',
      riskFormat: '• {level_icon} {message} ({location})\n',
      levelIcons: {
        high: '🔴',
        medium: '🟡',
        low: '🟢'
      }
    };
  }

  generateSegmentTemplate() {
    return {
      format: '📍 <b>PREVISIÓN POR TRAMOS:</b>\n\n{segments}',
      segmentFormat: '<b>{index}. {time}</b> | {elevation}\n   {emoji} {temp} | 💨 {wind} {wind_dir} | 🌧️ {precip}\n   📍 {description}\n   <i>📡 {source}</i>\n\n'
    };
  }

  generateSummaryTemplate() {
    return {
      format: '📊 <b>RESUMEN:</b>\n🌡️ Temperatura: {temp_range}\n💨 Viento: {wind_range}\n⚠️ Nivel de riesgo: {risk_level}\n\n',
      variables: {
        temp_range: '{min_temp}°C - {max_temp}°C',
        wind_range: '{min_wind} - {max_wind} km/h'
      }
    };
  }

  generateLinksTemplate() {
    return {
      format: '<i>Consulta fuentes detalladas usando los botones de abajo</i>',
      keyboard: {
        inline_keyboard: [
          [
            { text: '🌊 Windy', url: '{windy_url}' },
            { text: '🔬 meteoblue', url: '{meteoblue_url}' }
          ],
          [
            { text: '🇪🇸 AEMET', url: '{aemet_url}' },
            { text: '☀️ Meteored', url: '{meteored_url}' }
          ]
        ]
      }
    };
  }

  generateCompactTemplate(data) {
    const template = `
🌤️ <b>Briefing Meteorológico Compacto</b>
📍 {route_summary}

{risk_summary}

📊 <b>Condiciones Generales:</b>
🌡️ {temp_range} | 💨 {wind_range}
☁️ {conditions} | ⚠️ Riesgo: {risk_level}

<i>Usa los botones para más detalles</i>
    `.trim();

    return template;
  }

  generateDetailedTemplate(data) {
    const template = `
🌤️ <b>Briefing Meteorológico Detallado</b>
📍 {route_info}
📈 {elevation_profile}

{risk_analysis}

📍 <b>ANÁLISIS POR TRAMOS:</b>
{detailed_segments}

📊 <b>ANÁLISIS ESTADÍSTICO:</b>
{weather_trends}
{confidence_analysis}

🎯 <b>RECOMENDACIONES:</b>
{recommendations}

📱 <b>Enlaces Útiles:</b>
{quick_links}
    `.trim();

    return template;
  }

  generateEmergencyTemplate(risks) {
    const template = `
🚨 <b>ALERTA METEOROLÓGICA</b>

⚠️ <b>RIESGOS CRÍTICOS DETECTADOS:</b>
{critical_risks}

🛑 <b>RECOMENDACIÓN:</b>
{emergency_recommendation}

📞 <b>Contactos de Emergencia:</b>
• 112 - Emergencias
• 062 - Guardia Civil (Montaña)

<b>NO IGNORAR ESTAS ALERTAS</b>
    `.trim();

    return template;
  }

  applyTemplate(templateName, data) {
    const template = this.getTemplate(templateName);

    switch (templateName) {
      case 'compact':
        return this.generateCompactTemplate(data);
      case 'detailed':
        return this.generateDetailedTemplate(data);
      case 'emergency':
        return this.generateEmergencyTemplate(data.risks);
      default:
        return this.generateStandardTemplate(data);
    }
  }

  generateStandardTemplate(data) {
    // Este es el template por defecto que ya está implementado
    // en el TelegramFormatter
    return null; // Se maneja en el formatter
  }

  interpolateVariables(template, variables) {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    }

    return result;
  }

  validateTemplate(templateName) {
    return templateName in this.templates;
  }

  addCustomTemplate(name, template) {
    this.templates[name] = template;
  }

  removeTemplate(name) {
    if (name !== 'standard') { // No permitir eliminar el template estándar
      delete this.templates[name];
    }
  }
}

module.exports = BriefingTemplate;
