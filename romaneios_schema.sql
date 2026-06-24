-- =============================================================
-- ROMANEIOS DE CARGA — SUPABASE BACKEND
-- Execute no SQL Editor do Supabase na ordem apresentada.
-- =============================================================


-- =============================================================
-- SEÇÃO 0: EXTENSÕES
-- =============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- SEÇÃO 1: TIPOS ENUM
-- =============================================================
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('master', 'colaborador');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.romaneio_status AS ENUM (
        'Pendente',
        'Preenchido',
        'Liberado',
        'Cancelado'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================
-- SEÇÃO 2: TABELAS
-- =============================================================

-- ----------------------------
-- 2.1 perfis (estende auth.users)
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.perfis (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    role          public.user_role NOT NULL DEFAULT 'colaborador',
    data_criacao  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.perfis IS 'Perfis dos usuários internos (Master e Colaborador).';
COMMENT ON COLUMN public.perfis.role IS 'master = acesso total; colaborador = acesso operacional';


-- ----------------------------
-- 2.2 config_remetente (dados fixos da empresa — singleton)
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.config_remetente (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_empresa   VARCHAR(255) NOT NULL,
    cnpj           VARCHAR(18)  NOT NULL UNIQUE,
    endereco       TEXT         NOT NULL,
    cidade_uf      VARCHAR(100) NOT NULL,
    cep            VARCHAR(10)  NOT NULL,
    atualizado_em  TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE public.config_remetente IS 'Dados do Remetente. Deve conter exatamente uma linha.';


-- ----------------------------
-- 2.3 romaneios (tabela pai do processo)
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.romaneios (
    id                  UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    token_publico       UUID              NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    data_criacao        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    data_atualizacao    TIMESTAMPTZ       DEFAULT NOW(),
    status              public.romaneio_status NOT NULL DEFAULT 'Pendente',
    transportadora_nome VARCHAR(255),
    transportadora_cnpj VARCHAR(18),
    motorista_nome      VARCHAR(255),
    motorista_rg        VARCHAR(20),
    motorista_cpf       VARCHAR(14),
    veiculo_modelo      VARCHAR(100),
    veiculo_placa       VARCHAR(10),
    criado_por          UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
    observacoes         TEXT
);

COMMENT ON COLUMN public.romaneios.token_publico IS
    'UUID gerado automaticamente. Compõe a URL pública: /coleta/{token_publico}';


-- ----------------------------
-- 2.4 romaneio_itens (tabela filha — notas fiscais)
-- ----------------------------
CREATE TABLE IF NOT EXISTS public.romaneio_itens (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    romaneio_id          UUID NOT NULL REFERENCES public.romaneios(id) ON DELETE CASCADE,
    numero_nfe           VARCHAR(50)  NOT NULL,
    cliente_destinatario VARCHAR(255) NOT NULL,
    depositante          VARCHAR(100) NOT NULL,
    qtd_volumes          INTEGER NOT NULL CHECK (qtd_volumes > 0),
    peso_kg              DECIMAL(10, 2),
    observacao           TEXT,
    inserido_em          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.romaneio_itens.depositante IS
    'Canal de venda / marketplace de origem: Shopee, Mercado Livre, Meli, etc.';


-- =============================================================
-- SEÇÃO 3: ÍNDICES
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_romaneios_token_publico    ON public.romaneios(token_publico);
CREATE INDEX IF NOT EXISTS idx_romaneios_status           ON public.romaneios(status);
CREATE INDEX IF NOT EXISTS idx_romaneios_criado_por       ON public.romaneios(criado_por);
CREATE INDEX IF NOT EXISTS idx_romaneios_data_criacao     ON public.romaneios(data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_romaneio_itens_romaneio_id ON public.romaneio_itens(romaneio_id);
CREATE INDEX IF NOT EXISTS idx_perfis_role                ON public.perfis(role);


-- =============================================================
-- SEÇÃO 4: FUNÇÕES E TRIGGERS
-- =============================================================

-- ----------------------------
-- 4.1 Auto-criação de perfil ao registrar novo usuário no Auth
-- ----------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role  public.user_role;
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM public.perfis;

    IF v_count = 0 THEN
        v_role := 'master';
    ELSE
        BEGIN
            v_role := COALESCE(
                (NEW.raw_user_meta_data->>'role')::public.user_role,
                'colaborador'
            );
        EXCEPTION WHEN invalid_text_representation THEN
            v_role := 'colaborador';
        END;
    END IF;

    INSERT INTO public.perfis (id, nome, email, role)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'nome',
            split_part(NEW.email, '@', 1)
        ),
        NEW.email,
        v_role
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ----------------------------
-- 4.2 Atualiza data_atualizacao automaticamente em romaneios
-- ----------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.data_atualizacao = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS romaneios_set_updated_at ON public.romaneios;
CREATE TRIGGER romaneios_set_updated_at
    BEFORE UPDATE ON public.romaneios
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ----------------------------
-- 4.3 Proteção de campos imutáveis e de status
-- ----------------------------
CREATE OR REPLACE FUNCTION public.guard_romaneio_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.id              <> OLD.id
    OR NEW.token_publico   <> OLD.token_publico
    OR NEW.data_criacao    <> OLD.data_criacao
    THEN
        RAISE EXCEPTION 'Campos imutáveis do romaneio não podem ser alterados.';
    END IF;

    IF OLD.status IN ('Liberado', 'Cancelado')
    AND NOT EXISTS (
        SELECT 1 FROM public.perfis
        WHERE id = auth.uid() AND role = 'master'
    )
    THEN
        RAISE EXCEPTION 'Romaneio % não pode ser alterado no status %.', OLD.id, OLD.status;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS romaneios_guard_update ON public.romaneios;
CREATE TRIGGER romaneios_guard_update
    BEFORE UPDATE ON public.romaneios
    FOR EACH ROW EXECUTE FUNCTION public.guard_romaneio_update();


-- =============================================================
-- SEÇÃO 5: FUNÇÕES AUXILIARES PARA RLS
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.perfis
        WHERE id = auth.uid() AND role = 'master'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_colaborador()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.perfis
        WHERE id = auth.uid() AND role = 'colaborador'
    );
$$;

CREATE OR REPLACE FUNCTION public.get_public_token()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
    RETURN current_setting('app.public_token', true)::uuid;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;


-- =============================================================
-- SEÇÃO 6: ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE public.perfis           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_remetente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.romaneios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.romaneio_itens   ENABLE ROW LEVEL SECURITY;

-- Limpa políticas existentes antes de recriar
DO $$ DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname, tablename
             FROM pg_policies
             WHERE schemaname = 'public'
               AND tablename IN ('perfis','config_remetente','romaneios','romaneio_itens')
    LOOP
        EXECUTE FORMAT('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;


-- ============================================================
-- 6.1 Tabela: perfis
-- ============================================================

CREATE POLICY "master_all_perfis"
    ON public.perfis FOR ALL
    TO authenticated
    USING  (public.is_master())
    WITH CHECK (public.is_master());

CREATE POLICY "colaborador_select_own_perfil"
    ON public.perfis FOR SELECT
    TO authenticated
    USING (id = auth.uid() AND public.is_colaborador());

CREATE POLICY "colaborador_update_own_perfil"
    ON public.perfis FOR UPDATE
    TO authenticated
    USING (id = auth.uid() AND public.is_colaborador())
    WITH CHECK (
        id = auth.uid()
        AND role = (SELECT p.role FROM public.perfis p WHERE p.id = auth.uid())
    );


-- ============================================================
-- 6.2 Tabela: config_remetente
-- ============================================================

CREATE POLICY "master_all_config_remetente"
    ON public.config_remetente FOR ALL
    TO authenticated
    USING  (public.is_master())
    WITH CHECK (public.is_master());

CREATE POLICY "colaborador_select_config_remetente"
    ON public.config_remetente FOR SELECT
    TO authenticated
    USING (public.is_colaborador());

CREATE POLICY "anon_select_config_remetente"
    ON public.config_remetente FOR SELECT
    TO anon
    USING (true);


-- ============================================================
-- 6.3 Tabela: romaneios
-- ============================================================

CREATE POLICY "master_all_romaneios"
    ON public.romaneios FOR ALL
    TO authenticated
    USING  (public.is_master())
    WITH CHECK (public.is_master());

CREATE POLICY "colaborador_select_romaneios"
    ON public.romaneios FOR SELECT
    TO authenticated
    USING (public.is_colaborador());

CREATE POLICY "colaborador_insert_romaneios"
    ON public.romaneios FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_colaborador()
        AND criado_por = auth.uid()
    );

CREATE POLICY "colaborador_update_romaneios"
    ON public.romaneios FOR UPDATE
    TO authenticated
    USING  (public.is_colaborador())
    WITH CHECK (public.is_colaborador());

CREATE POLICY "anon_select_romaneio_by_token"
    ON public.romaneios FOR SELECT
    TO anon
    USING (
        token_publico = public.get_public_token()
    );

CREATE POLICY "anon_update_romaneio_by_token"
    ON public.romaneios FOR UPDATE
    TO anon
    USING (
        token_publico = public.get_public_token()
        AND status IN ('Pendente', 'Preenchido')
    )
    WITH CHECK (
        token_publico = public.get_public_token()
    );


-- ============================================================
-- 6.4 Tabela: romaneio_itens
-- ============================================================

CREATE POLICY "master_all_romaneio_itens"
    ON public.romaneio_itens FOR ALL
    TO authenticated
    USING  (public.is_master())
    WITH CHECK (public.is_master());

CREATE POLICY "colaborador_select_romaneio_itens"
    ON public.romaneio_itens FOR SELECT
    TO authenticated
    USING (public.is_colaborador());

CREATE POLICY "colaborador_insert_romaneio_itens"
    ON public.romaneio_itens FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_colaborador()
        AND EXISTS (
            SELECT 1 FROM public.romaneios r
            WHERE r.id = romaneio_id
            AND r.status NOT IN ('Liberado', 'Cancelado')
        )
    );

CREATE POLICY "colaborador_update_romaneio_itens"
    ON public.romaneio_itens FOR UPDATE
    TO authenticated
    USING (
        public.is_colaborador()
        AND EXISTS (
            SELECT 1 FROM public.romaneios r
            WHERE r.id = romaneio_id
            AND r.status NOT IN ('Liberado', 'Cancelado')
        )
    )
    WITH CHECK (public.is_colaborador());

CREATE POLICY "anon_select_romaneio_itens_by_token"
    ON public.romaneio_itens FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.romaneios r
            WHERE r.id = romaneio_id
            AND r.token_publico = public.get_public_token()
        )
    );


