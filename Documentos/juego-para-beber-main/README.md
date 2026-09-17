# Aproximados

Juego multijugador de estimaciones numéricas para 2–12 personas. Angular 21 + ASP.NET Core 8 + SignalR. Gemini consulta la respuesta y comenta el resultado.

## Jugar

1. Crea una sala, elige de 1 a 20 rondas y comparte el código de cuatro letras o el enlace.
2. El anfitrión selecciona el modo en la sala:
   - **Solo pregunta:** el redactor escribe la pregunta y no responde.
   - **Todos responden:** el redactor también envía su estimación secreta.
3. El redactor propone una pregunta con respuesta numérica comprobable. Gemini investiga mientras los demás estiman.
4. Las estimaciones permanecen privadas hasta el resultado. Cada jugador recibe entre **0 y 100 puntos** continuos mediante una fórmula que combina **60 % precisión absoluta** (distancia multiplicativa logarítmica) y **40 % rendimiento relativo** respecto a la mejor aproximación de la ronda. Un acierto exacto otorga 100 puntos; respuestas cercanas otorgan puntuaciones altas y graduales; y ganar una ronda difícil premia el mérito relativo (~40 pts) sin regalar el 100 %.
   - Cada jugador dispone de un **Doble o nada** secreto por partida. Si lo activa y queda dentro del 10 % de error, duplica los puntos de esa ronda; si supera el 10 %, obtiene 0. El comodín se devuelve si Gemini invalida la pregunta.
5. La menor desviación permite repartir **1 trago** a otra persona y redactar la siguiente pregunta. El último bebe 1 trago; un error de al menos 1000 % supone 2. Quienes empatan comparten puesto y puntuación. Un ganador no recibe castigo de perdedor.
6. Si todos los demás participantes responden con un error de como máximo el 1 %, el redactor recibe 1 trago por pregunta demasiado fácil.
7. El ganador conectado redacta la siguiente pregunta. Los empates se resuelven de forma estable para elegir turno. El anfitrión avanza cuando termina el reparto de los ganadores conectados. Tras la última ronda la sala se queda en resultados para el podio; no se cierra sola.

El error se calcula respecto al valor absoluto de la respuesta; para respuesta cero se usa denominador 1. Se aceptan números negativos, coma decimal y hasta ±10¹⁵. Las respuestas sin dato verificable vuelven a la escritura de pregunta sin puntuar.

## Arranque local

Requisitos: .NET SDK 8, Node 20.19+ (o 22.12+/24), npm.

```bash
# En la raíz del proyecto. Configura tu clave en el entorno del backend:
export GEMINI_API_KEY='tu-clave'
./scripts/dev.sh
```

Abre `http://localhost:4300`. El script muestra también la dirección para móviles en la misma Wi-Fi. En desarrollo el backend admite orígenes de la red local (`192.168.x`, `10.x`, etc.) y el frontend escucha en `0.0.0.0:4300`. Sin clave se pueden probar las salas, modos y estimaciones; al consultar una pregunta se muestra el error y se permite escribir otra.

El modelo se conserva fijado en **`gemini-3.5-flash-lite`**. El cliente no recibe la clave. No guardes credenciales en archivos del frontend.

Para ejecutar por separado:

```bash
ASPNETCORE_ENVIRONMENT=Development dotnet run --project backend/Aproximados.Api --urls http://localhost:5000
# En otra terminal:
cd frontend
npm ci
npm start -- --port 4300
```

## Verificación

```bash
dotnet test backend/Aproximados.Api/Tests/Aproximados.Api.Tests.csproj
cd frontend
npm run build:prod
CHROME_BIN=/usr/bin/google-chrome npm test
```

Con ambos servidores locales en marcha, `node scripts/security-check.cjs` comprueba sesiones y permisos por SignalR. `scripts/browser-check.cjs` prueba tres navegadores, ambos modos, invitaciones, reconexión y tamaños móviles. Requiere Playwright (`PLAYWRIGHT_PATH` permite usar una instalación existente) y un backend **sin clave** para comprobar la recuperación ante IA no disponible. `CHROME_BIN` y `APP_URL` son configurables.

## Despliegue

El frontend de producción utiliza la API configurada en `frontend/src/environments/environment.prod.ts`. El backend debe incluir el origen exacto del frontend en `Cors:AllowedOrigins`. Despliega backend y frontend juntos para habilitar los nuevos modos y el reparto.

Docker usa el frontend con proxy `/gamehub` hacia el backend. Configura `GEMINI_API_KEY` y el origen del frontend antes de `docker compose up --build`.

Las salas viven en memoria: reiniciar el backend elimina las partidas. La sesión privada permite recuperar el asiento durante desconexiones breves; no compartas ese token. Las salas inactivas se limpian automáticamente.

## Comprobación visual móvil

Después de `npm run build:prod`, con el servidor de desarrollo abierto:

```bash
PLAYWRIGHT_PATH=/ruta/a/playwright node scripts/mobile-ui-check.cjs
```

La prueba sirve el build de producción con la política CSP de Vercel, verifica que sus estilos se aplican y revisa pantallas de 320, 360, 390, 430, 768 y 1440 píxeles. Las pantallas de resultados usan datos controlados de prueba (12 jugadores y números grandes); no consumen Gemini. Las capturas se guardan en `docs/mobile-*.png`.

La optimización de estilos mantiene `inlineCritical: false`: evita el manejador `onload` inline que la CSP bloqueaba y que dejaba la hoja global en modo impresión. No es necesario relajar la política de seguridad.
