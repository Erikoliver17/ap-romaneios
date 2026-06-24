-- =============================================================
-- MIGRAÇÃO 004 — Lixeira + Foto Documento + Transportadoras
-- Inclui tudo do 003 (idempotente) + novos recursos
-- Execute no SQL Editor do Supabase: odanqvpyuycqptqemfat
-- =============================================================

-- -----------------------------------------------------------
-- PARTE 1 — Migration 002 (idempotente)
-- -----------------------------------------------------------

ALTER TABLE public.romaneios
  ADD COLUMN IF NOT EXISTS observacao_transportadora TEXT,
  ADD COLUMN IF NOT EXISTS token_expira_em TIMESTAMPTZ;

UPDATE public.romaneios
  SET token_expira_em = data_criacao + INTERVAL '7 days'
  WHERE token_expira_em IS NULL;

ALTER TABLE public.romaneios
  ALTER COLUMN token_expira_em SET DEFAULT (NOW() + INTERVAL '7 days');

CREATE TABLE IF NOT EXISTS public.romaneio_historico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  romaneio_id   UUID NOT NULL REFERENCES public.romaneios(id) ON DELETE CASCADE,
  evento        VARCHAR(100) NOT NULL,
  descricao     TEXT,
  dados_antes   JSONB,
  dados_depois  JSONB,
  executado_por UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
  executado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historico_romaneio_id ON public.romaneio_historico(romaneio_id);
CREATE INDEX IF NOT EXISTS idx_historico_executado_em ON public.romaneio_historico(executado_em DESC);

