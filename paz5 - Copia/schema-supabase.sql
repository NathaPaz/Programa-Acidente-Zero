-- ============================================================
-- PAZ 5.0 — Script SQL Completo para Supabase
-- Execute no SQL Editor do Supabase na ordem exata
-- ============================================================
-- 
-- INSTRUÇÕES:
-- 1. Acesse https://supabase.com/dashboard
-- 2. Selecione seu projeto
-- 3. Clique em "SQL Editor" no menu lateral
-- 4. Cole e execute este script inteiro
-- 5. Após execução, crie o primeiro admin pelo painel Auth
-- 6. Altere o role para 'admin' na tabela profiles
-- ============================================================


-- ============================================================
-- PARTE 1: EXTENSÕES
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- PARTE 2: TABELA DE PERFIS
-- Vinculada ao auth.users do Supabase Auth
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'analista'
                              CHECK (role IN ('analista', 'supervisor', 'admin')),
  equipe        TEXT,
  status        TEXT        NOT NULL DEFAULT 'ativo'
                              CHECK (status IN ('ativo', 'inativo', 'bloqueado')),
  avatar_url    TEXT,
  ultimo_login  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'Perfis de usuários do PAZ 5.0 vinculados ao Supabase Auth';
COMMENT ON COLUMN public.profiles.role IS 'analista | supervisor | admin';
COMMENT ON COLUMN public.profiles.equipe IS 'Equipe do supervisor (filtra acesso a analistas)';
COMMENT ON COLUMN public.profiles.status IS 'ativo | inativo | bloqueado';


