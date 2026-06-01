// ═══════════════════════════════════════════════════════════════════════
// PATCH: index.html — Integração Supabase
// 
// Este arquivo mostra EXATAMENTE o que deve ser substituído no index.html
// original para migrar para o Supabase. As seções estão marcadas com:
//   [REMOVER]  → apagar do código original
//   [SUBSTITUIR POR]  → colar no lugar
//   [ADICIONAR]  → adicionar em novo local
// ═══════════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────────
// 1. NO <head>, ANTES DO </head>
//    [ADICIONAR] importmap para o Supabase JS
// ───────────────────────────────────────────────────────────────────────
/*
<script type="importmap">
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
  }
}
</script>
*/


// ───────────────────────────────────────────────────────────────────────
// 2. NO HEADER (.user-pill onclick="abrirModalUsuario()")
//    [SUBSTITUIR POR] → pill mostra nome do usuário autenticado + logout
// ───────────────────────────────────────────────────────────────────────
/*
<!-- ANTES (remover): -->
<div class="user-pill" onclick="abrirModalUsuario()" title="Trocar analista">
  <svg ...></svg>
  <span id="user-nome-hdr">Selecionar analista</span>
</div>

<!-- DEPOIS (substituir por): -->
<div class="user-pill" style="cursor:default">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
  <span id="user-nome-hdr">Carregando...</span>
  <span id="user-role-badge" style="font-size:8px;opacity:.6;margin-left:3px"></span>
</div>
<button onclick="doLogout()" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.7);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Barlow',sans-serif;margin-left:4px;flex-shrink:0" title="Encerrar sessão">⏏</button>
*/


// ───────────────────────────────────────────────────────────────────────
// 3. BOTÃO "Auditoria" na nav (apenas admin/supervisor vê)
//    [SUBSTITUIR POR] → botão condicional
// ───────────────────────────────────────────────────────────────────────
/*
<!-- ANTES (remover): -->
<button class="nb" onclick="abrirAuditoria()" id="nav-auditoria"><div class="nd"></div><span>Auditoria</span></button>

<!-- DEPOIS — o botão é inserido dinamicamente no JS apenas para admin/supervisor -->
<button class="nb" onclick="window.location.href='/admin.html'" id="nav-auditoria" style="display:none"><div class="nd"></div><span>Admin</span></button>
*/


// ───────────────────────────────────────────────────────────────────────
// 4. MODAL #ov-usuario (seleção manual de analista)
//    [REMOVER] → apagar todo o bloco abaixo do HTML
// ───────────────────────────────────────────────────────────────────────
/*
<!-- REMOVER COMPLETAMENTE: -->
<div class="ov" id="ov-usuario" onclick="">
  <div class="modal" style="max-width:400px">
    ...todo o conteúdo...
  </div>
</div>
*/


// ───────────────────────────────────────────────────────────────────────
// 5. AUDIT-LOCK (senha hardcoded)
//    [REMOVER] → apagar todo o bloco abaixo do HTML
// ───────────────────────────────────────────────────────────────────────
/*
<!-- REMOVER COMPLETAMENTE: -->
<div class="audit-lock" id="audit-lock">
  ...todo o conteúdo...
</div>
*/


// ───────────────────────────────────────────────────────────────────────
// 6. NO <script> PRINCIPAL — SUBSTITUIÇÕES DE CÓDIGO
// ───────────────────────────────────────────────────────────────────────

// ── 6a. Constantes [REMOVER] ────────────────────────────────────────────
// REMOVER:
// const DB_KEY = 'paz5_v4';
// const AUDIT_PASS = '040520';

// ── 6b. Estado global [MODIFICAR] ─────────────────────────────────────
// REMOVER as variáveis relacionadas a analistas:
// let analistas=[];
// let analAtual='';
// let audOk=false;

// ── 6c. Funções [REMOVER] ───────────────────────────────────────────────
// Remover completamente:
// function iniciarAnalista() { ... }
// function setAnalista(nome) { ... }
// function abrirModalUsuario() { ... }
// function renderListaAnalistas() { ... }
// function addAnalista() { ... }
// function abrirAuditoria() { ... }
// function verificarSenha() { ... }
// function sairAuditoria() { ... }
// function salvarState() { ... }      ← substituída pela versão Supabase
// function carregarState() { ... }    ← substituída pela versão Supabase
// function pollSync() { ... }         ← Supabase tem realtime nativo
// function limparTudo() { ... }       ← substituída


