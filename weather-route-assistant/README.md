# 🌤️ Asistente Meteorológico para Rutas

> **Asistente inteligente de Telegram que analiza rutas de senderismo y proporciona briefings meteorológicos detallados con avisos de riesgo.**

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![Docker](https://img.shields.io/badge/docker-required-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Características Principales

- 📍 **Procesamiento inteligente** de descripciones de rutas en lenguaje natural
- 📂 **Análisis completo de archivos GPX** con extracción de waypoints
- 🌦️ **Múltiples fuentes meteorológicas** (meteoblue, AEMET, Windy, Meteored)
- ⚠️ **Alertas automáticas de riesgo** meteorológico (viento, lluvia, temperatura)
- 🔗 **Enlaces directos** a información meteorológica detallada
- 🤖 **Interfaz de Telegram** fácil e intuitiva
- 🏗️ **Arquitectura de microservicios** escalable con Docker
- 📊 **Rate limiting inteligente** y caché con Redis

## 🚀 Inicio Rápido

### 1. Obtener el Proyecto

```bash
# Descargar y extraer el proyecto
unzip weather-route-assistant.zip
cd weather-route-assistant
```

### 2. Configuración Automática

```bash
# Ejecutar script de setup (instala todo automáticamente)
chmod +x scripts/*.sh
./scripts/setup.sh
```

### 3. Configurar API Keys

El script de setup creará un archivo `.env` que debes editar con tus claves:

```bash
# Editar configuración
nano .env
# o si tienes VS Code:
code .env
```

**API Keys necesarias:**
- **BOT_TOKEN**: Obtén desde [@BotFather](https://t.me/BotFather) en Telegram
- **METEOBLUE_API_KEY**: Registro gratuito en [meteoblue.com](https://meteoblue.com) (5k calls/año)
- **AEMET_API_KEY**: Gratis en [opendata.aemet.es](https://opendata.aemet.es) (para España)
- **ORS_API_KEY**: Gratis en [openrouteservice.org](https://openrouteservice.org) (2k calls/día)

### 4. ¡Listo para usar!

```bash
# Iniciar todos los servicios
npm run dev

# Verificar que todo funciona
npm run verify

# Ver logs en tiempo real
npm run logs
```

### 5. Probar el Bot

1. Busca tu bot en Telegram usando el username que configuraste
2. Envía `/start` para comenzar
3. Prueba con: `"Ruta por La Pedriza mañana por la mañana"`
4. O sube un archivo GPX para análisis completo

## 🏗️ Arquitectura del Sistema

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Telegram      │    │  Route          │    │  Weather        │
│   Bot           │───▶│  Processor      │───▶│  Orchestrator   │
│   (Puerto 3000) │    │  (Puerto 3001)  │    │  (Puerto 3002)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                                              │
         ▼                                              ▼
┌─────────────────┐                            ┌─────────────────┐
│  Response       │◀───────────────────────────│     Redis       │
│  Composer       │                            │    (Cache &     │
│  (Puerto 3003)  │                            │  Rate Limiting) │
└─────────────────┘                            └─────────────────┘
```

### Microservicios

- **🤖 Telegram Bot**: Interfaz principal con usuarios
- **🗺️ Route Processor**: Análisis de rutas y archivos GPX
- **🌦️ Weather Orchestrator**: Consulta y fusión de APIs meteorológicas
- **📝 Response Composer**: Generación de briefings estructurados
- **📊 Redis**: Cache inteligente y rate limiting

## 📊 Fuentes Meteorológicas

| Proveedor | Cobertura | Límites | Características |
|-----------|-----------|---------|-----------------|
| **meteoblue** | Global | 5,000/año | Alta precisión, nowcasting |
| **AEMET** | España | Ilimitado | Datos oficiales, gratuito |
| **Windy** | Global | 990€/año | Modelos avanzados, opcional |
| **Meteored** | Global | Variable | Requiere atribución |

## 🎛️ Comandos Disponibles

```bash
# Desarrollo
npm run dev          # Iniciar en desarrollo
npm run logs         # Ver logs en tiempo real
npm run stop         # Parar servicios

# Verificación
npm run verify       # Verificar configuración completa
npm run test         # Ejecutar tests básicos

# Producción
npm run prod         # Desplegar en producción
npm run clean        # Limpiar contenedores y volúmenes
```

## 🔧 Configuración Avanzada

### Variables de Entorno

```bash
# Configuración del Bot
BOT_TOKEN=tu_bot_token
WEBHOOK_URL=https://tu-dominio.com  # Solo para producción

# APIs Meteorológicas
METEOBLUE_API_KEY=tu_meteoblue_key
AEMET_API_KEY=tu_aemet_key
WINDY_API_KEY=tu_windy_key          # Opcional
METEORED_API_KEY=tu_meteored_key    # Opcional

# Routing
ORS_API_KEY=tu_openrouteservice_key

# Configuración Interna
NODE_ENV=development                # development/production
LOG_LEVEL=info                      # debug/info/warn/error
RATE_LIMIT_MAX_REQUESTS=30          # Requests por minuto
```

### Personalización

```bash
# Ajustar límites de rate limiting
# Editar: services/weather-orchestrator/src/cache/rateLimiter.js

# Modificar templates de respuesta
# Editar: services/response-composer/src/templates/briefingTemplate.js

# Configurar nuevos proveedores meteorológicos
# Añadir en: services/weather-orchestrator/src/providers/
```

## 🧪 Testing y Desarrollo

### Tests Locales

```bash
# Verificar servicios individuales
curl http://localhost:3000/health  # Bot
curl http://localhost:3001/health  # Route Processor
curl http://localhost:3002/health  # Weather Orchestrator
curl http://localhost:3003/health  # Response Composer

# Test funcional completo
./scripts/test.sh

# Test de API específica
curl -X POST http://localhost:3001/process-description \
  -H "Content-Type: application/json" \
  -d '{"description": "Ruta por La Pedriza", "userId": "test"}'
```

### Debugging

```bash
# Ver logs específicos
docker-compose logs -f telegram-bot
docker-compose logs -f weather-orchestrator

# Entrar en contenedor
docker exec -it weather-telegram-bot /bin/sh

# Verificar Redis
docker exec -it weather-redis redis-cli
> KEYS "*"
> GET "rate_limit:meteoblue:global"
```

## 🚨 Solución de Problemas

### Bot no responde

```bash
# Verificar token
curl "https://api.telegram.org/bot$BOT_TOKEN/getMe"

# Verificar webhook
curl http://localhost:3000/webhook-info

# Revisar logs
docker-compose logs telegram-bot
```

### APIs meteorológicas fallan

```bash
# Verificar claves
./scripts/verify.sh

# Ver estadísticas de rate limiting
curl http://localhost:3002/providers-status

# Reset manual de límites (solo desarrollo)
docker exec weather-redis redis-cli FLUSHALL
```

### Servicios no inician

```bash
# Verificar puertos libres
sudo lsof -i :3000

# Limpiar Docker
docker system prune -f
docker-compose down -v

# Reconstruir desde cero
docker-compose up --build --force-recreate
```

## 📈 Monitoreo y Métricas

### Endpoints de Salud

- `GET /health` - Estado general de cada servicio
- `GET /metrics` - Métricas de rendimiento (telegram-bot)
- `GET /providers-status` - Estado de APIs meteorológicas (weather-orchestrator)

### Logs

Los logs se guardan en `services/*/logs/`:
- `error.log` - Solo errores
- `combined.log` - Todos los eventos

```bash
# Rotación automática (5MB, 5 archivos)
# Configurado en cada servicio
```

## 🔒 Seguridad

- **Rate limiting** por usuario (30 requests/minuto)
- **Validación de entrada** en todos los endpoints
- **Contenedores no-root** para todos los servicios
- **Helmet.js** para headers de seguridad
- **Variables de entorno** para credenciales

## 🌟 Contribuir

1. **Fork** del proyecto
2. **Crear rama** feature (`git checkout -b feature/nueva-funcionalidad`)
3. **Commit** cambios (`git commit -am 'Añadir nueva funcionalidad'`)
4. **Push** a la rama (`git push origin feature/nueva-funcionalidad`)
5. **Crear Pull Request**

### Desarrollo Local

```bash
# Configurar entorno de desarrollo
npm install
cd services/telegram-bot && npm install
cd ../route-processor && npm install
cd ../weather-orchestrator && npm install
cd ../response-composer && npm install
```

## 📋 Requisitos del Sistema

- **Node.js** 18.0 o superior
- **Docker** 20.10 o superior  
- **Docker Compose** 2.0 o superior
- **4GB RAM** mínimo recomendado
- **Conexión a Internet** para APIs

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver archivo [LICENSE](LICENSE) para detalles.

## 🙏 Agradecimientos

- [meteoblue](https://meteoblue.com) por su excelente API meteorológica
- [AEMET](https://aemet.es) por proporcionar datos oficiales gratuitos
- [OpenRouteService](https://openrouteservice.org) por servicios de routing
- [Telegraf](https://telegraf.js.org) por el framework de bots
- Comunidad open source por todas las librerías utilizadas

## 📞 Soporte

- **Documentación**: Ver carpeta `docs/`
- **Issues**: Crear issue en GitHub
- **Telegram**: Buscar ayuda en la comunidad

---

<p align="center">
  <b>🥾⛅ ¡Disfruta de tus rutas con total seguridad meteorológica!</b>
</p>
