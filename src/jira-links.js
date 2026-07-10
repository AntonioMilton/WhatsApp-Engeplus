// Mapa de categorias -> tipo de solicitação no portal do Jira Service Management (projeto SUP).
// Portal id = 1. Formato do link de criação: {BASE}/create/{requestTypeId}
// Coletado do portal real "Central de Suporte de TI" em 10/07/2026.

const BASE = process.env.JIRA_PORTAL_BASE
  || "https://ti-petkov.atlassian.net/servicedesk/customer/portal/1";

// requestTypeId de cada tipo de solicitação do portal
export const REQUEST_TYPES = {
  suporte_ti:        { id: 1, label: "Solicitar Suporte de TI" },
  acesso_privilegiado:{ id: 2, label: "Solicitar Acesso Privilegiado" },
  acesso_sistema:    { id: 3, label: "Solicitar Acesso ao Sistema" },
  software_licenca:  { id: 4, label: "Solicitar Software ou Licença" },
  incidente:         { id: 6, label: "Reportar Incidente" },
  falha_hardware:    { id: 7, label: "Reportar Falha em Hardware" },
  onboarding:        { id: 8, label: "Integração de Novo Colaborador" },
  equipamento:       { id: 9, label: "Solicitar Equipamento" },
};

// Categorias que a IA pode retornar -> chave do tipo de solicitação.
// Se a IA devolver algo fora da lista, cai no fallback "suporte_ti".
export const CATEGORY_TO_TYPE = {
  acesso_senha:        "acesso_sistema",       // login, senha expirada, bloqueio de conta
  acesso_privilegiado: "acesso_privilegiado",  // acesso admin/privilegiado
  hardware:            "falha_hardware",       // equipamento com defeito
  equipamento:         "equipamento",          // pedir novo equipamento
  software:            "software_licenca",     // instalar software / licença
  email:               "acesso_sistema",       // problemas de e-mail (acesso a sistema)
  rede_internet:       "incidente",            // rede fora / lentidão -> incidente
  incidente:           "incidente",            // parada / urgência
  onboarding:          "onboarding",           // novo colaborador
  outros:              "suporte_ti",           // genérico
};

export function linkFor(categoria) {
  const typeKey = CATEGORY_TO_TYPE[categoria] || "suporte_ti";
  const rt = REQUEST_TYPES[typeKey];
  return {
    label: rt.label,
    url: `${BASE}/create/${rt.id}`,
  };
}

export const PORTAL_HOME = BASE;
