#!/bin/bash
# verify.sh - Verificación completa del sistema

set -e

echo "🔍 Verificando configuración del asistente meteorológico..."
echo "========================================================"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar variables de entorno
echo "📋 Verificando variables de entorno..."
source .env 2>/dev/null || {
    echo -e "${RED}❌ Archivo .env no encontrado${NC}"
    exit 1
}

required_vars=("BOT_TOKEN" "METEOBLUE_API_KEY" "AEMET_API_KEY" "ORS_API_KEY")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
        echo -e "   ${RED}❌ $var: NO CONFIGURADA${NC}"
    else
        echo -e "   ${GREEN}✅ $var: CONFIGURADA${NC}"
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo -e "\n${YELLOW}⚠️  Variables faltantes: ${missing_vars[*]}${NC}"
    echo "   Edita el archivo .env antes de continuar"
    exit 1
fi

echo ""

# Verificar servicios Docker
echo "🐳 Verificando servicios Docker..."
services=("weather-redis" "weather-telegram-bot" "weather-route-processor" "weather-orchestrator" "weather-response-composer")

all_running=true
for service in "${services[@]}"; do
    if docker ps --filter name="$service" --filter status=running -q | grep -q .; then
        echo -e "   ${GREEN}✅ $service: EJECUTÁNDOSE${NC}"
    else
        echo -e "   ${RED}❌ $service: NO EJECUTÁNDOSE${NC}"
        all_running=false
    fi
done

if [ "$all_running" = false ]; then
    echo -e "\n${YELLOW}💡 Sugerencia: Ejecuta 'npm run dev' para iniciar los servicios${NC}"
fi

echo ""

# Verificar APIs de salud
echo "🏥 Verificando endpoints de salud..."
ports=(3000 3001 3002 3003)
service_names=("Telegram Bot" "Route Processor" "Weather Orchestrator" "Response Composer")

for i in "${!ports[@]}"; do
    port=${ports[$i]}
    name=${service_names[$i]}

    if curl -f -s http://localhost:$port/health > /dev/null 2>&1; then
        echo -e "   ${GREEN}✅ $name (puerto $port): OK${NC}"
    else
        echo -e "   ${RED}❌ $name (puerto $port): NO RESPONDE${NC}"
    fi
done

echo ""

# Verificar Redis
echo "📊 Verificando Redis..."
if docker exec weather-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
    echo -e "   ${GREEN}✅ Redis: FUNCIONANDO${NC}"
else
    echo -e "   ${RED}❌ Redis: NO FUNCIONA${NC}"
fi

echo ""

# Test básico de APIs externas
echo "🌐 Probando APIs externas..."

# Test meteoblue (coordenadas de Madrid)
if [ -n "$METEOBLUE_API_KEY" ]; then
    echo -n "   Probando meteoblue... "
    if curl -f -s "https://my.meteoblue.com/packages/basic-1h?lat=40.4&lon=-3.7&apikey=$METEOBLUE_API_KEY" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${RED}❌ FALLO${NC}"
    fi
fi

# Test AEMET
if [ -n "$AEMET_API_KEY" ]; then
    echo -n "   Probando AEMET... "
    if curl -f -s "https://opendata.aemet.es/opendata/api/valores/climatologicos/inventarioestaciones/todasestaciones/?api_key=$AEMET_API_KEY" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${YELLOW}⚠️  FALLO (puede ser normal si la clave es nueva)${NC}"
    fi
fi

# Test OpenRouteService
if [ -n "$ORS_API_KEY" ]; then
    echo -n "   Probando OpenRouteService... "
    if curl -f -s -X POST "https://api.openrouteservice.org/v2/directions/foot-walking" \
         -H "Authorization: $ORS_API_KEY" \
         -H "Content-Type: application/json" \
         -d '{"coordinates":[[-3.7,40.4],[-3.69,40.41]]}' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${RED}❌ FALLO${NC}"
    fi
fi

echo ""
echo "🎯 Resumen de la verificación:"
echo "============================="

# Mostrar información del bot
if [ -n "$BOT_TOKEN" ]; then
    echo -n "🤖 Verificando bot de Telegram... "
    bot_info=$(curl -s "https://api.telegram.org/bot$BOT_TOKEN/getMe" 2>/dev/null || echo "")
    if echo "$bot_info" | grep -q '"ok":true' 2>/dev/null; then
        bot_username=$(echo "$bot_info" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
        echo -e "${GREEN}✅ Bot configurado: @$bot_username${NC}"
        echo "   Búscalo en Telegram para empezar a usarlo"
    else
        echo -e "${RED}❌ Token de bot inválido${NC}"
    fi
fi

# Mostrar URLs útiles
echo ""
echo "🔗 URLs importantes:"
echo "   • Salud general: http://localhost:3000/health"
echo "   • Info webhook: http://localhost:3000/webhook-info"
echo "   • Logs en vivo: docker-compose logs -f"

echo ""
if [ "$all_running" = true ] && [ ${#missing_vars[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ ¡Todo está funcionando correctamente!${NC}"
    echo -e "${GREEN}🎉 El asistente está listo para usar${NC}"
else
    echo -e "${YELLOW}⚠️  Algunos componentes necesitan atención${NC}"
    echo -e "${YELLOW}💡 Revisa los errores de arriba y sigue las sugerencias${NC}"
fi
