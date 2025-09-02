#!/bin/bash
# setup.sh - Configuración inicial del asistente meteorológico

set -e

echo "🚀 Configurando asistente meteorológico para rutas..."
echo "=================================================="

# Verificar dependencias
echo "📋 Verificando dependencias del sistema..."

command -v docker >/dev/null 2>&1 || { 
    echo "❌ Docker no está instalado"
    echo "   Instalar desde: https://docs.docker.com/get-docker/"
    exit 1
}

command -v docker-compose >/dev/null 2>&1 || command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || {
    echo "❌ Docker Compose no está instalado"
    echo "   Instalar desde: https://docs.docker.com/compose/install/"
    exit 1
}

command -v node >/dev/null 2>&1 || { 
    echo "❌ Node.js no está instalado"
    echo "   Instalar desde: https://nodejs.org/"
    exit 1
}

echo "✅ Todas las dependencias están instaladas"

# Crear .env si no existe
if [ ! -f .env ]; then
    echo "📝 Creando archivo .env desde template..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANTE: Debes editar el archivo .env con tus API keys"
    echo "   Abre .env en tu editor favorito y configura:"
    echo "   - BOT_TOKEN (desde @BotFather en Telegram)"
    echo "   - METEOBLUE_API_KEY (desde meteoblue.com)"
    echo "   - AEMET_API_KEY (desde opendata.aemet.es)"
    echo "   - ORS_API_KEY (desde openrouteservice.org)"
    echo ""
    read -p "¿Quieres abrir el archivo .env ahora? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if command -v code >/dev/null 2>&1; then
            code .env
        elif command -v nano >/dev/null 2>&1; then
            nano .env
        elif command -v vim >/dev/null 2>&1; then
            vim .env
        else
            echo "Abre manualmente el archivo .env con tu editor favorito"
        fi
    fi
else
    echo "📝 Archivo .env ya existe"
fi

# Crear directorios de logs
echo "📁 Creando directorios de logs..."
mkdir -p services/telegram-bot/logs
mkdir -p services/route-processor/logs  
mkdir -p services/weather-orchestrator/logs
mkdir -p services/response-composer/logs
echo "✅ Directorios de logs creados"

# Instalar dependencias principales
echo "📦 Instalando dependencias principales..."
npm install

# Instalar dependencias de servicios
echo "📦 Instalando dependencias de servicios..."
for service in services/*/; do
    if [ -f "$service/package.json" ]; then
        echo "   📦 Instalando para $(basename "$service")..."
        (cd "$service" && npm install --silent)
    fi
done

echo "✅ Todas las dependencias instaladas"

# Construir imágenes Docker
echo "🐳 Construyendo imágenes Docker..."
docker-compose build

echo ""
echo "✅ Setup completado exitosamente!"
echo ""
echo "🎯 Próximos pasos:"
echo "1. Configurar API keys en el archivo .env"
echo "2. Ejecutar: npm run dev"
echo "3. Probar el bot en Telegram"
echo ""
echo "📚 Comandos útiles:"
echo "   npm run dev     - Iniciar en desarrollo"
echo "   npm run logs    - Ver logs en tiempo real" 
echo "   npm run stop    - Parar servicios"
echo "   npm run verify  - Verificar configuración"
echo ""
echo "🔗 Enlaces importantes:"
echo "   Telegram Bot: https://t.me/BotFather"
echo "   meteoblue: https://www.meteoblue.com/"
echo "   AEMET: https://opendata.aemet.es/"
echo "   OpenRouteService: https://openrouteservice.org/"