-- ============================================================
-- PARTE 3: TABELA DE MOTORISTAS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.motoristas (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mes_ano       TEXT        NOT NULL DEFAULT '',
  cliente       TEXT        NOT NULL DEFAULT '',
  nome          TEXT        NOT NULL,
  cpf           TEXT        NOT NULL DEFAULT '',
  contato       TEXT        NOT NULL DEFAULT '',
  tipo          TEXT        NOT NULL DEFAULT '',
  viagens       NUMERIC     NOT NULL DEFAULT 0,
  wf            NUMERIC     NOT NULL DEFAULT 0,
  wf_mes        NUMERIC     NOT NULL DEFAULT 0,
  indice_wf     NUMERIC     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'pendente'
                              CHECK (status IN ('pendente', 'orientado', 'tentativa')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.motoristas IS 'Planilha de motoristas importada por analista';
COMMENT ON COLUMN public.motoristas.user_id IS 'FK: analista responsável';
COMMENT ON COLUMN public.motoristas.indice_wf IS 'Índice de infração de velocidade (%)';

CREATE INDEX IF NOT EXISTS idx_motoristas_user_id  ON public.motoristas(user_id);
CREATE INDEX IF NOT EXISTS idx_motoristas_cliente   ON public.motoristas(cliente);
CREATE INDEX IF NOT EXISTS idx_motoristas_mes_ano   ON public.motoristas(mes_ano);
CREATE INDEX IF NOT EXISTS idx_motoristas_status    ON public.motoristas(status);
CREATE INDEX IF NOT EXISTS idx_motoristas_indice    ON public.motoristas(indice_wf DESC);


-- ============================================================
-- PARTE 4: TABELA DE ORIENTAÇÕES + TENTATIVAS
-- Unificada em uma tabela com campo tipo_registro
-- ============================================================

CREATE TABLE IF NOT EXISTS public.orientacoes (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motorista_id    UUID        REFERENCES public.motoristas(id) ON DELETE SET NULL,
  motorista_nome  TEXT        NOT NULL,
  motorista_cpf   TEXT        NOT NULL DEFAULT '',
  cliente         TEXT        NOT NULL DEFAULT '',
  motivo          TEXT        NOT NULL,
  nota            TEXT        CHECK (nota IN ('A', 'B', 'C') OR nota IS NULL),
  descricao       TEXT        NOT NULL DEFAULT '',
  data_contato    DATE        NOT NULL DEFAULT CURRENT_DATE,
  hora_contato    TIME,
  lembrete_dt     DATE,
  lembrete_hr     TIME,
  tipo_registro   TEXT        NOT NULL DEFAULT 'orientacao'
                                CHECK (tipo_registro IN ('orientacao', 'tentativa')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.orientacoes IS 'Orientações e tentativas de contato registradas pelos analistas';
COMMENT ON COLUMN public.orientacoes.tipo_registro IS 'orientacao | tentativa';
COMMENT ON COLUMN public.orientacoes.nota IS 'A = Bom, B = Regular, C = Ruim | NULL para tentativas';
COMMENT ON COLUMN public.orientacoes.lembrete_dt IS 'Data para lembrete (tentativas "Ligar depois")';

CREATE INDEX IF NOT EXISTS idx_orientacoes_user_id       ON public.orientacoes(user_id);
CREATE INDEX IF NOT EXISTS idx_orientacoes_motorista_id  ON public.orientacoes(motorista_id);
CREATE INDEX IF NOT EXISTS idx_orientacoes_data          ON public.orientacoes(data_contato DESC);
CREATE INDEX IF NOT EXISTS idx_orientacoes_tipo          ON public.orientacoes(tipo_registro);
CREATE INDEX IF NOT EXISTS idx_orientacoes_nota          ON public.orientacoes(nota);
CREATE INDEX IF NOT EXISTS idx_orientacoes_lembrete      ON public.orientacoes(lembrete_dt) WHERE lembrete_dt IS NOT NULL;


-- ============================================================
-- PARTE 5: TABELA DE LOGS / AUDITORIA
-- ============================================================

CREATE TABLE IF NOT EXISTS public.logs (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  acao          TEXT        NOT NULL,
  descricao     TEXT,
  tabela        TEXT,
  registro_id   UUID,
  dados_antes   JSONB,
  dados_depois  JSONB,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.logs IS 'Auditoria completa de ações no sistema';
COMMENT ON COLUMN public.logs.acao IS 'LOGIN | LOGOUT | CREATE_USER | UPDATE_USER | BLOCK_USER | CHANGE_PASSWORD | DELETE_MOTORISTA | CLEAR_ALL | RESET_PASSWORD';
COMMENT ON COLUMN public.logs.dados_antes IS 'Snapshot JSON do registro antes da alteração';
COMMENT ON COLUMN public.logs.dados_depois IS 'Snapshot JSON do registro após a alteração';

CREATE INDEX IF NOT EXISTS idx_logs_user_id    ON public.logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_acao       ON public.logs(acao);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs(created_at DESC);


-- ============================================================
-- PARTE 6: TRIGGERS AUTOMÁTICOS
-- ============================================================

-- Função: atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Trigger: profiles
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger: motoristas
DROP TRIGGER IF EXISTS motoristas_updated_at ON public.motoristas;
CREATE TRIGGER motoristas_updated_at
  BEFORE UPDATE ON public.motoristas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger: orientacoes
DROP TRIGGER IF EXISTS orientacoes_updated_at ON public.orientacoes;
CREATE TRIGGER orientacoes_updated_at
  BEFORE UPDATE ON public.orientacoes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Função: criar profile automaticamente ao criar usuário no Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, role)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'nome',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'role',
      'analista'
    )
  )
  ON CONFLICT (id) DO NOTHING;  -- evita duplicata se trigger rodar duas vezes
  RETURN NEW;
END;
$$;

-- Trigger: criar profile ao inserir usuário no Auth
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- PARTE 7: FUNÇÕES AUXILIARES (SECURITY DEFINER)
-- Executam com privilégio elevado sem expor dados sensíveis
-- ============================================================

-- Retorna o role do usuário autenticado atual
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND status = 'ativo'
  LIMIT 1;
$$;

-- Verifica se usuário autenticado é admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id     = auth.uid()
      AND role   = 'admin'
      AND status = 'ativo'
  );
$$;

-- Verifica se é supervisor ou admin
CREATE OR REPLACE FUNCTION public.is_supervisor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id     = auth.uid()
      AND role   IN ('supervisor', 'admin')
      AND status = 'ativo'
  );
