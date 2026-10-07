// Protocolo Serafim UM — health check gerado automaticamente (WATCHDOG-05).
// Caminho esperado: supabase/functions/health/index.ts
// Deploy: npx supabase functions deploy health --project-ref <seu-ref>
//
// Regra: este endpoint nunca executa lógica de negócio, não autentica, e
// responde em menos de 200ms. É só conectividade com o banco.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

Deno.serve(async (req: Request) => {
  const start = Date.now();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // Troque '_health_check' pelo nome de uma tabela real e pequena do seu
  // projeto, ou crie uma tabela dedicada só pra isso (1 linha, nunca muda).
  const { error } = await supabase.from('_health_check').select('1').limit(1);
  const healthy = !error;
  const latencyMs = Date.now() - start;

  return new Response(
    JSON.stringify({ status: healthy ? 'ok' : 'degraded', latencyMs, ts: Date.now() }),
    { status: healthy ? 200 : 503, headers: { 'Content-Type': 'application/json' } },
  );
});
