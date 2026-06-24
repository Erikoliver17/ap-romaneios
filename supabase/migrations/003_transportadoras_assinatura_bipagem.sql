-- =============================================================
-- MIGRAÇÃO 003 — Transportadoras, Assinatura, Bipagem, Email
-- Inclui tudo do 002 (idempotente) + novos recursos
-- Execute no SQL Editor do Supabase: odanqvpyuycqptqemfat
-- =============================================================

-- -----------------------------------------------------------
-- PARTE 1 — Migration 002 (idempotente — pode rodar novamente)
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
  ON public.romaneio_historico FOR SELECT
  TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_romaneio_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO public.romaneio_historico(romaneio_id, evento, descricao, dados_antes, dados_depois, executado_por)
    VALUES (NEW.id, 'STATUS_ALTERADO',
      FORMAT('Status alterado de "%s" para "%s"', OLD.status, NEW.status),
      JSONB_BUILD_OBJECT('status', OLD.status),
      JSONB_BUILD_OBJECT('status', NEW.status),
      auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS romaneios_log_status ON public.romaneios;
CREATE TRIGGER romaneios_log_status
  AFTER UPDATE ON public.romaneios
  FOR EACH ROW EXECUTE FUNCTION public.log_romaneio_status_change();


-- -----------------------------------------------------------
-- PARTE 2 — Novos campos em tabelas existentes
-- -----------------------------------------------------------

ALTER TABLE public.romaneios
  ADD COLUMN IF NOT EXISTS assinatura_motorista TEXT,
  ADD COLUMN IF NOT EXISTS email_notificacao    TEXT;

ALTER TABLE public.romaneio_itens
  ADD COLUMN IF NOT EXISTS bipado_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bipado_codigo TEXT;


-- -----------------------------------------------------------
-- PARTE 3 — Transportadoras pré-cadastradas
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transportadoras_cadastradas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             VARCHAR(255) NOT NULL,
  cnpj             VARCHAR(18)  NOT NULL,
  contato_email    VARCHAR(255),
  contato_telefone VARCHAR(20),
  ativo            BOOLEAN      DEFAULT true,
  criado_em        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.motoristas_cadastrados (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transportadora_id UUID REFERENCES public.transportadoras_cadastradas(id) ON DELETE CASCADE,
  nome              VARCHAR(255) NOT NULL,
  cpf               VARCHAR(14),
  rg                VARCHAR(20),
  ativo             BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.veiculos_cadastrados (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transportadora_id UUID REFERENCES public.transportadoras_cadastradas(id) ON DELETE CASCADE,
  modelo            VARCHAR(100) NOT NULL,
  placa             VARCHAR(10)  NOT NULL,
  ativo             BOOLEAN DEFAULT true
);

ALTER TABLE public.transportadoras_cadastradas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoristas_cadastrados      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veiculos_cadastrados        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_transportadoras" ON public.transportadoras_cadastradas;
CREATE POLICY "auth_all_transportadoras" ON public.transportadoras_cadastradas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_motoristas" ON public.motoristas_cadastrados;
CREATE POLICY "auth_all_motoristas" ON public.motoristas_cadastrados
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_veiculos" ON public.veiculos_cadastrados;
CREATE POLICY "auth_all_veiculos" ON public.veiculos_cadastrados
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- -----------------------------------------------------------
-- PARTE 4 — Função de bipagem (authenticated via SECURITY DEFINER)
-- -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bipar_item_romaneio(
  p_romaneio_id UUID,
  p_item_id     UUID,
  p_codigo      TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status public.romaneio_status;
  v_bipado TIMESTAMPTZ;
BEGIN
  SELECT status INTO v_status
  FROM   public.romaneios WHERE id = p_romaneio_id;

  IF NOT FOUND THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Romaneio nao encontrado');
  END IF;

  IF v_status = 'Cancelado' THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Romaneio cancelado');
  END IF;

  SELECT bipado_em INTO v_bipado
  FROM   public.romaneio_itens WHERE id = p_item_id AND romaneio_id = p_romaneio_id;

  IF NOT FOUND THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Item nao encontrado');
  END IF;

  -- Toggle: se já bipado, desfaz; se não, bipa
  IF v_bipado IS NOT NULL THEN
    UPDATE public.romaneio_itens
      SET bipado_em = NULL, bipado_codigo = NULL
    WHERE id = p_item_id AND romaneio_id = p_romaneio_id;
    RETURN JSON_BUILD_OBJECT('success', true, 'bipado', false);
  ELSE
    UPDATE public.romaneio_itens
      SET bipado_em = NOW(), bipado_codigo = p_codigo
    WHERE id = p_item_id AND romaneio_id = p_romaneio_id;
    RETURN JSON_BUILD_OBJECT('success', true, 'bipado', true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bipar_item_romaneio(UUID, UUID, TEXT) TO authenticated;


-- -----------------------------------------------------------
-- PARTE 5 — Atualiza get_romaneio_by_token (inclui assinatura + bipagem)
-- -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_romaneio_by_token(p_token UUID)
RETURNS TABLE (
  romaneio_id               UUID,
  token_publico             UUID,
  token_expira_em           TIMESTAMPTZ,
  data_criacao              TIMESTAMPTZ,
  data_atualizacao          TIMESTAMPTZ,
  status                    public.romaneio_status,
  remetente_nome            TEXT,
  remetente_cnpj            TEXT,
  remetente_endereco        TEXT,
  remetente_cidade_uf       TEXT,
  remetente_cep             TEXT,
  transportadora_nome       TEXT,
  transportadora_cnpj       TEXT,
  motorista_nome            TEXT,
  motorista_rg              TEXT,
  motorista_cpf             TEXT,
  veiculo_modelo            TEXT,
  veiculo_placa             TEXT,
  observacao_transportadora TEXT,
  assinatura_motorista      TEXT,
  total_nfes                BIGINT,
  total_volumes             BIGINT,
  total_peso_kg             NUMERIC,
  itens                     JSON
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.token_publico,
    r.token_expira_em,
    r.data_criacao,
    r.data_atualizacao,
    r.status,
    cr.nome_empresa::TEXT,
    cr.cnpj::TEXT,
    cr.endereco::TEXT,
    cr.cidade_uf::TEXT,
    cr.cep::TEXT,
    r.transportadora_nome::TEXT,
    r.transportadora_cnpj::TEXT,
    r.motorista_nome::TEXT,
    r.motorista_rg::TEXT,
    r.motorista_cpf::TEXT,
    r.veiculo_modelo::TEXT,
    r.veiculo_placa::TEXT,
    r.observacao_transportadora::TEXT,
    r.assinatura_motorista::TEXT,
    COUNT(ri.id),
    COALESCE(SUM(ri.qtd_volumes), 0),
    COALESCE(ROUND(SUM(ri.peso_kg)::NUMERIC, 2), 0),
    COALESCE(
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'id',                   ri.id,
          'numero_nfe',           ri.numero_nfe,
          'cliente_destinatario', ri.cliente_destinatario,
          'depositante',          ri.depositante,
          'qtd_volumes',          ri.qtd_volumes,
          'peso_kg',              ri.peso_kg,
          'bipado_em',            ri.bipado_em,
          'bipado_codigo',        ri.bipado_codigo
        ) ORDER BY ri.inserido_em
      ) FILTER (WHERE ri.id IS NOT NULL),
      '[]'::JSON
    )
  FROM public.romaneios r
  CROSS JOIN (SELECT * FROM public.config_remetente LIMIT 1) cr
  LEFT JOIN public.romaneio_itens ri ON ri.romaneio_id = r.id
  WHERE r.token_publico = p_token
  GROUP BY
    r.id, r.token_publico, r.token_expira_em, r.data_criacao, r.data_atualizacao, r.status,
    cr.nome_empresa, cr.cnpj, cr.endereco, cr.cidade_uf, cr.cep,
    r.transportadora_nome, r.transportadora_cnpj,
    r.motorista_nome, r.motorista_rg, r.motorista_cpf,
    r.veiculo_modelo, r.veiculo_placa, r.observacao_transportadora, r.assinatura_motorista;
END;
$$;


-- -----------------------------------------------------------
-- PARTE 6 — Atualiza preencher_dados_coleta (agora com assinatura, 10 params)
-- -----------------------------------------------------------

DROP FUNCTION IF EXISTS public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.preencher_dados_coleta(
  p_token                     UUID,
  p_transportadora_nome       TEXT,
  p_transportadora_cnpj       TEXT,
  p_motorista_nome            TEXT,
  p_motorista_rg              TEXT,
  p_motorista_cpf             TEXT,
  p_veiculo_modelo            TEXT,
  p_veiculo_placa             TEXT,
  p_observacao_transportadora TEXT DEFAULT NULL,
  p_assinatura                TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id        UUID;
  v_status    public.romaneio_status;
  v_expira_em TIMESTAMPTZ;
BEGIN
  SELECT id, status, token_expira_em
  INTO   v_id, v_status, v_expira_em
  FROM   public.romaneios
  WHERE  token_publico = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Romaneio nao encontrado. Verifique o link.');
  END IF;

  IF v_expira_em IS NOT NULL AND NOW() > v_expira_em THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Este link expirou. Entre em contato com o remetente para obter um novo link.');
  END IF;

  IF v_status IN ('Liberado', 'Cancelado') THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error',
      FORMAT('Este romaneio esta %s e nao aceita mais alteracoes.', v_status));
  END IF;

  UPDATE public.romaneios SET
    transportadora_nome       = p_transportadora_nome,
    transportadora_cnpj       = p_transportadora_cnpj,
    motorista_nome            = p_motorista_nome,
    motorista_rg              = p_motorista_rg,
    motorista_cpf             = p_motorista_cpf,
    veiculo_modelo            = p_veiculo_modelo,
    veiculo_placa             = p_veiculo_placa,
    observacao_transportadora = p_observacao_transportadora,
    assinatura_motorista      = p_assinatura,
    status                    = 'Preenchido'
  WHERE id = v_id;

  INSERT INTO public.romaneio_historico(romaneio_id, evento, descricao)
  VALUES (v_id, 'COLETA_PREENCHIDA', 'Dados de coleta preenchidos pela transportadora');

  RETURN JSON_BUILD_OBJECT('success', true,
    'message', 'Dados registrados com sucesso! Aguarde a liberacao.',
    'romaneio_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT SELECT ON public.romaneio_historico TO authenticated;
GRANT SELECT ON public.transportadoras_cadastradas TO authenticated;
GRANT SELECT ON public.motoristas_cadastrados       TO authenticated;
GRANT SELECT ON public.veiculos_cadastrados         TO authenticated;
