// supabase/functions/importar-nfe/index.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────
interface NFeItem {
  numero_nfe: string;
  cliente_destinatario: string;
  depositante: string;
  qtd_volumes: number;
  peso_kg?: number;
  observacao?: string;
}

interface ImportacaoPayload {
  romaneio_id?: string;
  transportadora_cnpj?: string;
  itens: NFeItem[];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-webhook-signature",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

/** Verifica assinatura HMAC-SHA256 opcional.
 *  Esperado no header: x-webhook-signature: sha256=<hex>
 *  Se WEBHOOK_SECRET não estiver definido, a verificação é ignorada. */
async function verifyHmac(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret) return true; // HMAC não configurado — apenas API key é exigida

  const signature = req.headers.get("x-webhook-signature");
  if (!signature?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expectedHex = Array.from(new Uint8Array(expected))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signature === `sha256=${expectedHex}`;
}

/** Parser XML mínimo para payloads de WMS.
 *  Ajuste os nomes das tags para o formato real do seu sistema. */
function parseXmlPayload(xml: string): ImportacaoPayload {
  // Basic guard against XXE: reject if DOCTYPE is present
  if (/<\s*!DOCTYPE/i.test(xml)) {
    throw new Error("DOCTYPE não é permitido no payload XML.");
  }

  const tag = (source: string, name: string): string =>
    source.match(new RegExp(`<${name}[^>]*>([^<]*)<\/${name}>`, "i"))?.[1]?.trim() ?? "";

  const itens: NFeItem[] = [];
  for (const match of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    itens.push({
      numero_nfe:           tag(block, "chNFe") || tag(block, "nNF"),
      cliente_destinatario: tag(block, "xNome") || tag(block, "destinatario"),
      depositante:          tag(block, "depositante") || tag(block, "emitente"),
      qtd_volumes:          parseInt(tag(block, "qtdVol") || tag(block, "volumes") || "1", 10),
      peso_kg:              parseFloat(tag(block, "pesoB") || "0") || undefined,
    });
  }

  return {
    romaneio_id:         tag(xml, "romaneio_id")        || undefined,
    transportadora_cnpj: tag(xml, "cnpjTransportadora") || undefined,
    itens,
  };
}

function validatePayload(p: ImportacaoPayload): string | null {
  if (!p.itens?.length)             return "O campo 'itens' é obrigatório e não pode ser vazio.";
  if (p.itens.length > 500)         return "Máximo de 500 itens por requisição.";
  for (const [i, item] of p.itens.entries()) {
    if (!item.numero_nfe)           return `Item[${i}]: numero_nfe é obrigatório.`;
    if (!item.cliente_destinatario) return `Item[${i}]: cliente_destinatario é obrigatório.`;
    if (!item.depositante)          return `Item[${i}]: depositante é obrigatório.`;
    if (!item.qtd_volumes || item.qtd_volumes < 1)
                                    return `Item[${i}]: qtd_volumes deve ser >= 1.`;
  }
  return null;
}

// ─────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // ── Autenticação por API Key ─────────────────
  const apiKey      = req.headers.get("x-api-key");
  const expectedKey = Deno.env.get("WMS_API_KEY");

  if (!expectedKey || apiKey !== expectedKey) {
    return json({ error: "Unauthorized", message: "API Key inválida ou ausente." }, 401);
  }

  // ── Parse do payload (JSON ou XML) ───────────
  let payload: ImportacaoPayload;
  let rawBody: string;
  try {
    rawBody = await req.text();
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("xml")) {
      payload = parseXmlPayload(rawBody);
    } else {
      payload = JSON.parse(rawBody);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Payload não pôde ser interpretado.";
    return json({ error: "Bad Request", message: msg }, 400);
  }

  // ── Verificação HMAC (se WEBHOOK_SECRET configurado) ─
  const hmacValid = await verifyHmac(req, rawBody);
  if (!hmacValid) {
    return json({ error: "Unauthorized", message: "Assinatura HMAC inválida." }, 401);
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    return json({ error: "Bad Request", message: validationError }, 400);
  }

  // ── Cliente Supabase com Service Role ────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    let romaneioId    = payload.romaneio_id;
    let tokenPublico: string | null = null;

    // ── Cria romaneio se não foi informado ───────
    if (!romaneioId) {
      const { data: novo, error: errRomaneio } = await supabase
        .from("romaneios")
        .insert({
          transportadora_cnpj: payload.transportadora_cnpj ?? null,
          status: "Pendente",
        })
        .select("id, token_publico")
        .single();

      if (errRomaneio) throw errRomaneio;
      romaneioId   = novo.id;
      tokenPublico = novo.token_publico;

    } else {
      const { data: existente, error: errCheck } = await supabase
        .from("romaneios")
        .select("id, status, token_publico")
        .eq("id", romaneioId)
        .single();

      if (errCheck || !existente) {
        return json({ error: "Not Found", message: "Romaneio não encontrado." }, 404);
      }
      if (["Liberado", "Cancelado"].includes(existente.status)) {
        return json(
          { error: "Conflict", message: `Romaneio está ${existente.status} e não aceita novos itens.` },
          409
        );
      }
      tokenPublico = existente.token_publico;
    }

    // ── Detecta NF-e duplicadas no payload ───────
    const nfesNoPayload = payload.itens.map(i => i.numero_nfe.trim().toLowerCase());
    const duplicatasPayload = nfesNoPayload.filter((n, i) => nfesNoPayload.indexOf(n) !== i)
    if (duplicatasPayload.length > 0) {
      return json(
        { error: "Bad Request", message: `NF-e duplicada no payload: ${[...new Set(duplicatasPayload)].join(", ")}` },
        400
      );
    }

    // ── Verifica NF-es já existentes no romaneio ─
    const { data: existentes } = await supabase
      .from("romaneio_itens")
      .select("numero_nfe")
      .eq("romaneio_id", romaneioId)
      .in("numero_nfe", payload.itens.map(i => i.numero_nfe.trim()));

    if (existentes && existentes.length > 0) {
      const duplicatas = existentes.map((e: { numero_nfe: string }) => e.numero_nfe).join(", ");
      return json(
        { error: "Conflict", message: `NF-e já existente neste romaneio: ${duplicatas}` },
        409
      );
    }

    // ── Insere os itens ─────────────────────────
    const itensParaInserir = payload.itens.map((item) => ({
      romaneio_id:          romaneioId,
      numero_nfe:           item.numero_nfe.trim(),
      cliente_destinatario: item.cliente_destinatario.trim(),
      depositante:          item.depositante.trim(),
      qtd_volumes:          item.qtd_volumes,
      peso_kg:              item.peso_kg ?? null,
      observacao:           item.observacao ?? null,
    }));

    const { data: itensSalvos, error: errItens } = await supabase
      .from("romaneio_itens")
      .insert(itensParaInserir)
      .select("id, numero_nfe");

    if (errItens) throw errItens;

    const appUrl = Deno.env.get("APP_URL") ?? "";

    return json(
      {
        success:             true,
        romaneio_id:         romaneioId,
        token_publico:       tokenPublico,
        itens_inseridos:     itensSalvos.length,
        link_transportadora: `${appUrl}/coleta/${tokenPublico}`,
      },
      payload.romaneio_id ? 200 : 201
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[importar-nfe] Erro:", message);
    return json({ error: "Internal Server Error", message: "Ocorreu um erro interno. Tente novamente." }, 500);
  }
});
