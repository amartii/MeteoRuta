#!/bin/bash
# deploy.sh - Script de despliegue para producción

set -e

echo "🚀 Desplegando asistente meteorológico en producción..."
echo "====================================================="

# Verificar que estamos en el directorio correcto
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml no encontrado"
    echo "   Ejecuta este script desde la raíz del proyecto"
    exit 1
fi

# Verificar variables de entorno críticas
echo "📋 Verificando configuración para producción..."

source .env 2>/dev/null || {
    echo "❌ Error: Archivo .env no encontrado"
    echo "   Copia .env.example a .env y configúralo"
    exit 1
}

required_vars=("BOT_TOKEN" "METEOBLUE_API_KEY" "AEMET_API_KEY" "ORS_API_KEY")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "❌ Error: Variables faltantes: ${missing_vars[*]}"
    echo "   Configúralas en el archivo .env"
    exit 1
fi

# Verificar NODE_ENV
if [ "$NODE_ENV" != "production" ]; then
    echo "⚠️  Advertencia: NODE_ENV no está configurado como 'production'"
    read -p "¿Continuar de todas formas? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Configuración verificada"

# Parar servicios existentes
echo "⏹️  Parando servicios existentes..."
docker-compose down

# Limpiar imágenes antiguas si se solicita
read -p "¿Reconstruir imágenes desde cero? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 Limpiando imágenes antiguas..."
    docker-compose down --rmi all
    docker system prune -f
fi

# Construir imágenes
echo "🔨 Construyendo imágenes para producción..."
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache

# Iniciar servicios en producción
echo "🚀 Iniciando servicios en modo producción..."
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Esperar que los servicios estén listos
echo "⏳ Esperando que los servicios estén listos..."
sleep 30

# Verificar salud de servicios
echo "🏥 Verificando salud de servicios..."
services_ok=true

for port in 3000 3001 3002 3003; do
    if curl -f -s http://localhost:$port/health > /dev/null 2>&1; then
        echo "✅ Servicio en puerto $port: OK"
    else
        echo "❌ Servicio en puerto $port: FALLO"
        services_ok=false
    fi
done

# Configurar webhook de Telegram si está configurado
if [[ -n "$WEBHOOK_URL" && "$NODE_ENV" == "production" ]]; then
    echo "🔗 Configurando webhook de Telegram..."
    webhook_response=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
         -d "url=${WEBHOOK_URL}/webhook" \
         -d "max_connections=40")

    if echo "$webhook_response" | grep -q '"ok":true'; then
        echo "✅ Webhook configurado correctamente"
    else
        echo "⚠️  Error configurando webhook:"
        echo "$webhook_response"
    fi
else
    echo "ℹ️  Webhook no configurado (modo polling)"
fi

echo ""
echo "📊 Estado del despliegue:"
echo "========================"

# Mostrar estado de contenedores
docker-compose ps

echo ""
echo "🔗 URLs importantes:"
echo "   • Salud general: http://localhost:3000/health"
echo "   • Bot info: http://localhost:3000/bot-info"
echo "   • Logs: docker-compose logs -f"

if [ "$services_ok" = true ]; then
    echo ""
    echo "✅ ¡Despliegue completado exitosamente!"
    echo "🤖 El bot está listo para recibir mensajes"

    # Mostrar información del bot
    if [ -n "$BOT_TOKEN" ]; then
        bot_info=$(curl -s "https://api.telegram.org/bot$BOT_TOKEN/getMe" 2>/dev/null || echo "")
        if echo "$bot_info" | grep -q '"ok":true'; then
            bot_username=$(echo "$bot_info" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
            echo "🔍 Busca @$bot_username en Telegram para probarlo"
        fi
    fi
else
    echo ""
    echo "⚠️  Algunos servicios tienen problemas"
    echo "💡 Revisa los logs: docker-compose logs"
    exit 1
fi
