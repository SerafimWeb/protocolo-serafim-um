// Protocolo Serafim UM — health check gerado automaticamente (WATCHDOG-05).
// Caminho esperado: routes/health.js (ou monte direto no seu app Express)
//
// Uso: app.use('/api', require('./routes/health'));

const express = require('express');
const router = express.Router();

router.get('/health', async (req, res) => {
  const start = Date.now();

  // Se seu projeto usa um banco, descomente e ajuste a checagem real:
  // const healthy = await db.ping().then(() => true).catch(() => false);

  const healthy = true; // substitua pela checagem real da sua dependência crítica
  const latencyMs = Date.now() - start;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    latencyMs,
    ts: Date.now(),
  });
});

module.exports = router;
