-- =============================================================
-- MIGRAÇÃO 002 — Melhorias: observação, expiração, histórico
-- Execute no SQL Editor do Supabase na ordem apresentada.
-- =============================================================


-- -----------------------------------------------------------
-- 1. Novos campos em romaneios
-- -----------------------------------------------------------
ALTER TABLE public.romaneios
  ADD COLUMN IF NOT EXISTS observacao_transportadora TEXT,
  ADD COLUMN IF NOT EXISTS token_expira_em TIMESTAMPTZ;

-- Define expiração de 7 dias para registros já existentes
UPDATE public.romaneios
  SET token_expira_em = data_criacao + INTERVAL '7 days'
  WHERE token_expira_em IS NULL;

-- Garante que novos romaneios já nascem com expiração de 7 dias
ALTER TABLE public.romaneios
  ALTER COLUMN token_expira_em SET DEFAULT (NOW() + INTERVAL '7 days');


-- -----------------------------------------------------------
-- 2. Tabela de histórico de eventos
-- -----------------------------------------------------------
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

-- RLS
ALTER TABLE public.romaneio_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_historico" ON public.romaneio_historico;
CREATE POLICY "authenticated_select_historico"
  ON public.romaneio_historico FOR SELECT
  TO authenticated
  USING (true);


-- -----------------------------------------------------------
-- 3. Trigger: registra mudanças de status automaticamente
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_romaneio_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO public.romaneio_historico(romaneio_id, evento, descricao, dados_antes, dados_depois, executado_por)
    VALUES (
      NEW.id,
      'STATUS_ALTERADO',
      FORMAT('Status alterado de "%s" para "%s"', OLD.status, NEW.status),
      JSONB_BUILD_OBJECT('status', OLD.status),
      JSONB_BUILD_OBJECT('status', NEW.status),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS romaneios_log_status ON public.romaneios;
CREATE TRIGGER romaneios_log_status
  AFTER UPDATE ON public.romaneios
  FOR EACH ROW EXECUTE FUNCTION public.log_romaneio_status_change();


-- -----------------------------------------------------------
-- 4. Atualiza get_romaneio_by_token com novos campos
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_romaneio_by_token(p_token UUID)
RETURNS TABLE (
  romaneio_id                UUID,
  token_publico              UUID,
  token_expira_em            TIMESTAMPTZ,
  data_criacao               TIMESTAMPTZ,
  data_atualizacao           TIMESTAMPTZ,
  status                     public.romaneio_status,
  remetente_nome             TEXT,
  remetente_cnpj             TEXT,
  remetente_endereco         TEXT,
  remetente_cidade_uf        TEXT,
  remetente_cep              TEXT,
  transportadora_nome        TEXT,
  transportadora_cnpj        TEXT,
  motorista_nome             TEXT,
  motorista_rg               TEXT,
  motorista_cpf              TEXT,
  veiculo_modelo             TEXT,
  veiculo_placa              TEXT,
  observacao_transportadora  TEXT,
  total_nfes                 BIGINT,
  total_volumes              BIGINT,
  total_peso_kg              NUMERIC,
  itens                      JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
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
          'peso_kg',              ri.peso_kg
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
    r.veiculo_modelo, r.veiculo_placa, r.observacao_transportadora;
END;
$$;


-- -----------------------------------------------------------
-- 5. Atualiza preencher_dados_coleta com observação e expiração
-- -----------------------------------------------------------

-- Remove a versão antiga (8 parâmetros) para evitar ambiguidade
DROP FUNCTION IF EXISTS public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.preencher_dados_coleta(
  p_token                    UUID,
  p_transportadora_nome      TEXT,
  p_transportadora_cnpj      TEXT,
  p_motorista_nome           TEXT,
  p_motorista_rg             TEXT,
  p_motorista_cpf            TEXT,
  p_veiculo_modelo           TEXT,
  p_veiculo_placa            TEXT,
  p_observacao_transportadora TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id         UUID;
  v_status     public.romaneio_status;
  v_expira_em  TIMESTAMPTZ;
BEGIN
  SELECT id, status, token_expira_em
  INTO   v_id, v_status, v_expira_em
  FROM   public.romaneios
  WHERE  token_publico = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Romaneio não encontrado. Verifique o link.');
  END IF;

  IF v_expira_em IS NOT NULL AND NOW() > v_expira_em THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', 'Este link expirou. Entre em contato com o remetente para obter um novo link.');
  END IF;

  IF v_status IN ('Liberado', 'Cancelado') THEN
    RETURN JSON_BUILD_OBJECT('success', false, 'error', FORMAT('Este romaneio está %s e não aceita mais alterações.', v_status));
  END IF;

  UPDATE public.romaneios SET
    transportadora_nome         = p_transportadora_nome,
    transportadora_cnpj         = p_transportadora_cnpj,
    motorista_nome              = p_motorista_nome,
    motorista_rg                = p_motorista_rg,
    motorista_cpf               = p_motorista_cpf,
    veiculo_modelo              = p_veiculo_modelo,
    veiculo_placa               = p_veiculo_placa,
    observacao_transportadora   = p_observacao_transportadora,
    status                      = 'Preenchido'
  WHERE id = v_id;

  -- Registra o evento no histórico (trigger cuida do status, mas aqui temos detalhes extras)
  INSERT INTO public.romaneio_historico(romaneio_id, evento, descricao)
  VALUES (v_id, 'COLETA_PREENCHIDA', 'Dados de coleta preenchidos pela transportadora');

  RETURN JSON_BUILD_OBJECT('success', true, 'message', 'Dados registrados com sucesso! Aguarde a liberação.', 'romaneio_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preencher_dados_coleta(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT SELECT ON public.romaneio_historico TO authenticated;
