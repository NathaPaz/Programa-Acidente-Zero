// supabase/functions/criar-usuario/index.ts
//
// Deploy com: supabase functions deploy criar-usuario
//
// Esta Edge Function usa a service_role key NO SERVIDOR para criar usuários.
// A chave service_role JAMAIS deve aparecer no frontend.
//
// Fluxo:
//   Frontend (admin logado) → POST /functions/v1/criar-usuario → Supabase Auth Admin API
//
// Variáveis de ambiente necessárias (já configuradas automaticamente no Supabase):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req: Request) => {

  // ─── Preflight CORS ───────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Método não permitido', { status: 405, headers: corsHeaders });
  }

  try {
    // ─── 1. Inicializar cliente admin (service_role, apenas no servidor) ──
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ─── 2. Verificar autenticação do chamador ─────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Token de autorização ausente' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Token inválido ou expirado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 3. Verificar se chamador é admin ─────────────────────────────
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, status, nome')
      .eq('id', caller.id)
      .single();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ error: 'Perfil do solicitante não encontrado' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Apenas administradores podem criar usuários' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (callerProfile.status !== 'ativo') {
      return new Response(
        JSON.stringify({ error: 'Conta do administrador está suspensa' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 4. Validar payload ────────────────────────────────────────────
    const body = await req.json();
    const { email, senha, nome, role, equipe } = body;

    if (!email || !senha || !nome || !role) {
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios: email, senha, nome, role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'E-mail inválido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (senha.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Senha deve ter pelo menos 8 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rolesPermitidos = ['analista', 'supervisor', 'admin'];
    if (!rolesPermitidos.includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Role inválido. Use: analista, supervisor ou admin' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 5. Criar usuário no Supabase Auth ────────────────────────────
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: senha,
      email_confirm: true,             // confirma e-mail automaticamente
      user_metadata: { nome, role }    // usado pelo trigger para preencher profiles
    });

    if (createError) {
      let msg = createError.message;
      if (msg.includes('already registered')) msg = 'Este e-mail já está cadastrado.';
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 6. Atualizar perfil com equipe (se supervisor) ──────────────
    if (equipe && role === 'supervisor') {
      await supabaseAdmin
        .from('profiles')
        .update({ equipe })
        .eq('id', newUser.user.id);
    }

    // ─── 7. Registrar log da ação administrativa ─────────────────────
    await supabaseAdmin.from('logs').insert({
      user_id:     caller.id,
      acao:        'CREATE_USER',
      descricao:   `Admin "${callerProfile.nome}" criou usuário "${nome}" (${email}) com role "${role}"`,
      tabela:      'profiles',
      registro_id: newUser.user.id,
      dados_depois: { email, nome, role, equipe: equipe || null }
    });

    // ─── 8. Retornar sucesso ──────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id:    newUser.user.id,
          email: newUser.user.email,
          nome,
          role
        }
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[criar-usuario] Erro inesperado:', err);
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
