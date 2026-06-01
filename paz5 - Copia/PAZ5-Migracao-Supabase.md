# PAZ 5.0 — Plano de Migração para Sistema Multiusuário com Supabase

> **Documento técnico completo** · Autenticação real · RBAC · RLS · Banco de dados relacional

---

## Sumário

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Estrutura do Banco de Dados (SQL)](#2-estrutura-do-banco-de-dados-sql)
3. [Row Level Security (RLS)](#3-row-level-security-rls)
4. [Estrutura de Arquivos do Projeto](#4-estrutura-de-arquivos-do-projeto)
5. [Variáveis de Ambiente](#5-variáveis-de-ambiente)
6. [Módulo de Autenticação](#6-módulo-de-autenticação-supabasejs)
7. [Tela de Login](#7-tela-de-login-loginhtml)
8. [Middleware de Proteção de Rotas](#8-middleware-de-proteção-de-rotas)
9. [Painel do Analista — Adaptação do index.html](#9-painel-do-analista--adaptação-do-indexhtml)
10. [Painel Administrativo](#10-painel-administrativo-adminhtml)
11. [Migração dos Dados Existentes](#11-migração-dos-dados-existentes)
12. [Checklist de Implementação](#12-checklist-de-implementação)

---

## 1. Visão Geral da Arquitetura

### Situação Atual (INSEGURA)
```
Usuário → seleciona nome manualmente → localStorage → dados compartilhados
```

### Arquitetura Nova (SEGURA)
```
Usuário → Tela de Login → Supabase Auth (JWT)
              ↓
         Sessão autenticada (cookie seguro + JWT)
              ↓
    Painel do Analista  OU  Painel Admin
              ↓
    Supabase PostgreSQL + RLS
    (cada query filtra automaticamente por user_id)
```

### Papéis (roles)
| Papel | Acesso |
|-------|--------|
| `analista` | Apenas dados próprios (user_id = auth.uid()) |
| `supervisor` | Dados da própria equipe |
| `admin` | Acesso total, gestão de usuários, logs |

---

## 2. Estrutura do Banco de Dados (SQL)

Execute este SQL no **SQL Editor do Supabase** (na ordem exata):

```sql
-- ============================================================
-- 0. EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. TABELA DE PERFIS (vinculada ao auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'analista'
                  CHECK (role IN ('analista', 'supervisor', 'admin')),
  equipe        TEXT,                          -- para supervisor filtrar equipe
  status        TEXT NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo', 'inativo', 'bloqueado')),
  avatar_url    TEXT,
  ultimo_login  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger: preenche profiles automaticamente ao criar usuário no Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'analista')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 2. TABELA DE MOTORISTAS (planilha importada)
-- ============================================================
CREATE TABLE public.motoristas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mes_ano       TEXT,                          -- ex: "Mai/2025"
  cliente       TEXT NOT NULL DEFAULT '',
  nome          TEXT NOT NULL,
  cpf           TEXT DEFAULT '',
  contato       TEXT DEFAULT '',
  tipo          TEXT DEFAULT '',               -- Fixo / Eventual
  viagens       NUMERIC DEFAULT 0,
  wf            NUMERIC DEFAULT 0,
  wf_mes        NUMERIC DEFAULT 0,
  indice_wf     NUMERIC DEFAULT 0,
  status        TEXT DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'orientado', 'tentativa')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_motoristas_user_id ON public.motoristas(user_id);
CREATE INDEX idx_motoristas_cliente ON public.motoristas(cliente);

CREATE TRIGGER motoristas_updated_at
  BEFORE UPDATE ON public.motoristas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 3. TABELA DE ORIENTAÇÕES
-- ============================================================
CREATE TABLE public.orientacoes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motorista_id  UUID REFERENCES public.motoristas(id) ON DELETE SET NULL,
  motorista_nome TEXT NOT NULL,               -- desnormalizado para histórico
  motorista_cpf  TEXT DEFAULT '',
  cliente       TEXT DEFAULT '',
  motivo        TEXT NOT NULL,                -- Fone ligação, Whatsapp, etc
  nota          TEXT CHECK (nota IN ('A', 'B', 'C', NULL)),
  descricao     TEXT DEFAULT '',
  data_contato  DATE NOT NULL DEFAULT CURRENT_DATE,
  hora_contato  TIME,
  lembrete_dt   DATE,
  lembrete_hr   TIME,
  tipo_registro TEXT NOT NULL DEFAULT 'orientacao'
                  CHECK (tipo_registro IN ('orientacao', 'tentativa')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orientacoes_user_id ON public.orientacoes(user_id);
CREATE INDEX idx_orientacoes_data ON public.orientacoes(data_contato);
CREATE INDEX idx_orientacoes_motorista ON public.orientacoes(motorista_id);

CREATE TRIGGER orientacoes_updated_at
  BEFORE UPDATE ON public.orientacoes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 4. TABELA DE LOGS / AUDITORIA
-- ============================================================
CREATE TABLE public.logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acao          TEXT NOT NULL,                -- LOGIN, LOGOUT, CREATE_USER, etc
  descricao     TEXT,
  tabela        TEXT,                         -- tabela afetada
  registro_id   UUID,                         -- id do registro afetado
  dados_antes   JSONB,                        -- snapshot antes da alteração
  dados_depois  JSONB,                        -- snapshot depois
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_user_id ON public.logs(user_id);
CREATE INDEX idx_logs_acao ON public.logs(acao);
CREATE INDEX idx_logs_created_at ON public.logs(created_at DESC);


-- ============================================================
-- 5. TABELA DE SESSÕES ATIVAS (opcional, para force-logout)
-- ============================================================
CREATE TABLE public.sessoes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  ultimo_ping   TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessoes_user_id ON public.sessoes(user_id);


-- ============================================================
-- 6. FUNÇÕES AUXILIARES PARA ADMIN
-- ============================================================

-- Retorna o role do usuário atual
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Verifica se usuário atual é admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Verifica se usuário atual é supervisor ou admin
CREATE OR REPLACE FUNCTION public.is_supervisor_or_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('supervisor', 'admin')
  );
$$;

-- Atualiza ultimo_login quando usuário faz login
CREATE OR REPLACE FUNCTION public.update_last_login(uid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET ultimo_login = NOW() WHERE id = uid;
END;
$$;
```

---

## 3. Row Level Security (RLS)

Execute após criar as tabelas:

```sql
-- ============================================================
-- HABILITAR RLS EM TODAS AS TABELAS
-- ============================================================
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoristas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orientacoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes      ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- POLÍTICAS: profiles
-- ============================================================

-- Cada usuário vê apenas o próprio perfil
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

-- Usuário atualiza apenas o próprio perfil
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin());

-- Somente admin insere perfis manualmente
CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  WITH CHECK (public.is_admin() OR id = auth.uid()); -- trigger também insere

-- Somente admin deleta perfis
CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  USING (public.is_admin());


-- ============================================================
-- POLÍTICAS: motoristas
-- ============================================================

-- Analista vê apenas seus próprios motoristas
-- Supervisor/Admin veem tudo
CREATE POLICY "motoristas_select"
  ON public.motoristas FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_supervisor_or_admin()
  );

CREATE POLICY "motoristas_insert"
  ON public.motoristas FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "motoristas_update"
  ON public.motoristas FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "motoristas_delete"
  ON public.motoristas FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());


-- ============================================================
-- POLÍTICAS: orientacoes
-- ============================================================

CREATE POLICY "orientacoes_select"
  ON public.orientacoes FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_supervisor_or_admin()
  );

CREATE POLICY "orientacoes_insert"
  ON public.orientacoes FOR INSERT
  WITH CHECK (user_id = auth.uid()); -- user_id não pode ser forjado

CREATE POLICY "orientacoes_update"
  ON public.orientacoes FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "orientacoes_delete"
  ON public.orientacoes FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());


-- ============================================================
-- POLÍTICAS: logs (somente admin lê / sistema escreve)
-- ============================================================

CREATE POLICY "logs_select_admin"
  ON public.logs FOR SELECT
  USING (public.is_admin());

CREATE POLICY "logs_insert_authenticated"
  ON public.logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ============================================================
-- POLÍTICAS: sessoes
-- ============================================================

CREATE POLICY "sessoes_select"
  ON public.sessoes FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "sessoes_insert"
  ON public.sessoes FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessoes_delete"
  ON public.sessoes FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());
```

---

## 4. Estrutura de Arquivos do Projeto

```
paz5/
├── index.html          ← Painel do analista (protegido por auth)
├── admin.html          ← Painel administrativo (role: admin)
├── login.html          ← Tela de login pública
├── .env                ← Variáveis de ambiente (NUNCA versionar)
├── .env.example        ← Modelo sem valores reais (pode versionar)
├── js/
│   ├── supabase.js     ← Inicialização do cliente Supabase
│   ├── auth.js         ← Login, logout, recuperação de sessão
│   ├── guard.js        ← Middleware de proteção de rotas
│   ├── db.js           ← Funções de acesso ao banco
│   └── logger.js       ← Registro de ações no log
├── css/
│   └── paz5.css        ← Estilos compartilhados (extraídos do index.html)
└── README.md
```

---

## 5. Variáveis de Ambiente

**Arquivo `.env`** (nunca versionar):
```env
SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Arquivo `.env.example`** (pode versionar):
```env
SUPABASE_URL=SEU_SUPABASE_URL
SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
```

> **⚠️ Importante:** A `anon key` é pública por design no Supabase — ela é segura porque a proteção real é feita pelo RLS no banco. Nunca use a `service_role key` no frontend.

---

## 6. Módulo de Autenticação (`js/supabase.js` e `js/auth.js`)

### `js/supabase.js`
```javascript
// js/supabase.js
// Inicializa o cliente Supabase uma única vez
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = '__SUPABASE_URL__';   // substituir em build
const SUPABASE_ANON    = '__SUPABASE_ANON_KEY__';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,       // persiste sessão entre abas/refresh
    autoRefreshToken: true,     // renova JWT automaticamente
    detectSessionInUrl: true    // lida com magic link / OAuth redirect
  }
});
```

### `js/auth.js`
```javascript
// js/auth.js
import { supabase } from './supabase.js';

// ── Login com email e senha ──────────────────────────────────
export async function login(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: senha
  });
  if (error) throw error;

  // Registra último login e cria log
  await supabase.rpc('update_last_login', { uid: data.user.id });
  await registrarLog('LOGIN', `Usuário ${email} fez login`);

  return data;
}

// ── Logout ───────────────────────────────────────────────────
export async function logout() {
  await registrarLog('LOGOUT', 'Usuário encerrou sessão');
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.replace('/login.html');
}

// ── Recuperar sessão atual ───────────────────────────────────
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ── Recuperar perfil do usuário logado ───────────────────────
export async function getMeuPerfil() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// ── Trocar senha ─────────────────────────────────────────────
export async function trocarSenha(novaSenha) {
  const { error } = await supabase.auth.updateUser({ password: novaSenha });
  if (error) throw error;
  await registrarLog('CHANGE_PASSWORD', 'Usuário alterou a própria senha');
}

// ── Solicitar redefinição de senha (link por email) ──────────
export async function recuperarSenha(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/login.html?reset=true'
  });
  if (error) throw error;
}

// ── Registrar log de ação ────────────────────────────────────
export async function registrarLog(acao, descricao, extras = {}) {
  try {
    await supabase.from('logs').insert({
      acao,
      descricao,
      tabela: extras.tabela || null,
      registro_id: extras.registro_id || null,
      dados_antes: extras.antes || null,
      dados_depois: extras.depois || null,
      ip: null,        // IP real requer backend/edge function
      user_agent: navigator.userAgent
    });
  } catch (e) {
    console.warn('Falha ao registrar log:', e.message);
  }
}
```

---

## 7. Tela de Login (`login.html`)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAZ 5.0 — Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --ap: #0A3D6B; --av: #0077C8; --ci: #00B4CC; --vl: #A8CC00;
      --bg: #F0F4F8; --brd: rgba(0,119,200,0.13);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Barlow', sans-serif;
      background: linear-gradient(135deg, var(--ap) 0%, #0D5499 60%, #0D6BB5 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 18px;
      padding: 36px 32px 28px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.3);
    }
    .logo {
      text-align: center;
      margin-bottom: 28px;
    }
    .logo-ico {
      width: 56px; height: 56px;
      background: linear-gradient(135deg, var(--av), var(--ap));
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 20px;
      font-weight: 900;
      margin-bottom: 10px;
    }
    .logo-t {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 26px;
      font-weight: 900;
      color: var(--ap);
    }
    .logo-t em { color: var(--av); font-style: normal; }
    .logo-sub {
      font-size: 11px;
      color: #8899AA;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .label {
      font-size: 9px;
      font-weight: 800;
      color: var(--av);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 5px;
      display: block;
    }
    .input {
      width: 100%;
      padding: 11px 14px;
      border-radius: 8px;
      border: 1.5px solid #DDE5EF;
      font-family: 'Barlow', sans-serif;
      font-size: 13px;
      outline: none;
      color: #0A2540;
      background: #F7FAFC;
      transition: border-color 0.17s;
      margin-bottom: 14px;
    }
    .input:focus { border-color: var(--av); background: #fff; }
    .btn {
      width: 100%;
      padding: 13px;
      background: linear-gradient(135deg, var(--av), var(--ap));
      color: #fff;
      border: none;
      border-radius: 9px;
      font-family: 'Barlow', sans-serif;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s, opacity 0.15s;
      margin-top: 4px;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .erro {
      background: #FFF0F0;
      border: 1.5px solid #C0392B;
      border-radius: 7px;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #7A1A14;
      margin-bottom: 14px;
      display: none;
    }
    .link-senha {
      text-align: center;
      margin-top: 14px;
      font-size: 11px;
      color: #8899AA;
    }
    .link-senha a {
      color: var(--av);
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }
    .link-senha a:hover { text-decoration: underline; }
    .spinner {
      display: inline-block;
      width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-ico">PAZ</div>
      <div class="logo-t">PAZ <em>5.0</em></div>
      <div class="logo-sub">Programa Acidente Zero</div>
    </div>

    <div class="erro" id="erro"></div>

    <label class="label">E-mail</label>
    <input class="input" type="email" id="email" placeholder="analista@empresa.com" autocomplete="email">

    <label class="label">Senha</label>
    <input class="input" type="password" id="senha" placeholder="••••••••" autocomplete="current-password"
           onkeydown="if(event.key==='Enter')fazerLogin()">

    <button class="btn" id="btn-login" onclick="fazerLogin()">Entrar</button>

    <div class="link-senha">
      <a onclick="mostrarRecuperacao()">Esqueci minha senha</a>
    </div>
  </div>

  <script type="module">
    import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

    // ⚠️ Substitua pelos valores reais do seu projeto Supabase
    const SUPABASE_URL  = 'SEU_SUPABASE_URL';
    const SUPABASE_ANON = 'SUA_SUPABASE_ANON_KEY';

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    // Redirecionar se já está logado
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) redirecionarPorRole(session.user);
    });

    // Verificar parâmetro de reset de senha
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('reset') === 'true') {
      document.getElementById('erro').style.display = 'block';
      document.getElementById('erro').style.background = '#F0FFF4';
      document.getElementById('erro').style.borderColor = '#1D9E75';
      document.getElementById('erro').style.color = '#0A5C3F';
      document.getElementById('erro').textContent = '✓ Sessão recuperada. Defina uma nova senha nas configurações.';
    }

    window.fazerLogin = async function() {
      const email = document.getElementById('email').value.trim();
      const senha = document.getElementById('senha').value;
      const btn   = document.getElementById('btn-login');
      const erro  = document.getElementById('erro');

      if (!email || !senha) {
        erro.textContent = 'Preencha e-mail e senha.';
        erro.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Entrando...';
      erro.style.display = 'none';

      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;

        // Verificar se conta está ativa
        const { data: perfil } = await supabase
          .from('profiles')
          .select('status, role')
          .eq('id', data.user.id)
          .single();

        if (perfil?.status !== 'ativo') {
          await supabase.auth.signOut();
          throw new Error('Sua conta está suspensa. Contate o administrador.');
        }

        // Atualizar último login
        await supabase.rpc('update_last_login', { uid: data.user.id });

        // Registrar log
        await supabase.from('logs').insert({
          acao: 'LOGIN',
          descricao: `Login de ${email}`,
          user_agent: navigator.userAgent
        });

        redirecionarPorRole(data.user, perfil.role);

      } catch (e) {
        let msg = e.message;
        if (msg.includes('Invalid login credentials')) msg = 'E-mail ou senha incorretos.';
        if (msg.includes('Email not confirmed')) msg = 'Confirme seu e-mail antes de entrar.';
        erro.textContent = '⚠ ' + msg;
        erro.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    };

    window.mostrarRecuperacao = async function() {
      const email = prompt('Digite seu e-mail para receber o link de redefinição de senha:');
      if (!email) return;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login.html?reset=true'
      });
      if (error) {
        alert('Erro: ' + error.message);
      } else {
        alert('✓ Link enviado para ' + email);
      }
    };

    async function redirecionarPorRole(user, roleOverride) {
      let role = roleOverride;
      if (!role) {
        const { data: perfil } = await supabase
          .from('profiles').select('role').eq('id', user.id).single();
        role = perfil?.role;
      }
      if (role === 'admin' || role === 'supervisor') {
        window.location.replace('/admin.html');
      } else {
        window.location.replace('/index.html');
      }
    }
  </script>
</body>
</html>
```

---

## 8. Middleware de Proteção de Rotas

Adicione ao **início** de cada página protegida (antes de qualquer outra lógica):

### `js/guard.js`
```javascript
// js/guard.js
// Inclua este script como módulo no topo de cada página protegida:
// <script type="module" src="js/guard.js"></script>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = 'SEU_SUPABASE_URL';
const SUPABASE_ANON = 'SUA_SUPABASE_ANON_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export async function protegerPagina(rolePermitidos = ['analista', 'supervisor', 'admin']) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.replace('/login.html');
    throw new Error('Não autenticado');
  }

  const { data: perfil, error } = await supabase
    .from('profiles')
    .select('role, status, nome')
    .eq('id', session.user.id)
    .single();

  if (error || !perfil) {
    await supabase.auth.signOut();
    window.location.replace('/login.html');
    throw new Error('Perfil não encontrado');
  }

  if (perfil.status !== 'ativo') {
    await supabase.auth.signOut();
    window.location.replace('/login.html?erro=conta_suspensa');
    throw new Error('Conta suspensa');
  }

  if (!rolePermitidos.includes(perfil.role)) {
    window.location.replace('/login.html?erro=sem_permissao');
    throw new Error('Sem permissão');
  }

  return { session, perfil, supabase };
}
```

### Uso no `index.html` (Painel do Analista):
```html
<script type="module">
  import { protegerPagina } from './js/guard.js';

  // PRIMEIRO: verificar autenticação
  const { session, perfil, supabase } = await protegerPagina(['analista', 'supervisor', 'admin']);

  // Após validação, exibir nome do usuário no header
  document.getElementById('user-nome-hdr').textContent = perfil.nome;
  document.getElementById('user-role-hdr').textContent = perfil.role;

  // REMOVER: toda lógica de seleção manual de analista (iniciarAnalista, addAnalista, etc.)
  // O usuário autenticado é identificado automaticamente por session.user.id

  // Continuar com a inicialização normal do sistema...
  await carregarState(supabase, session.user.id);
  // ...
</script>
```

---

## 9. Painel do Analista — Adaptação do `index.html`

### Substituições necessárias no código existente:

#### 1. REMOVER completamente:
```javascript
// ❌ REMOVER estas funções:
function iniciarAnalista() { ... }
function setAnalista(nome) { ... }
function abrirModalUsuario() { ... }
function renderListaAnalistas() { ... }
function addAnalista() { ... }

// ❌ REMOVER estas variáveis:
let analAtual = '';
let analistas = [];

// ❌ REMOVER o modal #ov-usuario inteiro do HTML
```

#### 2. SUBSTITUIR `salvarState` / `carregarState`:

```javascript
// ✅ NOVO: Salvar orientação no Supabase
async function salvarOrientacao(motoristaId, dados) {
  const { error } = await supabase.from('orientacoes').insert({
    user_id: currentUser.id,        // user_id definido automaticamente
    motorista_id: motoristaId,
    motorista_nome: dados.nome,
    motorista_cpf: dados.cpf || '',
    cliente: dados.cliente || '',
    motivo: dados.motivo,
    nota: dados.nota || null,
    descricao: dados.descricao || '',
    data_contato: dados.data || new Date().toISOString().split('T')[0],
    hora_contato: dados.hora || null,
    tipo_registro: isTent(dados.motivo) ? 'tentativa' : 'orientacao'
  });
  if (error) throw error;
}

// ✅ NOVO: Carregar orientações do analista logado
async function carregarOrientacoes(filtros = {}) {
  let query = supabase
    .from('orientacoes')
    .select('*')
    .order('created_at', { ascending: false });

  // RLS já filtra por user_id automaticamente para analista
  // Para admin/supervisor, retorna todos

  if (filtros.mes) {
    query = query.gte('data_contato', filtros.mes.inicio)
                 .lte('data_contato', filtros.mes.fim);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ✅ NOVO: Importar motoristas (substituir localStorage)
async function importarMotoristas(linhas) {
  const registros = linhas.map(l => ({
    user_id: currentUser.id,
    mes_ano: l.mes_ano || '',
    cliente: l.cliente || '',
    nome: l.nome,
    cpf: l.cpf || '',
    contato: l.contato || '',
    tipo: l.tipo || '',
    viagens: parseFloat(l.viagens) || 0,
    wf: parseFloat(l.wf) || 0,
    wf_mes: parseFloat(l.wfMes) || 0,
    indice_wf: parseFloat(l.indice) || 0,
    status: 'pendente'
  }));

  const { error } = await supabase.from('motoristas').insert(registros);
  if (error) throw error;
}
```

#### 3. SUBSTITUIR o botão de logout no header:
```html
<!-- Substituir o .user-pill atual por: -->
<div class="user-pill" onclick="window.dispatchEvent(new Event('logout'))">
  <span id="user-nome-hdr">Carregando...</span>
  <span style="font-size:9px;opacity:.6" id="user-role-hdr"></span>
  <span>⏏</span>
</div>

<script type="module">
  window.addEventListener('logout', async () => {
    if (confirm('Deseja encerrar a sessão?')) {
      await supabase.auth.signOut();
      window.location.replace('/login.html');
    }
  });
</script>
```

---

## 10. Painel Administrativo (`admin.html`)

### Funções principais do painel admin:

```javascript
// js/admin.js

// ── Listar todos os usuários ──────────────────────────────────
async function listarUsuarios() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ── Criar novo usuário ────────────────────────────────────────
async function criarUsuario(email, senha, nome, role) {
  // Usa a Admin API via Edge Function (não expõe service_role key no frontend)
  const { data: session } = await supabase.auth.getSession();
  const resp = await fetch('/api/admin/criar-usuario', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.session.access_token}`
    },
    body: JSON.stringify({ email, senha, nome, role })
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

// ── Alterar role/status de usuário ───────────────────────────
async function atualizarUsuario(userId, campos) {
  const antes = await supabase.from('profiles').select('*').eq('id', userId).single();
  const { error } = await supabase
    .from('profiles')
    .update(campos)
    .eq('id', userId);
  if (error) throw error;

  await supabase.from('logs').insert({
    acao: 'UPDATE_USER',
    descricao: `Admin alterou perfil de ${userId}`,
    tabela: 'profiles',
    registro_id: userId,
    dados_antes: antes.data,
    dados_depois: campos
  });
}

// ── Bloquear usuário ──────────────────────────────────────────
async function bloquearUsuario(userId) {
  await atualizarUsuario(userId, { status: 'bloqueado' });
  await supabase.from('logs').insert({
    acao: 'BLOCK_USER',
    descricao: `Usuário ${userId} bloqueado pelo admin`
  });
}

// ── Listar logs ───────────────────────────────────────────────
async function listarLogs(filtros = {}) {
  let query = supabase
    .from('logs')
    .select(`*, profiles(nome, email)`)
    .order('created_at', { ascending: false })
    .limit(500);

  if (filtros.userId) query = query.eq('user_id', filtros.userId);
  if (filtros.acao)   query = query.eq('acao', filtros.acao);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ── Dashboard geral ───────────────────────────────────────────
async function carregarDashboardAdmin() {
  const [usuarios, orientacoes, tentativas] = await Promise.all([
    supabase.from('profiles').select('id, nome, role, status, ultimo_login'),
    supabase.from('orientacoes').select('user_id, nota, data_contato').eq('tipo_registro', 'orientacao'),
    supabase.from('orientacoes').select('user_id, data_contato').eq('tipo_registro', 'tentativa')
  ]);

  // Processar rankings, totais, etc.
  return {
    totalUsuarios: usuarios.data?.length || 0,
    totalOrientacoes: orientacoes.data?.length || 0,
    totalTentativas: tentativas.data?.length || 0,
    rankingPorAnalista: calcularRanking(orientacoes.data, usuarios.data)
  };
}
```

### Edge Function para criação de usuários (Supabase Edge Functions)

Crie em `supabase/functions/criar-usuario/index.ts`:

```typescript
// supabase/functions/criar-usuario/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!  // service_role APENAS no backend
);

Deno.serve(async (req) => {
  // Verificar autenticação do chamador
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Não autorizado', { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) return new Response('Token inválido', { status: 401 });

  // Verificar se chamador é admin
  const { data: perfil } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single();

  if (perfil?.role !== 'admin') return new Response('Sem permissão', { status: 403 });

  // Criar novo usuário
  const { email, senha, nome, role } = await req.json();

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, role }
  });

  if (error) return new Response(error.message, { status: 400 });

  // Log da criação
  await supabaseAdmin.from('logs').insert({
    user_id: user.id,
    acao: 'CREATE_USER',
    descricao: `Admin criou usuário ${email} com role ${role}`,
    tabela: 'profiles',
    registro_id: data.user.id
  });

  return new Response(JSON.stringify({ id: data.user.id }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

---

## 11. Migração dos Dados Existentes

Para migrar dados que estão no `localStorage` atual para o Supabase:

```javascript
// Script de migração — executar UMA VEZ no console do navegador,
// após implementar a autenticação e estar logado como o analista correto.

async function migrarDadosLocais(supabase, userId) {
  const raw = localStorage.getItem('paz5_v4');
  if (!raw) { console.log('Nada para migrar'); return; }

  const dados = JSON.parse(raw);
  const { mots = [], oris = {}, tents = {} } = dados;

  console.log(`Migrando: ${mots.length} motoristas`);

  // 1. Migrar motoristas
  if (mots.length > 0) {
    const motoristasInsert = mots.map(m => ({
      user_id: userId,
      mes_ano: m.mes || '',
      cliente: m.cliente || '',
      nome: m.nome,
      cpf: m.cpf || '',
      contato: m.contato || '',
      tipo: m.tipo || '',
      viagens: m.viagens || 0,
      wf: m.wf || 0,
      wf_mes: m.wfMes || 0,
      indice_wf: m.indice || 0,
      status: oris[m.id] ? 'orientado' : (tents[m.id] ? 'tentativa' : 'pendente')
    }));

    const { error } = await supabase.from('motoristas').insert(motoristasInsert);
    if (error) { console.error('Erro motoristas:', error); return; }
    console.log('✓ Motoristas migrados');
  }

  // 2. Migrar orientações
  const oriInserts = [];
  for (const [motId, oriArr] of Object.entries(oris)) {
    const mot = mots.find(m => m.id === motId);
    for (const o of oriArr) {
      oriInserts.push({
        user_id: userId,
        motorista_nome: mot?.nome || 'Desconhecido',
        motorista_cpf: mot?.cpf || '',
        cliente: mot?.cliente || '',
        motivo: o.motivo || '',
        nota: o.nota || null,
        descricao: o.descricao || '',
        data_contato: o.data || new Date().toISOString().split('T')[0],
        hora_contato: o.hora || null,
        tipo_registro: 'orientacao'
      });
    }
  }

  // 3. Migrar tentativas
  for (const [motId, tentArr] of Object.entries(tents)) {
    const mot = mots.find(m => m.id === motId);
    for (const t of tentArr) {
      oriInserts.push({
        user_id: userId,
        motorista_nome: mot?.nome || 'Desconhecido',
        motorista_cpf: mot?.cpf || '',
        cliente: mot?.cliente || '',
        motivo: t.motivo || '',
        nota: null,
        descricao: t.descricao || '',
        data_contato: t.data || new Date().toISOString().split('T')[0],
        hora_contato: t.hora || null,
        tipo_registro: 'tentativa'
      });
    }
  }

  if (oriInserts.length > 0) {
    // Inserir em lotes de 100
    for (let i = 0; i < oriInserts.length; i += 100) {
      const lote = oriInserts.slice(i, i + 100);
      const { error } = await supabase.from('orientacoes').insert(lote);
      if (error) { console.error('Erro orientações lote ' + i, error); }
    }
    console.log(`✓ ${oriInserts.length} registros (orientações + tentativas) migrados`);
  }

  console.log('✅ Migração concluída! Remova o localStorage após conferir os dados.');
  // localStorage.removeItem('paz5_v4'); // Descomentar após conferir
}
```

---

## 12. Checklist de Implementação

### Fase 1 — Banco de Dados (Supabase Dashboard)
- [ ] Executar SQL de criação das tabelas
- [ ] Executar SQL das políticas RLS
- [ ] Verificar que RLS está **habilitado** em todas as tabelas
- [ ] Criar o primeiro usuário admin pelo painel Auth do Supabase
- [ ] Alterar manualmente o `role` para `admin` na tabela `profiles`

### Fase 2 — Autenticação
- [ ] Criar `login.html` com as credenciais do Supabase
- [ ] Testar login/logout
- [ ] Testar recuperação de senha por e-mail
- [ ] Verificar redirecionamento por role (analista → index, admin → admin)

### Fase 3 — Proteção do Painel do Analista
- [ ] Adicionar `guard.js` ao `index.html`
- [ ] Remover modal de seleção de analista
- [ ] Remover funções `iniciarAnalista`, `addAnalista`, `setAnalista`
- [ ] Substituir `salvarState`/`carregarState` pelas funções Supabase
- [ ] Testar que analista A não vê dados do analista B
- [ ] Adicionar botão de logout funcional

### Fase 4 — Painel Administrativo
- [ ] Criar `admin.html` com proteção `guard.js(['admin'])`
- [ ] Implementar gestão de usuários
- [ ] Implementar visualização de logs
- [ ] Implementar dashboard geral com dados de todos os analistas
- [ ] Testar que analista não consegue acessar `admin.html`

### Fase 5 — Edge Functions
- [ ] Configurar Supabase CLI: `npm install -g supabase`
- [ ] Criar edge function `criar-usuario`
- [ ] Fazer deploy: `supabase functions deploy criar-usuario`
- [ ] Testar criação de usuário pelo painel admin

### Fase 6 — Migração de Dados
- [ ] Para cada analista, fazer login e rodar o script de migração
- [ ] Verificar dados migrados no dashboard
- [ ] Após confirmação, limpar localStorage

### Fase 7 — Segurança Final
- [ ] Remover qualquer `service_role key` do frontend
- [ ] Verificar que `.env` não está versionado no git (`.gitignore`)
- [ ] Testar acesso direto à URL do painel sem login (deve redirecionar)
- [ ] Testar manipulação manual de `user_id` em requests (RLS deve bloquear)
- [ ] Ativar 2FA no projeto Supabase (dashboard → Settings → Auth)

---

## Configurações do Supabase Auth (Dashboard)

Acesse **Authentication → Settings** e configure:

```
Site URL: https://seu-dominio.com
Redirect URLs: https://seu-dominio.com/login.html

JWT Expiry: 3600 (1 hora) ou 86400 (1 dia)
Refresh Token Rotation: ✓ Habilitado
Refresh Token Reuse Interval: 10

Email Confirmations: Habilitado (recomendado)
Secure Email Change: ✓ Habilitado
```

---

## Resumo de Segurança

| Camada | Proteção |
|--------|----------|
| **Frontend** | Redirect para login se sem sessão JWT |
| **JWT** | Token assinado pelo Supabase, renovação automática |
| **RLS** | Políticas no PostgreSQL validam `auth.uid()` em CADA query |
| **Backend** | Nenhuma query passa sem verificar o usuário autenticado |
| **Senhas** | bcrypt pelo Supabase Auth (nunca armazenadas em texto claro) |
| **Logs** | Toda ação administrativa registrada com timestamp |
| **Edge Functions** | `service_role key` nunca exposta ao frontend |

---

*Documento gerado para PAZ 5.0 — Programa Acidente Zero*  
*Arquitetura: Supabase Auth + PostgreSQL + RLS + RBAC*