// ═══════════════════════════════════════════════════════════════════════
// 7. BLOCO COMPLETO DO SCRIPT PARA SUBSTITUIR NO FINAL DO index.html
//    Cole este bloco no lugar de todo o <script> atual
// ═══════════════════════════════════════════════════════════════════════

/*
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script type="module">
*/

// ── IMPORTS ─────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = 'SEU_SUPABASE_URL';
const SUPABASE_ANON = 'SUA_SUPABASE_ANON_KEY';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ── PROTEÇÃO DE ROTA ────────────────────────────────────────────────────
const { data: { session } } = await sb.auth.getSession();
if (!session) {
  window.location.replace('/login.html');
  throw new Error('Não autenticado');
}

const { data: perfil } = await sb
  .from('profiles')
  .select('id, nome, role, status')
  .eq('id', session.user.id)
  .single();

if (!perfil || perfil.status !== 'ativo') {
  await sb.auth.signOut();
  window.location.replace('/login.html');
  throw new Error('Conta inativa');
}

// Header
document.getElementById('user-nome-hdr').textContent  = perfil.nome;
document.getElementById('user-role-badge').textContent = perfil.role === 'admin' ? '★ ADM' : perfil.role === 'supervisor' ? '◆ SUP' : '';

// Mostrar link de admin para admin/supervisor
if (['admin','supervisor'].includes(perfil.role)) {
  document.getElementById('nav-auditoria').style.display = 'flex';
}

// Variável global do analista = usuário autenticado
const analAtual     = perfil.nome;
const analAtualId   = session.user.id;

// ── CONSTANTES (mantidas) ───────────────────────────────────────────────
const TENT_MOTIVOS = ['Caixa postal','Número Inválido','Não completa ligação','Ligar depois','Ocupado'];

// ── ESTADO GLOBAL ───────────────────────────────────────────────────────
let mots=[], oris={}, tents={};
let motAtual=null, notaSel='', notaTeSel='';
let charts={}, todosCache=[];
let oriCliSel=null, regCliSel=null, tentCliSel=null, histCliSel=null;
let sortCol='indice', sortDir='desc';
let audSortCol='data', audSortDir='desc';
let editTentId=null, editTentUid=null;

// ── LOGOUT ──────────────────────────────────────────────────────────────
window.doLogout = async function() {
  if (!confirm('Deseja encerrar a sessão?')) return;
  await sb.from('logs').insert({ acao:'LOGOUT', descricao:'Analista encerrou sessão' }).catch(()=>{});
  await sb.auth.signOut();
  window.location.replace('/login.html');
};