ALTER TABLE public.romaneio_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_historico" ON public.romaneio_historico;
CREATE POLICY "authenticated_select_historico"
  ON public.romaneio_historico FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_romaneio_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO public.romaneio_historico(romaneio_id, evento, descricao, dados_antes, dados_depois)
    VALUES (NEW.id, 'STATUS_ALTERADO',
      FORMAT('Status alterado de "%s" para "%s"', OLD.status, NEW.status),
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_status_change ON public.romaneios;
CREATE TRIGGER trg_log_status_change
  AFTER UPDATE ON public.romaneios
  FOR EACH ROW EXECUTE FUNCTION public.log_romaneio_status_change();

-- romaneio_itens: observacao
ALTER TABLE public.romaneio_itens ADD COLUMN IF NOT EXISTS observacao TEXT;

-- config_remetente (idempotente)
CREATE TABLE IF NOT EXISTS public.config_remetente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_empresa TEXT NOT NULL DEFAULT '',
  cnpj         TEXT NOT NULL DEFAULT '',
  endereco     TEXT NOT NULL DEFAULT '',
  cidade_uf    TEXT NOT NULL DEFAULT '',
  cep          TEXT NOT NULL DEFAULT '',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.config_remetente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_config" ON public.config_remetente;
CREATE POLICY "auth_all_config" ON public.config_remetente FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.config_remetente(nome_empresa) SELECT '' WHERE NOT EXISTS (SELECT 1 FROM public.config_remetente);

-- get_romaneio_public view (002)
DROP VIEW IF EXISTS public.get_romaneio_public CASCADE;

-- -----------------------------------------------------------
-- PARTE 2 — Migration 003 (idempotente)
-- -----------------------------------------------------------

-- Novas colunas em romaneios
ALTER TABLE public.romaneios
  ADD COLUMN IF NOT EXISTS assinatura_motorista TEXT,
  ADD COLUMN IF NOT EXISTS email_notificacao TEXT;

-- Novas colunas em romaneio_itens
ALTER TABLE public.romaneio_itens
  ADD COLUMN IF NOT EXISTS bipado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bipado_codigo TEXT;

-- Tabela transportadoras_cadastradas
CREATE TABLE IF NOT EXISTS public.transportadoras_cadastradas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  cnpj             TEXT NOT NULL,
  contato_email    TEXT,
  contato_telefone TEXT,
  ativo            BOOLEAN NOT NULL DEFAULT true,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transportadoras_cadastradas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_transportadoras" ON public.transportadoras_cadastradas;
CREATE POLICY "auth_all_transportadoras"
  ON public.transportadoras_cadastradas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Tabela motoristas_cadastrados
CREATE TABLE IF NOT EXISTS public.motoristas_cadastrados (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transportadora_id   UUID NOT NULL REFERENCES public.transportadoras_cadastradas(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL,
  cpf                 TEXT,
  rg                  TEXT,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.motoristas_cadastrados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_motoristas" ON public.motoristas_cadastrados;
CREATE POLICY "auth_all_motoristas"
  ON public.motoristas_cadastrados FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Tabela veiculos_cadastrados
CREATE TABLE IF NOT EXISTS public.veiculos_cadastrados (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transportadora_id   UUID NOT NULL REFERENCES public.transportadoras_cadastradas(id) ON DELETE CASCADE,
  modelo              TEXT NOT NULL,
  placa               TEXT NOT NULL,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.veiculos_cadastrados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_veiculos" ON public.veiculos_cadastrados;
CREATE POLICY "auth_all_veiculos"
  ON public.veiculos_cadastrados FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Função bipar_item_romaneio
CREATE OR REPLACE FUNCTION public.bipar_item_romaneio(
  p_romaneio_id UUID,
  p_item_id UUID,
  p_codigo TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item romaneio_itens%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM romaneio_itens WHERE id = p_item_id AND romaneio_id = p_romaneio_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'item not found'); END IF;

  IF v_item.bipado_em IS NULL THEN
    UPDATE romaneio_itens SET bipado_em = NOW(), bipado_codigo = p_codigo WHERE id = p_item_id;
    RETURN jsonb_build_object('bipado', true, 'bipado_em', NOW());
  ELSE
    UPDATE romaneio_itens SET bipado_em = NULL, bipado_codigo = NULL WHERE id = p_item_id;
    RETURN jsonb_build_object('bipado', false);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bipar_item_romaneio(UUID, UUID, TEXT) TO authenticated;

-- Atualizar get_romaneio_by_token para incluir novos campos
DROP FUNCTION IF EXISTS public.get_romaneio_by_token(TEXT) CASCADE;

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

GRANT EXECUTE ON FUNCTION public.get_romaneio_by_token(TEXT) TO anon, authenticated;

-- Atualizar preencher_dados_coleta para 10 parâmetros (com assinatura)
DROP FUNCTION IF EXISTS public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.preencher_dados_coleta(
  p_token TEXT,
  p_transportadora_nome TEXT,
  p_transportadora_cnpj TEXT,
  p_motorista_nome TEXT,
  p_motorista_rg TEXT,
  p_motorista_cpf TEXT,
  p_veiculo_modelo TEXT,
  p_veiculo_placa TEXT,
  p_observacao TEXT DEFAULT NULL,
  p_assinatura TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM romaneios
  WHERE token_publico = CASE WHEN p_token ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN p_token::uuid ELSE NULL END
    AND (token_expira_em IS NULL OR token_expira_em > NOW())
    AND excluido_em IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'token_invalido'); END IF;

  UPDATE romaneios SET
    transportadora_nome = p_transportadora_nome,
    transportadora_cnpj = p_transportadora_cnpj,
    motorista_nome      = p_motorista_nome,
    motorista_rg        = p_motorista_rg,
    motorista_cpf       = p_motorista_cpf,
    veiculo_modelo      = p_veiculo_modelo,
    veiculo_placa       = p_veiculo_placa,
    observacao_transportadora = p_observacao,
    assinatura_motorista = p_assinatura,
    status = CASE WHEN status = 'Pendente' THEN 'Preenchido' ELSE status END
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'romaneio_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preencher_dados_coleta(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

-- -----------------------------------------------------------
-- PARTE 3 — Migration 004: Lixeira + Foto Documento
-- -----------------------------------------------------------

-- Lixeira: soft delete
ALTER TABLE public.romaneios
  ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS excluido_por UUID REFERENCES public.perfis(id) ON DELETE SET NULL;

-- Foto do documento do motorista
ALTER TABLE public.romaneios
  ADD COLUMN IF NOT EXISTS foto_documento_motorista TEXT;

CREATE INDEX IF NOT EXISTS idx_romaneios_excluido ON public.romaneios(excluido_em) WHERE excluido_em IS NOT NULL;
