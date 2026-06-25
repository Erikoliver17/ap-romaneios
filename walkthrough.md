# Walkthrough do Projeto - Alinhamento Mobile com Desktop & Deploy

Este documento resume as implementações realizadas na versão móvel (`/mobile`) e desktop (`/app`) para alinhar suas funcionalidades, controles e fluxos com a aplicação principal, finalizando com o deploy em produção.

---

## 1. Melhorias de Fluxos e Funcionalidades Mobile

### 📝 Novo Romaneio (`NovoRomaneioPage.tsx`)
*   **Bipagem e Consulta WMS**: 
    *   Criada a **"Bipagem de Etiquetas"** com atalho para abrir/fechar a câmera traseira do celular (`html5-qrcode`).
    *   Ao bipar chaves de 44 dígitos ou digitar a NF-e e apertar Enter/Buscar, o sistema consulta os dados no WMS (`buscar-nfe`) e preenche os campos automaticamente no formulário manual (se não encontrado, emite bipe de erro e posiciona os campos para digitação rápida).
    *   Adicionado feedback sonoro (`audioService`) para bipagens com sucesso ou erro.
*   **Depositante Otimizado**: O campo de texto para depositante foi substituído por uma caixa de seleção `<select>` com as 10 opções padronizadas do sistema (Amazon, Correios, Flex, Jadlog, Magalu, Meli, Pex, Shein, Shopee, TikTok).
*   **Transportadora, Motorista e Veículo Cadastrados**:
    *   Adicionado carregamento das listas de motoristas e veículos pré-cadastrados.
    *   Quando a transportadora é selecionada, os seletores de **Motorista** e **Veículo** correspondentes surgem em cascata, filtrando apenas os motoristas/veículos vinculados àquela transportadora.

### ✍️ Assinatura e Exclusão de Romaneio (`RomaneioDetalhePage.tsx`)
*   **Assinatura Direta na Detalhe**: Se o romaneio está em aberto e falta a assinatura do motorista, o painel `SignaturePad` é renderizado diretamente na tela de detalhes do romaneio.
*   **Gravação Rápida**: O operador pode colher a assinatura digital do motorista e clicar em **"Gravar Assinatura"** diretamente, sem precisar abrir o formulário completo de "Alterar Cadastro".
*   **Mover para Lixeira**: Adicionado um botão de excluir (ícone de lixeira vermelha `Trash2`) no canto superior direito do cabeçalho da página de detalhes do romaneio. Esse botão é visível apenas para perfis administradores (`isMaster`) e move o romaneio para a lixeira do banco de dados (atualizando o campo `excluido_em`).

### 🗑️ Lixeira Mobile (`LixeiraPage.tsx` [NEW])
*   Criada a página mobile de lixeira, exibindo os romaneios excluídos em formato de cartões responsivos.
*   Suporta seleção múltipla e ações em massa (**Restaurar** e **Excluir Permanentemente**) adequadas para uso em smartphones.

### 🏢 Transportadoras Mobile (`TransportadorasPage.tsx` [NEW])
*   Criada a página móvel de gerenciamento de transportadoras, com sanfonas expansíveis (accordions).
*   Permite desativar transportadoras e cadastrar novos motoristas (Nome, CPF, RG) e veículos (Modelo, Placa) de forma ágil pela tela do celular.

### 🔀 Rotas e Menu Lateral (`App.tsx` & `MobileLayout.tsx`)
*   Registradas as rotas `/lixeira` e `/transportadoras` no roteador do App mobile.
*   Protegidas para acesso restrito a administradores (`masterOnly`).
*   Adicionados os atalhos de **Transportadoras** e **Lixeira** na gaveta de menu (Drawer), visíveis condicionalmente com base no perfil `master`.

### 📊 Dashboard Simplificado (`DashboardPage.tsx`)
*   Removido o card de ação rápida "Conferir Carga (Bipar)" do Dashboard principal, deixando a conferência de caixa restrita ao fluxo interno da tela de cada romaneio (idêntico ao desktop).

---

## 2. Compilação e Deploy de Produção (Vercel)