$$;

-- Atualiza último login (chamada após autenticação bem-sucedida)
CREATE OR REPLACE FUNCTION public.update_last_login(uid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET ultimo_login = NOW()
  WHERE id = uid;
END;
$$;

-- Retorna métricas resumidas de um analista (para supervisor/admin)
CREATE OR REPLACE FUNCTION public.get_analista_stats(p_user_id UUID)
RETURNS TABLE (
  total_orientacoes  BIGINT,
  total_tentativas   BIGINT,
  nota_a             BIGINT,
  nota_b             BIGINT,
  nota_c             BIGINT,
  total_motoristas   BIGINT,
  motoristas_pendentes BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE tipo_registro = 'orientacao')        AS total_orientacoes,
    COUNT(*) FILTER (WHERE tipo_registro = 'tentativa')         AS total_tentativas,
    COUNT(*) FILTER (WHERE tipo_registro = 'orientacao' AND nota = 'A') AS nota_a,
    COUNT(*) FILTER (WHERE tipo_registro = 'orientacao' AND nota = 'B') AS nota_b,
    COUNT(*) FILTER (WHERE tipo_registro = 'orientacao' AND nota = 'C') AS nota_c,
    (SELECT COUNT(*) FROM public.motoristas WHERE user_id = p_user_id) AS total_motoristas,
    (SELECT COUNT(*) FROM public.motoristas WHERE user_id = p_user_id AND status = 'pendente') AS motoristas_pendentes
  FROM public.orientacoes
  WHERE user_id = p_user_id
  AND public.is_supervisor_or_admin();
$$;


-- ============================================================
-- PARTE 8: ROW LEVEL SECURITY (RLS)
-- A proteção real dos dados acontece aqui, no banco
-- ============================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoristas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orientacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs        ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: profiles
-- ────────────────────────────────────────────────────────────

-- Analista vê apenas o próprio perfil; admin vê todos
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR public.is_admin()
  );

-- Usuário atualiza apenas o próprio perfil (nome, avatar_url)
-- Admin pode atualizar qualquer perfil
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update"
  ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    id = auth.uid()
    OR public.is_admin()
  );

-- INSERT: apenas o trigger de sistema e admins podem inserir
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert"
  ON public.profiles
  FOR INSERT
  WITH CHECK (
    id = auth.uid()          -- trigger insere com o id do novo usuário
    OR public.is_admin()
  );

-- DELETE: apenas admin
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete"
  ON public.profiles
  FOR DELETE
  USING (public.is_admin());


-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: motoristas
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "motoristas_select" ON public.motoristas;
CREATE POLICY "motoristas_select"
  ON public.motoristas
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_supervisor_or_admin()
  );

DROP POLICY IF EXISTS "motoristas_insert" ON public.motoristas;
CREATE POLICY "motoristas_insert"
  ON public.motoristas
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()     -- analista só pode inserir com o próprio user_id
  );

DROP POLICY IF EXISTS "motoristas_update" ON public.motoristas;
CREATE POLICY "motoristas_update"
  ON public.motoristas
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    user_id = auth.uid()     -- impede mudar o user_id para outro usuário
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "motoristas_delete" ON public.motoristas;
CREATE POLICY "motoristas_delete"
  ON public.motoristas
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );


-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: orientacoes
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "orientacoes_select" ON public.orientacoes;
CREATE POLICY "orientacoes_select"
  ON public.orientacoes
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_supervisor_or_admin()
  );