-- =============================================================
-- SEÇÃO 7: FUNÇÕES PÚBLICAS (SECURITY DEFINER)
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_romaneio_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rom RECORD;
  v_itens JSONB;
  v_config RECORD;
BEGIN
  SELECT r.*, p.nome AS criado_por_nome, p.email AS criado_por_email
  INTO v_rom
  FROM romaneios r
  LEFT JOIN perfis p ON p.id = r.criado_por
  WHERE r.token_publico = CASE WHEN p_token ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN p_token::uuid ELSE NULL END
    AND (r.token_expira_em IS NULL OR r.token_expira_em > NOW())
    AND r.excluido_em IS NULL;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT INTO v_config * FROM config_remetente LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id,
    'numero_nfe', i.numero_nfe,
    'cliente_destinatario', i.cliente_destinatario,
    'depositante', i.depositante,
    'qtd_volumes', i.qtd_volumes,
    'peso_kg', i.peso_kg,
    'observacao', i.observacao,
    'inserido_em', i.inserido_em,
    'bipado_em', i.bipado_em,
    'bipado_codigo', i.bipado_codigo
  ) ORDER BY i.inserido_em)
  INTO v_itens
  FROM romaneio_itens i WHERE i.romaneio_id = v_rom.id;

  RETURN jsonb_build_object(
    'romaneio_id', v_rom.id,
    'token_publico', v_rom.token_publico,
    'token_expira_em', v_rom.token_expira_em,
    'data_emissao', v_rom.data_criacao,
    'data_ultima_atualizacao', v_rom.data_atualizacao,
    'status', v_rom.status,
    'observacoes', v_rom.observacoes,
    'observacao_transportadora', v_rom.observacao_transportadora,
    'assinatura_motorista', v_rom.assinatura_motorista,
    'remetente_nome', COALESCE(v_config.nome_empresa, ''),
    'remetente_cnpj', COALESCE(v_config.cnpj, ''),
    'remetente_endereco', COALESCE(v_config.endereco, ''),
    'remetente_cidade_uf', COALESCE(v_config.cidade_uf, ''),
    'remetente_cep', COALESCE(v_config.cep, ''),
    'transportadora_nome', v_rom.transportadora_nome,
    'transportadora_cnpj', v_rom.transportadora_cnpj,
    'motorista_nome', v_rom.motorista_nome,
    'motorista_rg', v_rom.motorista_rg,
    'motorista_cpf', v_rom.motorista_cpf,
    'veiculo_modelo', v_rom.veiculo_modelo,
    'veiculo_placa', v_rom.veiculo_placa,
    'total_nfes', (SELECT COUNT(*) FROM romaneio_itens WHERE romaneio_id = v_rom.id),
    'total_volumes', (SELECT COALESCE(SUM(qtd_volumes),0) FROM romaneio_itens WHERE romaneio_id = v_rom.id),
    'total_peso_kg', (SELECT COALESCE(SUM(peso_kg),0) FROM romaneio_itens WHERE romaneio_id = v_rom.id),
    'depositantes', (SELECT jsonb_agg(DISTINCT depositante) FROM romaneio_itens WHERE romaneio_id = v_rom.id),
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'criado_por_nome', v_rom.criado_por_nome,
    'criado_por_email', v_rom.criado_por_email
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.preencher_dados_coleta(
    p_token              UUID,
    p_transportadora_nome TEXT,
    p_transportadora_cnpj TEXT,
    p_motorista_nome     TEXT,
    p_motorista_rg       TEXT,
    p_motorista_cpf      TEXT,
    p_veiculo_modelo     TEXT,
    p_veiculo_placa      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id     UUID;
    v_status public.romaneio_status;
BEGIN
    SELECT id, status
    INTO   v_id, v_status
    FROM   public.romaneios
    WHERE  token_publico = p_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN JSON_BUILD_OBJECT(
            'success', false,
            'error',   'Romaneio não encontrado. Verifique o link.'
        );
    END IF;

    IF v_status IN ('Liberado', 'Cancelado') THEN
        RETURN JSON_BUILD_OBJECT(
            'success', false,
            'error',   FORMAT('Este romaneio está %s e não aceita mais alterações.', v_status)
        );
    END IF;

    UPDATE public.romaneios SET
        transportadora_nome = p_transportadora_nome,
        transportadora_cnpj = p_transportadora_cnpj,
        motorista_nome      = p_motorista_nome,
        motorista_rg        = p_motorista_rg,
        motorista_cpf       = p_motorista_cpf,
        veiculo_modelo      = p_veiculo_modelo,
        veiculo_placa       = p_veiculo_placa,
        status              = 'Preenchido'
    WHERE id = v_id;

    RETURN JSON_BUILD_OBJECT(
        'success',     true,
        'message',     'Dados registrados com sucesso! Aguarde a liberação.',
        'romaneio_id', v_id
    );
END;
$$;


-- =============================================================
-- SEÇÃO 8: VIEW — ESPELHO COMPLETO DO ROMANEIO
-- =============================================================

CREATE OR REPLACE VIEW public.vw_romaneio_completo AS
SELECT
    r.id                                               AS romaneio_id,
    r.token_publico,
    TO_CHAR(r.data_criacao,     'DD/MM/YYYY HH24:MI') AS data_emissao,
    TO_CHAR(r.data_atualizacao, 'DD/MM/YYYY HH24:MI') AS data_ultima_atualizacao,
    r.status,
    r.observacoes,
    cr.nome_empresa                                    AS remetente_nome,
    cr.cnpj                                            AS remetente_cnpj,
    cr.endereco                                        AS remetente_endereco,
    cr.cidade_uf                                       AS remetente_cidade_uf,
    cr.cep                                             AS remetente_cep,
    r.transportadora_nome,
    r.transportadora_cnpj,
    r.motorista_nome,
    r.motorista_rg,
    r.motorista_cpf,
    r.veiculo_modelo,
    r.veiculo_placa,
    COUNT(ri.id)                                       AS total_nfes,
    COALESCE(SUM(ri.qtd_volumes), 0)                   AS total_volumes,
    COALESCE(ROUND(SUM(ri.peso_kg)::NUMERIC, 2), 0)    AS total_peso_kg,
    ARRAY_AGG(DISTINCT ri.depositante)
        FILTER (WHERE ri.depositante IS NOT NULL)      AS depositantes,
    COALESCE(
        JSON_AGG(
            JSON_BUILD_OBJECT(
                'numero_nfe',           ri.numero_nfe,
                'cliente_destinatario', ri.cliente_destinatario,
                'depositante',          ri.depositante,
                'qtd_volumes',          ri.qtd_volumes,
                'peso_kg',              ri.peso_kg,
                'observacao',           ri.observacao
            ) ORDER BY ri.inserido_em
        ) FILTER (WHERE ri.id IS NOT NULL),
        '[]'::JSON
    )                                                  AS itens,
    p.nome                                             AS criado_por_nome,
    p.email                                            AS criado_por_email
FROM public.romaneios r
CROSS JOIN (SELECT * FROM public.config_remetente LIMIT 1) cr
LEFT  JOIN public.romaneio_itens ri ON ri.romaneio_id = r.id
LEFT  JOIN public.perfis p          ON p.id = r.criado_por
GROUP BY
    r.id, r.token_publico, r.data_criacao, r.data_atualizacao,
    r.status, r.observacoes,
    cr.nome_empresa, cr.cnpj, cr.endereco, cr.cidade_uf, cr.cep,
    r.transportadora_nome, r.transportadora_cnpj,
    r.motorista_nome, r.motorista_rg, r.motorista_cpf,
    r.veiculo_modelo, r.veiculo_placa,
    p.nome, p.email;


-- =============================================================
-- SEÇÃO 9: GRANTS
-- =============================================================

GRANT EXECUTE ON FUNCTION public.get_romaneio_by_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT SELECT ON public.vw_romaneio_completo TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_colaborador()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_token() TO anon, authenticated;
