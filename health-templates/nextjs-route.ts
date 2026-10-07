// Protocolo Serafim UM — health check gerado automaticamente (WATCHDOG-05).
// Caminho esperado: app/api/health/route.ts (Next.js App Router)
//
// Regra: este endpoint nunca executa lógica de negócio, não autentica, e
// responde em menos de 200ms. É só conectividade.

export async function GET() {
  const start = Date.now();

  // Se seu projeto usa Supabase, descomente e ajuste:
  // import { createClient } from '@supabase/supabase-js';
  // const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  // const { error } = await supabase.from('_health_check').select('1').limit(1);
  // const healthy = !error;

  const healthy = true; // substitua pela checagem real da sua dependência crítica
  const latencyMs = Date.now() - start;

  return Response.json(
    { status: healthy ? 'ok' : 'degraded', latencyMs, ts: Date.now() },
    { status: healthy ? 200 : 503 },
  );
}