// ── CARREGAR DADOS DO BANCO ─────────────────────────────────────────────
async function carregarState() {
  const [resMots, resOris, resTents] = await Promise.all([
    sb.from('motoristas').select('*').order('indice_wf', { ascending: false }),
    sb.from('orientacoes').select('*').eq('tipo_registro', 'orientacao').order('data_contato', { ascending: false }),
    sb.from('orientacoes').select('*').eq('tipo_registro', 'tentativa').order('data_contato', { ascending: false })
  ]);

  // Converter para o formato interno do sistema (compatível com o código existente)
  mots = (resMots.data || []).map(m => ({
    id:       m.id,
    _dbId:    m.id,           // manter UUID original
    mes:      m.mes_ano,
    cliente:  m.cliente,
    nome:     m.nome,
    cpf:      m.cpf,
    contato:  m.contato,
    tipo:     m.tipo,
    viagens:  m.viagens,
    wf:       m.wf,
    wfMes:    m.wf_mes,
    indice:   m.indice_wf,
    status:   m.status
  }));

  oris = {};
  (resOris.data || []).forEach(o => {
    const motId = o.motorista_id;
    if (!motId) return;
    if (!oris[motId]) oris[motId] = [];
    oris[motId].push({
      _dbId:     o.id,
      mes:       mesAnoStr(o.data_contato) || '',
      motivo:    o.motivo,
      data:      o.data_contato,
      hora:      o.hora_contato || '',
      nota:      o.nota,
      descricao: o.descricao,
      analista:  perfil.nome,
      tsKey:     o.id          // usar UUID do banco como chave
    });
  });

  tents = {};
  (resTents.data || []).forEach(t => {
    const motId = t.motorista_id;
    if (!motId) return;
    if (!tents[motId]) tents[motId] = [];
    tents[motId].push({
      uid:       t.id,
      _dbId:     t.id,
      mes:       mesAnoStr(t.data_contato) || '',
      motivo:    t.motivo,
      data:      t.data_contato,
      hora:      t.hora_contato || '',
      descricao: t.descricao,
      lembDt:    t.lembrete_dt  || '',
      lembHr:    t.lembrete_hr  || '',
      analista:  perfil.nome
    });
  });

  document.getElementById('h-sync').textContent = '🗄️ ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

// ── SALVAR ORIENTAÇÃO / TENTATIVA ──────────────────────────────────────
// Substitui a função salvarOri() — chama o banco em vez de localStorage
async function salvarOriDB(m, mot, dt, hr, nota, desc, lembDt, lembHr) {
  const tipo = isTent(mot) ? 'tentativa' : 'orientacao';

  const { data: registro, error } = await sb.from('orientacoes').insert({
    user_id:        analAtualId,
    motorista_id:   m._dbId || m.id,
    motorista_nome: m.nome,
    motorista_cpf:  m.cpf  || '',
    cliente:        m.cliente || '',
    motivo:         mot,
    nota:           tipo === 'orientacao' ? nota : null,
    descricao:      desc || '',
    data_contato:   dt,
    hora_contato:   hr   || null,
    lembrete_dt:    lembDt || null,
    lembrete_hr:    lembHr || null,
    tipo_registro:  tipo
  }).select().single();

  if (error) throw error;

  // Atualizar status do motorista
  await sb.from('motoristas')
    .update({ status: tipo === 'orientacao' ? 'orientado' : 'tentativa' })
    .eq('id', m._dbId || m.id);

  return registro;
}

// Substituir função salvarOri original:
window.salvarOri = async function() {
  const mot    = document.getElementById('f-mot').value;
  const dt     = document.getElementById('f-dt').value;
  const hr     = document.getElementById('f-hr').value;
  const desc   = document.getElementById('f-desc').value.trim();
  const lembDt = document.getElementById('f-lemb-dt').value;
  const lembHr = document.getElementById('f-lemb-hr').value;

  if (!mot)      { alert('⚠ Selecione o motivo.'); return; }
  if (!dt)       { alert('⚠ Informe a data.'); return; }
  if (!isTent(mot) && !notaSel) { alert('⚠ Selecione uma nota: A, B ou C.'); return; }

  const m   = motAtual;
  const mes = mesAnoStr(dt) || m.mes || 'Atual';

  try {
    const reg = await salvarOriDB(m, mot, dt, hr, notaSel, desc, lembDt, lembHr);

    if (isTent(mot)) {
      if (!tents[m.id]) tents[m.id] = [];
      tents[m.id].push({
        uid: reg.id, _dbId: reg.id, mes, motivo: mot,
        data: dt, hora: hr, descricao: desc, lembDt, lembHr, analista: analAtual
      });
      if (mot === 'Ligar depois' && lembDt) agendarLembrete(m, lembDt, lembHr);
      else showToast('📵 Tentativa registrada — ' + m.nome.split(' ')[0]);
    } else {
      if (!oris[m.id]) oris[m.id] = [];
      oris[m.id].push({
        _dbId: reg.id, mes, motivo: mot, data: dt, hora: hr,
        nota: notaSel, descricao: desc, analista: analAtual, tsKey: reg.id
      });
      showToast('✓ Orientação de ' + m.nome.split(' ')[0] + ' salva!');
    }

    closeModal();
    filtrarMot();
    updDash();

  } catch (e) {
    alert('❌ Erro ao salvar: ' + e.message);
  }
};

// ── EXCLUIR ORIENTAÇÃO ──────────────────────────────────────────────────
async function excluirOriId(motId, tsKey) {
  // tsKey agora é o UUID do banco
  const { error } = await sb.from('orientacoes').delete().eq('id', tsKey);
  if (error) throw error;

  const arr = oris[motId];
  if (arr) {
    const idx = arr.findIndex(o => o.tsKey === tsKey || o._dbId === tsKey);
    if (idx !== -1) { arr.splice(idx, 1); if (!arr.length) delete oris[motId]; }
  }
}

window.retornarOriId = async function(motId, tsKey) {
  try {
    await excluirOriId(motId, tsKey);
    // Verificar se tem outros registros
    const restantes = (oris[motId]||[]).length + (tents[motId]||[]).length;
    if (!restantes) {
      await sb.from('motoristas').update({ status: 'pendente' }).eq('id', motId);
    }
    filtrarMot(); renderOriClientes(); filtrarTodos();
    showToast('↩ Motorista devolvido à lista de orientar');
  } catch(e) { showToast('❌ Erro: ' + e.message); }
};

window.apagarOriId = async function(motId, tsKey) {
  try {
    await excluirOriId(motId, tsKey);
    filtrarTodos();
    showToast('🗑 Orientação removida');
  } catch(e) { showToast('❌ Erro: ' + e.message); }
};

// ── EXCLUIR MOTORISTA ───────────────────────────────────────────────────
window.excluirMotorista = async function(motId) {
  try {
    // Excluir todas as orientações/tentativas primeiro
    await sb.from('orientacoes').delete().eq('motorista_id', motId);
    await sb.from('motoristas').delete().eq('id', motId);
    mots = mots.filter(m => m.id !== motId);
    delete oris[motId]; delete tents[motId];
    filtrarMot(); renderOriClientes(); updDash();
    showToast('🗑 Motorista removido');
  } catch(e) { showToast('❌ Erro: ' + e.message); }
};

// ── LIMPAR TUDO ─────────────────────────────────────────────────────────
window.limparTudo = async function() {
  try {
    // Excluir motoristas e orientações do usuário atual
    await sb.from('motoristas').delete().eq('user_id', analAtualId);
    mots=[]; oris={}; tents={};
    oriCliSel=null; regCliSel=null; tentCliSel=null; histCliSel=null; todosCache=[];
    document.getElementById('cbox').classList.remove('open');
    updDash(); renderOriClientes(); filtrarMot();
    showToast('✓ Dados removidos');
  } catch(e) { showToast('❌ Erro: ' + e.message); }
};

// ── IMPORTAR PLANILHA MENSAL (substituir procMensal) ────────────────────
window._procMensalSupabase = async function(linhas, fname) {
  let adicionados = 0;

  const inserir = linhas.filter(l => l.nome).map(l => ({
    user_id:   analAtualId,
    mes_ano:   l.mes    || '',
    cliente:   l.cliente || '',
    nome:      l.nome.trim(),
    cpf:       l.cpf    || '',
    contato:   l.contato || '',
    tipo:      l.tipo   || '',
    viagens:   parseFloat(l.viagens) || 0,
    wf:        parseFloat(l.wf)      || 0,
    wf_mes:    parseFloat(l.wfMes)   || 0,
    indice_wf: parseFloat(l.indice)  || 0,
    status:    'pendente'
  }));

  for (let i = 0; i < inserir.length; i += 200) {
    const lote = inserir.slice(i, i + 200);
    const { error } = await sb.from('motoristas').insert(lote);
    if (!error) adicionados += lote.length;
  }

  // Recarregar estado
  await carregarState();
  atualizarTodosFiltrosMes();
  setSt(`✓ ${adicionados} motoristas importados — ${fname}`);
  renderOriClientes(); filtrarMot(); updDash();
  showToast(`✓ Importado! ${adicionados} motoristas.`);
};

// ── EDITAR CAMPO DO MOTORISTA ───────────────────────────────────────────
window.editCampo = async function(inp) {
  if (!motAtual) return;
  const campo = inp.dataset.campo;
  const valor = inp.value.trim();
  if (!campo || !valor) return;
  motAtual[campo] = valor;

  // Mapear campo interno → coluna do banco
  const mapa = { cpf: 'cpf', contato: 'contato', tipo: 'tipo' };
  const colBanco = mapa[campo];
  if (colBanco) {
    await sb.from('motoristas').update({ [colBanco]: valor }).eq('id', motAtual._dbId || motAtual.id);
  }
  filtrarMot();
  showToast('✓ ' + campo + ' atualizado!');
};

// ── SALVAR EDIÇÃO DE TENTATIVA ──────────────────────────────────────────
window.salvarEdicaoTent = async function() {
  const mot    = document.getElementById('te-mot').value;
  const dt     = document.getElementById('te-dt').value;
  const hr     = document.getElementById('te-hr').value;
  const desc   = document.getElementById('te-desc').value.trim();
  const lembDt = document.getElementById('te-lemb-dt').value;
  const lembHr = document.getElementById('te-lemb-hr').value;

  if (!editTentId || !editTentUid) return;

  const arr = tents[editTentId] || [];
  const idx = arr.findIndex(x => x.uid === editTentUid || x._dbId === editTentUid);
  if (idx === -1) return;
  const t = arr[idx];
  const mes = mesAnoStr(dt) || t.mes || 'Atual';

  try {
    if (!isTent(mot)) {
      // Converter tentativa em orientação
      if (!notaTeSel) { alert('⚠ Selecione uma nota para converter.'); return; }

      // Atualizar no banco: mudar tipo_registro e adicionar nota
      await sb.from('orientacoes').update({
        tipo_registro: 'orientacao', motivo: mot, nota: notaTeSel,
        data_contato: dt, hora_contato: hr || null, descricao: desc
      }).eq('id', t._dbId || t.uid);

      // Atualizar estado local
      if (!oris[editTentId]) oris[editTentId] = [];
      oris[editTentId].push({ _dbId: t._dbId, mes, motivo: mot, data: dt, hora: hr, nota: notaTeSel, descricao: desc, analista: analAtual, tsKey: t._dbId });
      arr.splice(idx, 1); tents[editTentId] = arr;

      // Atualizar status do motorista
      await sb.from('motoristas').update({ status: 'orientado' }).eq('id', editTentId);
      showToast('✓ Convertido para orientação efetiva!');

    } else {
      // Atualizar tentativa
      await sb.from('orientacoes').update({
        motivo: mot, data_contato: dt, hora_contato: hr || null,
        descricao: desc, lembrete_dt: lembDt || null, lembrete_hr: lembHr || null
      }).eq('id', t._dbId || t.uid);

      arr[idx] = { ...arr[idx], motivo: mot, data: dt, hora: hr, descricao: desc, lembDt, lembHr, mes };
      tents[editTentId] = arr;
      if (mot === 'Ligar depois' && lembDt) agendarLembrete(mots.find(x=>x.id===editTentId), lembDt, lembHr);
      else showToast('✓ Tentativa atualizada!');
    }

    closeTentModal(); filtrarTent(); renderTentClientes(); updDash(); filtrarMot();

  } catch(e) { alert('❌ Erro: ' + e.message); }
};

// ── EXPORTAR CSV (usa dados do banco) ──────────────────────────────────
window.exportarCSV = async function() {
  const fm = document.getElementById('reg-mes')?.value || '';
  let query = sb.from('orientacoes').select('*, motoristas(nome,cpf,cliente,tipo,contato,indice_wf)')
    .eq('tipo_registro','orientacao').order('data_contato',{ascending:false});
  if (fm) {
    // Converter "Mai/2025" para range de datas
    const mns={Jan:'01',Fev:'02',Mar:'03',Abr:'04',Mai:'05',Jun:'06',Jul:'07',Ago:'08',Set:'09',Out:'10',Nov:'11',Dez:'12'};
    const [mn,yyyy] = fm.split('/');
    const mm = mns[mn] || '01';
    query = query.gte('data_contato',`${yyyy}-${mm}-01`).lte('data_contato',`${yyyy}-${mm}-31`);
  }
  const { data } = await query;
  if (!data?.length) { showToast('⚠ Nenhum registro.'); return; }

  const cols = ['Analista','Cliente','Motorista','Tipo','CPF','Contato','Motivo','Data','Hora','Nota','Descrição'];
  const rows = data.map(r => [
    perfil.nome,
    r.cliente || r.motoristas?.cliente || '',
    r.motorista_nome,
    r.motoristas?.tipo || '',
    r.motorista_cpf || r.motoristas?.cpf || '',
    r.motoristas?.contato || '',
    r.motivo || '',
    fmtData(r.data_contato),
    r.hora_contato || '',
    r.nota || '',
    r.descricao || ''
  ]);
  const csv = [cols,...rows].map(r=>r.map(v=>'"'+(v||'').toString().replace(/"/g,'""')+'"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  a.download = 'PAZ5_orientacoes.csv'; a.click(); URL.revokeObjectURL(a.href);
  showToast('📥 CSV Exportado!');
};

// ── SINCRONIZAÇÃO (substitui pollSync) ──────────────────────────────────
// Supabase Realtime — atualiza automaticamente quando outro analista altera dados
// (opcional, só funciona se o projeto tiver Realtime habilitado)
let realtimeChannel = null;

function iniciarRealtime() {
  realtimeChannel = sb.channel('orientacoes-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'orientacoes',
      filter: `user_id=eq.${analAtualId}`
    }, async () => {
      await carregarState();
      atualizarTodosFiltrosMes();
      updDash();
      document.getElementById('h-sync').textContent = '🔄 ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    })
    .subscribe();
}

// ── TROCA DE SENHA ──────────────────────────────────────────────────────
// Adicione este modal no HTML ou reutilize o modal existente:
window.trocarSenha = async function(novaSenha, confirmSenha) {
  if (novaSenha !== confirmSenha) { showToast('⚠ As senhas não coincidem'); return; }
  if (novaSenha.length < 8) { showToast('⚠ Mín. 8 caracteres'); return; }
  try {
    const { error } = await sb.auth.updateUser({ password: novaSenha });
    if (error) throw error;
    await sb.from('logs').insert({ acao:'CHANGE_PASSWORD', descricao:'Analista alterou a própria senha' });
    showToast('✓ Senha alterada com sucesso!');
  } catch(e) { showToast('❌ ' + e.message); }
};

// ── INICIALIZAÇÃO ────────────────────────────────────────────────────────
(async () => {
  await carregarState();
  atualizarTodosFiltrosMes();
  updDash();
  renderOriClientes();
  filtrarMot();
  verificarLembretes();
  atualizarSino();
  iniciarRealtime();

  // Atualizar último login
  await sb.rpc('update_last_login', { uid: analAtualId }).catch(() => {});
})();

// ── IMPORTANTE: manter todas as outras funções originais do index.html ──
// As funções abaixo NÃO precisam ser alteradas:
// - filtrarMot(), renderTabelaOri(), abrirModal(), closeModal()
// - selNota(), onMotivoChange()
// - updDash(), rendHist(), rendTodos(), filtrarTodos()
// - filtrarTent(), renderTentClientes(), renderContadoresTent()
// - sortBy(), sortAud(), rendAuditoria()
// - renderOriClientes(), renderRegClientes(), renderHistClientes()
// - exportarExcelSharePoint() ← mantém funcionamento atual
// - fmtData(), fmtHora(), normDt(), normHr(), mesAnoStr(), parseMes()
// - getMeses(), atualizarTodosFiltrosMes(), col(), colNum()
// - ini(), esc(), uid(), showToast(), setSt(), gerarId()
// - confirmar(), confirmarLimparPlanilha()
// - abrirEditarTent(), closeTentModal(), selNotaTe(), onTeMotivoChange()
// - agendarLembrete(), verificarLembretes(), atualizarSino()
// - toggleNotifPanel(), limparLembretes(), mostrarPopTemp()
// - populaFiltroColab() e rendAuditoria() (para admin)
// - hDrop(), hFile(), procFile() ← procMensal e impOrient precisam adaptar
// - carregarDemo()

// OBS: procMensal() e impOrient() precisam chamar _procMensalSupabase()
// ao invés de salvarState(). Ver comentários no db.js para orientação.

/*
</script>
*/