DROP POLICY IF EXISTS "orientacoes_insert" ON public.orientacoes;
CREATE POLICY "orientacoes_insert"
  ON public.orientacoes
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()     -- CRÍTICO: user_id não pode ser forjado
  );

DROP POLICY IF EXISTS "orientacoes_update" ON public.orientacoes;
CREATE POLICY "orientacoes_update"
  ON public.orientacoes
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    user_id = auth.uid()     -- impede alterar user_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "orientacoes_delete" ON public.orientacoes;
CREATE POLICY "orientacoes_delete"
  ON public.orientacoes
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );


-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: logs
-- Apenas admin lê; qualquer autenticado pode inserir (sistema)
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "logs_select" ON public.logs;
CREATE POLICY "logs_select"
  ON public.logs
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "logs_insert" ON public.logs;
CREATE POLICY "logs_insert"
  ON public.logs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Logs são imutáveis: sem UPDATE nem DELETE para ninguém
-- (nem mesmo admin pode apagar histórico de auditoria)


-- ============================================================
-- PARTE 9: GRANTS (permissões de execução das funções)
-- ============================================================

GRANT EXECUTE ON FUNCTION public.get_my_role()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_supervisor_or_admin()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_last_login(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analista_stats(UUID)  TO authenticated;


-- ============================================================
-- PARTE 10: VIEW — Resumo para o painel admin
-- Sem RLS, acessível apenas por is_admin() na policy
-- ============================================================

CREATE OR REPLACE VIEW public.vw_admin_resumo AS
SELECT
  p.id,
  p.nome,
  p.email,
  p.role,
  p.status,
  p.equipe,
  p.ultimo_login,
  p.created_at,
  COUNT(o.id) FILTER (WHERE o.tipo_registro = 'orientacao')  AS total_orientacoes,
  COUNT(o.id) FILTER (WHERE o.tipo_registro = 'tentativa')   AS total_tentativas,
  COUNT(o.id) FILTER (WHERE o.tipo_registro = 'orientacao' AND o.nota = 'A') AS nota_a,
  COUNT(o.id) FILTER (WHERE o.tipo_registro = 'orientacao' AND o.nota = 'B') AS nota_b,
  COUNT(o.id) FILTER (WHERE o.tipo_registro = 'orientacao' AND o.nota = 'C') AS nota_c,
  COUNT(m.id) AS total_motoristas,
  COUNT(m.id) FILTER (WHERE m.status = 'pendente') AS motoristas_pendentes
FROM public.profiles p
LEFT JOIN public.orientacoes o ON o.user_id = p.id
LEFT JOIN public.motoristas  m ON m.user_id = p.id
WHERE p.role = 'analista'
GROUP BY p.id, p.nome, p.email, p.role, p.status, p.equipe, p.ultimo_login, p.created_at;

COMMENT ON VIEW public.vw_admin_resumo IS 'Resumo de métricas por analista para o painel administrativo';


-- ============================================================
-- PARTE 11: VERIFICAÇÃO FINAL
-- Rode após executar tudo para confirmar que está correto
-- ============================================================

-- Verificar tabelas criadas
SELECT
  tablename,
  rowsecurity AS rls_habilitado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles','motoristas','orientacoes','logs')
ORDER BY tablename;

-- Verificar políticas criadas
SELECT
  tablename,
  policyname,
  cmd AS operacao
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- Verificar triggers
SELECT
  trigger_name,
  event_object_table AS tabela,
  event_manipulation AS evento
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  OR (trigger_schema = 'public' AND event_object_schema = 'auth')
ORDER BY event_object_table;

-- Verificar funções criadas
SELECT
  routine_name AS funcao,
  routine_type AS tipo,
  security_type AS seguranca
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_my_role','is_admin','is_supervisor_or_admin',
    'update_last_login','get_analista_stats',
    'handle_new_user','set_updated_at'
  )
ORDER BY routine_name;
