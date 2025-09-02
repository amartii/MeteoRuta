#!/bin/bash
# test.sh - Tests básicos del sistema

echo "🧪 Ejecutando tests del asistente meteorológico..."

# Test de conectividad de servicios
echo "📡 Testeando conectividad de servicios..."

services=("3000" "3001" "3002" "3003")
names=("telegram-bot" "route-processor" "weather-orchestrator" "response-composer")

for i in "${!services[@]}"; do
    port=${services[$i]}
    name=${names[$i]}

    echo -n "   Testing $name... "
    if curl -f -s http://localhost:$port/health > /dev/null; then
        echo "✅ OK"
    else
        echo "❌ FAIL"
    fi
done

# Test funcional básico
echo ""
echo "🔬 Ejecutando test funcional..."

echo -n "   Test procesamiento de ruta... "
response=$(curl -s -X POST http://localhost:3001/process-description \
    -H "Content-Type: application/json" \
    -d '{"description": "Ruta por La Pedriza", "userId": "test123"}' 2>/dev/null)

if echo "$response" | grep -q "waypoints" 2>/dev/null; then
    echo "✅ OK"
else
    echo "❌ FAIL"
fi

echo ""
echo "Tests completados."
