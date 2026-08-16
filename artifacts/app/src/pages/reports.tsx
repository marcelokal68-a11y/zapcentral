import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatISO, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Download, 
  Printer, 
  Search,
  Filter,
  Loader2,
  Clock,
  CheckCircle2,
  TrendingUp,
  FileSpreadsheet,
  MessageCircle
} from "lucide-react";
import { Sidebar } from "@/pages/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenantId } from "@/hooks/useTenantId";
import {
  getReportDepartments,
  getReportConversations,
  getReportAgents,
  getReportFunnel,
  listAgentStatuses,
  listTags,
  reportConversationsCsvUrl
} from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList
} from "recharts";

export default function ReportsPage() {
  const tenantId = useTenantId();

  // Filters state
  const [period, setPeriod] = useState("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [departmentId, setDepartmentId] = useState<number | "all">("all");
  const [agentId, setAgentId] = useState<string | "all">("all");
  const [tagId, setTagId] = useState<number | "all">("all");

  const filters = useMemo(() => {
    let from, to;
    const today = startOfDay(new Date());

    if (period === "today") from = formatISO(today);
    else if (period === "7d") from = formatISO(subDays(today, 7));
    else if (period === "30d") from = formatISO(subDays(today, 30));
    else if (period === "90d") from = formatISO(subDays(today, 90));
    else if (period === "custom") {
      if (customFrom) from = formatISO(startOfDay(new Date(customFrom)));
      if (customTo) {
        const toDate = startOfDay(new Date(customTo));
        toDate.setDate(toDate.getDate() + 1); // include the whole day
        to = formatISO(toDate);
      }
    }

    return {
      from,
      to,
      departmentId: departmentId !== "all" ? departmentId : undefined,
      agentId: agentId !== "all" ? agentId : undefined,
      tagId: tagId !== "all" ? tagId : undefined,
    };
  }, [period, customFrom, customTo, departmentId, agentId, tagId]);

  // Reference data for filters
  const { data: agents } = useQuery({
    queryKey: ["agents", "status", tenantId],
    queryFn: () => listAgentStatuses(tenantId!),
    enabled: !!tenantId,
  });

  const { data: tags } = useQuery({
    queryKey: ["tags", tenantId],
    queryFn: () => listTags(tenantId!),
    enabled: !!tenantId,
  });

  // Main Report Queries
  const { data: departmentsReport, isLoading: loadingDepts, isError: errorDepts } = useQuery({
    queryKey: ["reports", "departments", tenantId, filters],
    queryFn: () => getReportDepartments(tenantId!, filters),
    enabled: !!tenantId,
  });

  const { data: conversationsReport, isLoading: loadingConvs, isError: errorConvs } = useQuery({
    queryKey: ["reports", "conversations", tenantId, filters],
    queryFn: () => getReportConversations(tenantId!, { ...filters, limit: 100 }), // limit for UI
    enabled: !!tenantId,
  });

  const { data: agentsReport, isLoading: loadingAgents, isError: errorAgents } = useQuery({
    queryKey: ["reports", "agents", tenantId, filters],
    queryFn: () => getReportAgents(tenantId!, filters),
    enabled: !!tenantId,
  });

  const { data: funnelReport, isLoading: loadingFunnel, isError: errorFunnel } = useQuery({
    queryKey: ["reports", "funnel", tenantId, filters],
    queryFn: () => getReportFunnel(tenantId!, filters),
    enabled: !!tenantId,
  });

  const formatDuration = (secs: number | null) => {
    if (secs === null) return "-";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
    return `${s}s`;
  };

  const formatCurrency = (val: string | number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(val));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { 
      day: "2-digit", month: "2-digit", year: "numeric", 
      hour: "2-digit", minute: "2-digit" 
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8]">
      <Sidebar />

      <div className="ml-64 flex flex-col print:ml-0">
        <header className="h-16 bg-white shadow-sm flex items-center justify-between px-8 z-0 print:hidden">
          <h1 className="text-xl font-semibold text-gray-800">Relatórios</h1>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors text-sm font-medium"
          >
            <Printer className="w-4 h-4" />
            Exportar PDF
          </button>
        </header>

        <main className="flex-1 p-8">
          {/* Filters Bar */}
          <Card className="mb-8 print:hidden">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 w-full">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">Período</label>
                    <select
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                      className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
                    >
                      <option value="today">Hoje</option>
                      <option value="7d">Últimos 7 dias</option>
                      <option value="30d">Últimos 30 dias</option>
                      <option value="90d">Últimos 90 dias</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </div>

                  {period === "custom" && (
                    <div className="space-y-1.5 md:col-span-2 flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600">De</label>
                        <input
                          type="date"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:border-green-500 outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-600">Até</label>
                        <input
                          type="date"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                          className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:border-green-500 outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">Departamento</label>
                    <select
                      value={departmentId}
                      onChange={(e) => setDepartmentId(e.target.value === "all" ? "all" : Number(e.target.value))}
                      className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:border-green-500 outline-none"
                    >
                      <option value="all">Todos os departamentos</option>
                      {departmentsReport?.map(d => (
                        <option key={d.departmentId} value={d.departmentId}>{d.departmentName}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">Agente</label>
                    <select
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:border-green-500 outline-none"
                    >
                      <option value="all">Todos os agentes</option>
                      {agents?.map(a => (
                        <option key={a.clerkUserId} value={a.clerkUserId}>
                          {a.firstName ? `${a.firstName} ${a.lastName || ''}` : a.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">Tag (CRM)</label>
                    <select
                      value={tagId}
                      onChange={(e) => setTagId(e.target.value === "all" ? "all" : Number(e.target.value))}
                      className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:border-green-500 outline-none"
                    >
                      <option value="all">Todas as tags</option>
                      {tags?.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="atendimento" className="w-full">
            <TabsList className="mb-6 bg-white border border-gray-200 p-1 print:hidden">
              <TabsTrigger value="atendimento" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">
                Atendimento
              </TabsTrigger>
              <TabsTrigger value="agentes" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">
                Agentes
              </TabsTrigger>
              <TabsTrigger value="funil" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">
                Funil de Vendas
              </TabsTrigger>
            </TabsList>

            {/* TAB: ATENDIMENTO */}
            <TabsContent value="atendimento" className="space-y-6 m-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-gray-800">Desempenho por Departamento</CardTitle>
                </CardHeader>
                <CardContent>
                  {errorDepts ? (<p className="text-center text-red-500 py-8 text-sm">Erro ao carregar o relatório. Tente novamente.</p>) :  loadingDepts ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                  ) : !departmentsReport?.length ? (
                    <p className="text-center text-gray-500 py-8 text-sm">Sem dados no período.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-3">Departamento</th>
                            <th className="px-4 py-3 text-right">Total</th>
                            <th className="px-4 py-3 text-right">Resolvidos</th>
                            <th className="px-4 py-3 text-right">Taxa Resolução</th>
                            <th className="px-4 py-3 text-right">T.M. 1ª Resposta</th>
                            <th className="px-4 py-3 text-right">T.M. Resolução</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {departmentsReport.map(dept => (
                            <tr key={dept.departmentId} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 font-medium text-gray-900">
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dept.departmentColor || "#ccc" }} />
                                  {dept.departmentName}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">{dept.total}</td>
                              <td className="px-4 py-3 text-right">{dept.closed}</td>
                              <td className="px-4 py-3 text-right">
                                {dept.resolutionRate !== null ? `${dept.resolutionRate}%` : "-"}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-600">{formatDuration(dept.avgFirstResponseSecs)}</td>
                              <td className="px-4 py-3 text-right text-gray-600">{formatDuration(dept.avgResolutionSecs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base text-gray-800">Últimas Conversas no Período</CardTitle>
                  <a 
                    href={tenantId ? reportConversationsCsvUrl(tenantId, filters) : "#"} 
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-md transition-colors print:hidden"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Exportar CSV
                  </a>
                </CardHeader>
                <CardContent>
                  {errorConvs ? (<p className="text-center text-red-500 py-8 text-sm">Erro ao carregar o relatório. Tente novamente.</p>) :  loadingConvs ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                  ) : !conversationsReport?.length ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                      <Search className="w-8 h-8 mb-2 text-gray-300" />
                      <p className="text-sm">Sem conversas no período selecionado.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-3">Contato</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Departamento</th>
                            <th className="px-4 py-3">Agente</th>
                            <th className="px-4 py-3">Início</th>
                            <th className="px-4 py-3 text-right">1ª Resposta</th>
                            <th className="px-4 py-3 text-right">Resolução</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {conversationsReport.map(conv => (
                            <tr key={conv.id} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-900">{conv.contactName || conv.contactPhone}</div>
                                {conv.contactName && <div className="text-xs text-gray-500">{conv.contactPhone}</div>}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="secondary" className="font-normal text-[10px] bg-gray-100 text-gray-700">
                                  {conv.status.toUpperCase()}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-gray-600">{conv.departmentName || "-"}</td>
                              <td className="px-4 py-3 text-gray-600">
                                {conv.assignedTo ? (agents?.find(a => a.clerkUserId === conv.assignedTo)?.firstName || "Atribuído") : "-"}
                              </td>
                              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(conv.createdAt)}</td>
                              <td className="px-4 py-3 text-right text-gray-600">{formatDuration(conv.firstResponseSecs)}</td>
                              <td className="px-4 py-3 text-right text-gray-600">{formatDuration(conv.resolutionSecs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: AGENTES */}
            <TabsContent value="agentes" className="m-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-gray-800">Ranking de Produtividade</CardTitle>
                </CardHeader>
                <CardContent>
                  {errorAgents ? (<p className="text-center text-red-500 py-8 text-sm">Erro ao carregar o relatório. Tente novamente.</p>) :  loadingAgents ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                  ) : !agentsReport?.length ? (
                    <p className="text-center text-gray-500 py-8 text-sm">Nenhum dado de agente no período.</p>
                  ) : (
                    <div className="space-y-4">
                      {agentsReport
                        .sort((a, b) => b.closed - a.closed) // rank by closed
                        .map((row, idx) => {
                          const agentInfo = agents?.find(a => a.clerkUserId === row.agentId);
                          const name = agentInfo?.firstName ? `${agentInfo.firstName} ${agentInfo.lastName || ''}` : "Agente Desconhecido";
                          const initials = agentInfo?.firstName ? agentInfo.firstName.substring(0, 2).toUpperCase() : "?";
                          
                          return (
                            <div key={row.agentId} className="flex items-center p-4 border border-gray-100 rounded-lg bg-white shadow-sm hover:border-gray-200 transition-colors">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-50 text-gray-400 font-bold text-sm mr-4">
                                {idx + 1}º
                              </div>
                              <Avatar className="h-10 w-10 mr-4 border border-gray-100">
                                <AvatarImage src={agentInfo?.avatarUrl || undefined} />
                                <AvatarFallback className="bg-green-50 text-green-700 text-xs font-medium">{initials}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <h4 className="font-semibold text-gray-900">{name}</h4>
                                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                  <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {row.handled} atendidas</span>
                                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> {row.closed} resolvidas</span>
                                </div>
                              </div>
                              <div className="text-right flex gap-6">
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">T.M. 1ª Resposta</p>
                                  <p className="font-medium text-gray-900">{formatDuration(row.avgFirstResponseSecs)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">T.M. Resolução</p>
                                  <p className="font-medium text-gray-900">{formatDuration(row.avgResolutionSecs)}</p>
                                </div>
                              </div>
                            </div>
                          );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: FUNIL */}
            <TabsContent value="funil" className="m-0 space-y-6">
              <p className="text-xs text-gray-500 -mb-2 print:hidden">
                O funil mostra os negócios abertos atuais (snapshot); apenas Ganhos e Perdidos
                consideram o período selecionado. Filtros de setor, agente e tag não se aplicam
                a esta aba.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base text-gray-800">Resumo de Vendas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {errorFunnel ? (<p className="text-center text-red-500 py-8 text-sm">Erro ao carregar o relatório. Tente novamente.</p>) :  loadingFunnel ? (
                      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                    ) : !funnelReport ? (
                      <p className="text-center text-gray-500 py-8 text-sm">Sem dados de CRM.</p>
                    ) : (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                            <p className="text-sm font-medium text-green-800 mb-1">Ganhos (Won)</p>
                            <h3 className="text-2xl font-bold text-green-900 mb-1">{formatCurrency(funnelReport.won.value)}</h3>
                            <p className="text-xs text-green-700">{funnelReport.won.count} negócios</p>
                          </div>
                          <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                            <p className="text-sm font-medium text-red-800 mb-1">Perdidos (Lost)</p>
                            <h3 className="text-2xl font-bold text-red-900 mb-1">{formatCurrency(funnelReport.lost.value)}</h3>
                            <p className="text-xs text-red-700">{funnelReport.lost.count} negócios</p>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-gray-800 mb-3">Valor em Aberto por Etapa</h4>
                          <div className="space-y-3">
                            {funnelReport.stages.map(stage => (
                              <div key={stage.stageId} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                                  <span className="text-sm text-gray-700">{stage.name}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm font-medium text-gray-900">{formatCurrency(stage.openValue)}</span>
                                  <span className="text-xs text-gray-500 ml-2">({stage.openCount})</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base text-gray-800">Visualização de Funil (Em Aberto)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[350px] w-full">
                      {errorFunnel ? (<p className="text-center text-red-500 py-8 text-sm">Erro ao carregar o relatório. Tente novamente.</p>) :  loadingFunnel ? (
                        <div className="flex h-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
                      ) : !funnelReport || funnelReport.stages.length === 0 ? (
                         <div className="flex h-full items-center justify-center text-sm text-gray-500">Sem negócios abertos.</div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <FunnelChart>
                            <Tooltip 
                              formatter={(value: number) => [formatCurrency(value), "Valor"]}
                              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            />
                            <Funnel
                              dataKey="openValue"
                              data={funnelReport.stages.map(s => ({
                                name: s.name,
                                openValue: Number(s.openValue),
                                fill: s.color || "#25D366"
                              }))}
                              isAnimationActive
                            >
                              <LabelList position="right" fill="#4B5563" stroke="none" dataKey="name" />
                            </Funnel>
                          </FunnelChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}