1.  **Build de Teste**: Executamos o build local e corrigimos uma chamada a uma função não declarada no formulário de NF-e. O build de produção compilou com 100% de sucesso.
2.  **Deploy**: Deploy de produção realizado com sucesso.
    *   **URL de Produção**: [https://mobile-gamma-lovat.vercel.app](https://mobile-gamma-lovat.vercel.app)

---

## 3. Ajuste de Coleta Desktop (Campos Opcionais)

*   **Validações Relaxadas**: Atualizado o fluxo do formulário "Editar Coleta" em [RomaneioDetalhePage.tsx](file:///C:/Users/Logistica/Desktop/Ap%20Romaneio/app/src/pages/RomaneioDetalhePage.tsx). As restrições de obrigatoriedade foram removidas da função `salvarColetaLocal()`. Agora, campos como Razão Social, CNPJ, Nome do Motorista, CPF, Modelo e Placa do Veículo, assim como a Assinatura do Motorista, são opcionais.
*   **Validação Condicional**: As formatações de CNPJ, CPF e Placa do Veículo continuam sendo validadas para garantir a integridade dos dados, mas apenas se o usuário digitar algum valor nos respectivos campos.
*   **Limpeza de Banco**: Valores vazios ou limpos pelo operador são convertidos para `null` ao salvar no Supabase, evitando inconsistências.
*   **Atualização Visual**: Removido o asterisco `*` de todos os campos no modal de cadastro de coleta, indicando visualmente que nenhum campo é obrigatório.
*   **Deploy de Produção**: 
    *   **Build de Produção**: Executado build local com sucesso.
    *   **Deploy**: Realizado deploy da versão Desktop atualizada.
    *   **URL de Produção Desktop**: [https://app-one-kappa-31.vercel.app](https://app-one-kappa-31.vercel.app)

---

## 4. Sincronização Automática de Cadastros (Trigger Supabase)

*   **Trigger Centralizado (`trg_sync_romaneio_to_cadastros`)**: Instalamos um gatilho de banco de dados (`AFTER INSERT OR UPDATE`) na tabela `romaneios`. Toda vez que um romaneio é criado ou atualizado com dados manuais de coleta (seja via Desktop, aplicativo móvel ou link público de coleta):
    *   **Transportadora**: Verifica e cria automaticamente a transportadora na tabela `transportadoras_cadastradas` usando o CNPJ (ou nome) se ainda não existir.
    *   **Motorista**: Insere ou atualiza o motorista em `motoristas_cadastrados` associado a essa transportadora (utilizando CPF/Nome).
    *   **Veículo**: Cadastra o veículo em `veiculos_cadastrados` com o modelo e a placa vinculada à transportadora.
*   **Foto do Documento**: O trigger também sincroniza automaticamente a foto do documento (`foto_documento_motorista`) para o perfil cadastrado do motorista (`motoristas_cadastrados.foto_documento`) no momento em que ela é tirada.
*   **Segurança (RLS Bypass)**: A função foi declarada com `SECURITY DEFINER`, permitindo que usuários colaboradores ou links públicos sem privilégios administrativos consigam preencher a coleta e ter seus cadastros atualizados de forma segura no banco de dados.
*   **Tipagem**: Atualizados os arquivos de tipos [types/index.ts](file:///C:/Users/Logistica/Desktop/Ap%20Romaneio/app/src/types/index.ts) (Desktop) e [types/index.ts](file:///C:/Users/Logistica/Desktop/Ap%20Romaneio/mobile/src/types/index.ts) (Mobile) para incluir o novo campo `foto_documento` na interface `MotoristaCadastrado`.
*   **Deploy de Ambos os Apps**: Realizado o commit, push e deploy tanto para o Desktop quanto para o Mobile na Vercel para garantir 100% de integridade em produção.
    *   **URL Desktop**: [https://app-one-kappa-31.vercel.app](https://app-one-kappa-31.vercel.app)
    *   **URL Mobile**: [https://mobile-gamma-lovat.vercel.app](https://mobile-gamma-lovat.vercel.app)

---

## 5. Correção do Fechamento de Câmera Mobile (White Screen Crash)

*   **Identificação do Bug**: Ao clicar em "Fechar Câmera" ou alternar para "Digitar Nota", a variável `cameraActive` mudava para `false`, fazendo o React desmontar imediatamente a `div` com o container da câmera (`#novo-romaneio-scanner` ou `#scanner-container`). Com o container fora do DOM, a chamada assíncrona para desligar a câmera (`html5Qrcode.stop()`) no efeito de limpeza falhava, lançando uma exceção não tratada na renderização do React, resultando em uma tela branca (crash).
*   **Correção de DOM Permanente**: Alteramos a renderização condicional dos containers do leitor de câmera em [NovoRomaneioPage.tsx](file:///C:/Users/Logistica/Desktop/Ap%20Romaneio/mobile/src/pages/NovoRomaneioPage.tsx) e [BipadorPage.tsx](file:///C:/Users/Logistica/Desktop/Ap%20Romaneio/mobile/src/pages/BipadorPage.tsx). Agora, os elementos de visualização da câmera e do formulário manual permanecem sempre montados no DOM do React, tendo apenas sua visibilidade controlada via CSS (`display: cameraActive ? 'block' : 'none'`).
*   **Ciclo de Vida do Efeito**: Otimizamos e simplificamos a inicialização e desligamento do scanner no React com a variável local `isMounted`, garantindo que chamadas assíncronas ao leitor não atualizem o estado de componentes desmontados e que o desligamento da câmera ocorra de forma segura, com o elemento alvo ainda no DOM.
*   **Redeploy**: Realizado novo build e deploy do aplicativo móvel para produção:
    *   **URL Mobile**: [https://mobile-gamma-lovat.vercel.app](https://mobile-gamma-lovat.vercel.app)

---

## 6. Migração de Dados da Transportadora Sudoeste

*   **Busca e Identificação**: Localizado o romaneio histórico onde a transportadora cadastrada era a "Sudoeste transportes" (CNPJ: `02343801000428`).
*   **Carga e Migração de Dados**: Executamos uma migração manual a nível de banco de dados para extrair os registros e salvá-los nas tabelas de pré-cadastro:
    *   **Transportadora**: Salva em `transportadoras_cadastradas` com Razão Social "Sudoeste transportes" e CNPJ "02343801000428".
    *   **Motorista**: Salvo em `motoristas_cadastrados` com o nome "Paulo Henrique de souza", CPF "26851391848" e a foto de documento de CNH (base64) correspondente.
    *   **Veículo**: Salvo em `veiculos_cadastrados` com o modelo "Hr" e placa "Csk0984".
*   **Disponibilidade**: Esses dados pré-cadastrados agora estão disponíveis para seleção automática ao criar novos romaneios.

---

## 7. Formatação, Edição, Lixeira de Transportadoras e Foto de CNH

*   **Máscaras de CNPJ e CPF**: 
    *   Implementada formatação nos CNPJs exibidos nos cards de transportadoras.
    *   Implementada formatação nos CPFs exibidos na listagem de motoristas (tanto no Desktop quanto no Mobile).
*   **Edição de Transportadora**:
    *   Adicionado botão de edição (ícone do lápis) nos cards de transportadora.
    *   Ao clicar, preenche o formulário superior e altera o comportamento de salvamento para realizar um `UPDATE` no Supabase, atualizando os dados cadastrados.
*   **Lixeira de Transportadoras**:
    *   Reformulada a página de Lixeira (Desktop e Mobile) para utilizar abas divididas: **Romaneios** e **Transportadoras**.
    *   A aba de Transportadoras exibe todos os registros onde `ativo = false`, mostrando dados relevantes (CNPJ, número de motoristas e veículos cadastrados).
    *   Suporta ações de **Restaurar** (alterando para `ativo = true`) e **Excluir permanentemente** (remoção física do banco), tanto em lote quanto individualmente.
*   **Foto de Documento (CNH) dos Motoristas**:
    *   Adicionado suporte para fazer upload do documento CNH diretamente a partir da lista de motoristas na aba da transportadora (Desktop e Mobile).
    *   O upload suporta compressão via Canvas no navegador (para até 1000px de dimensão e 0.70 de qualidade JPEG) para otimizar armazenamento em base64.
    *   Motoristas com documento salvo exibem um ícone de olho. Clicar nele abre um modal elegante para visualização em tela cheia com opção para remover o documento (`foto_documento = null`).
*   **Deploy & Repositório**:
    *   Realizado novo build de ambos os apps e deploy para a Vercel.
    *   Commits criados e alterações enviadas para a branch `main` no GitHub.

---

## 8. Página de Edição de Romaneio no Mobile

*   **Página Criada (`EditarRomaneioPage.tsx` [NEW])**: Implementada a página de edição de romaneio na versão móvel. A interface foi otimizada para telas de smartphones, evitando uma tabela pesada e utilizando um layout de lista de cartões (cards) responsivo.
*   **Fluxo de Edição de Notas**: Cada nota do romaneio possui botões de Editar e Excluir. Ao clicar em editar, um modal elegante do tipo Bottom Sheet abre com o formulário específico daquela nota (NF-e, Destinatário, Emitente, Depositante e Volumes).
*   **Bipagem, XML e WMS**: A página móvel de edição traz suporte completo a bipagem por câmera, importação múltipla de arquivos XML e consulta integrada ao WMS para preenchimento ágil.
*   **Integração e Roteamento**: A rota `/romaneios/:id/editar` foi devidamente protegida e adicionada ao mobile `App.tsx`. Na tela de detalhes (`RomaneioDetalhePage.tsx`), um botão de Editar (ícone de lápis) foi inserido no cabeçalho do romaneio para administradores.
*   **Redeploy**: Compilado e atualizado na Vercel:
    *   **Desktop**: [https://app-one-kappa-31.vercel.app](https://app-one-kappa-31.vercel.app)
    *   **Mobile**: [https://mobile-gamma-lovat.vercel.app](https://mobile-gamma-lovat.vercel.app)

---

## 9. Categorização e Filtro de Transportadoras (Recorrentes vs Outras)

*   **Banco de Dados (Supabase)**: Habilitada a coluna `recorrente boolean DEFAULT false` na tabela `public.transportadoras_cadastradas`. Executada a migração para marcar as transportadoras padrão do sistema (como `aceville`, `correios`, `flex - pex`, `full`, `mandae` e `marketplace`) como recorrentes, e `sudoeste transportes` como outra.
*   **Cadastro e Edição**:
    *   Tanto na versão **Desktop** quanto na versão **Mobile**, o formulário de cadastrar e editar transportadoras foi atualizado com o campo **"Transportadora Recorrente"** (checkbox).
    *   Ao marcar a opção, o valor é salvo no banco de dados e determina a prioridade e posicionamento na lista.
*   **Separação Visual**:
    *   A listagem de transportadoras agora divide os registros de forma clara em duas seções: **Recorrentes** e **Outras Transportadoras**.
    *   Cada seção exibe um contador de quantidade de itens, facilitando o gerenciamento.
*   **Compilação & Deploy**:
    *   Ambos os aplicativos compilados com sucesso.
    *   Deploy de produção concluído na Vercel:
        *   **Desktop**: [https://app-one-kappa-31.vercel.app](https://app-one-kappa-31.vercel.app)
        *   **Mobile**: [https://mobile-gamma-lovat.vercel.app](https://mobile-gamma-lovat.vercel.app)

---

## 10. Correção de Erro de Roteamento (Vercel 404) no Mobile

*   **Identificação do Problema**: Ao atualizar a página (através de pull-to-refresh ou F5) estando em rotas secundárias (como `/transportadoras`, `/lixeira`, etc.), a Vercel retornava um erro `404 NOT FOUND` pois tentava resolver fisicamente esses arquivos no servidor.
*   **Resolução**: Criado o arquivo `mobile/vercel.json` configurando regras de redirecionamento (`rewrites`) para direcionar todas as rotas secundárias para a `/index.html` do projeto mobile. Dessa forma, o roteador interno do React (React Router) é capaz de assumir e resolver a URL correta no lado do cliente.
*   **Redeploy**: Feito o build e deploy na Vercel:
    *   **Mobile**: [https://mobile-gamma-lovat.vercel.app](https://mobile-gamma-lovat.vercel.app)


