import { useQuery } from "@tanstack/react-query";
import { UserButton } from "@clerk/react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  MessageCircle,
  Users,
  BarChart3,
  Settings,
  Clock,
  CheckCircle2,
  Smartphone,
  PhoneCall,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTenantId } from "@/hooks/useTenantId";
import {
  getReportOverview,
  getReportVolume,
  listConversations,
  listAgentStatuses,
} from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const navItems = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Atendimento", path: "/atendimento", icon: MessageCircle },
  { name: "WhatsApp", path: "/whatsapp", icon: Smartphone },
  { name: "CRM", path: "/crm", icon: Users },
  { name: "Relatórios", path: "/relatorios", icon: BarChart3 },
  { name: "Configurações", path: "/settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="fixed inset-y-0 left-0 w-64 bg-[#0F1923] flex flex-col z-10 sidebar-transition print:hidden">
      <div className="h-16 flex items-center px-6 border-b border-white/5">
        <MessageCircle className="w-6 h-6 text-[#25D366] mr-2" />
        <span className="text-white font-semibold text-lg tracking-wide">
          ZapCentral
        </span>
      </div>

      <div className="flex-1 py-6 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.path || location.startsWith(item.path + "/");
          const isExact = location === item.path;
          const active = isActive && (item.path !== "/" || isExact);
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`flex items-center px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                  active
                    ? "bg-[#25D366]/10 text-[#25D366] border-r-2 border-[#25D366]"
                    : "text-[#8899A6] hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-5 h-5 mr-3" />
                <span className="font-medium text-sm">{item.name}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-white/5 flex items-center gap-3">
        <UserButton />
        <span className="text-sm text-[#8899A6] font-medium">Minha Conta</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const tenantId = useTenantId();

  const { data: overview, isLoading: loadingOverview, error: overviewErr } = useQuery({
    queryKey: ["reports", "overview", tenantId],
    queryFn: () => getReportOverview(tenantId!),
    enabled: !!tenantId,
    refetchInterval: 10000,
    retry: (count, err) =>
      (err as { status?: number }).status !== 403 && count < 2,
  });
  // Regular agents don't have access to analytics (admin/supervisor only)
  const noReportAccess = (overviewErr as { status?: number } | null)?.status === 403;

  const { data: volume, isError: volumeError } = useQuery({
    queryKey: ["reports", "volume", tenantId, "hour", "today"],
    queryFn: () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return getReportVolume(tenantId!, {
        granularity: "hour",
        from: startOfDay.toISOString(),
        to: new Date().toISOString(),
      });
    },
    enabled: !!tenantId,
    refetchInterval: 30000,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents", "status", tenantId],
    queryFn: () => listAgentStatuses(tenantId!),
    enabled: !!tenantId,
    refetchInterval: 10000,
  });

  const { data: waitingRes } = useQuery({
    queryKey: ["conversations", "waiting", tenantId],
    queryFn: () => listConversations(tenantId!, { status: "waiting", limit: 20 }),
    enabled: !!tenantId,
    refetchInterval: 10000,
  });

  const onlineAgents =
    agents?.filter((a) => a.status !== "offline").length ?? 0;

  const waitingConversations = [...(waitingRes?.conversations || [])]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5);

  const formatBucketTime = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8]">
      <Sidebar />

      <div className="ml-64 flex flex-col print:ml-0">
        <header className="h-16 bg-white shadow-sm flex items-center justify-between px-8 z-0 print:hidden">
          <h1 className="text-xl font-semibold text-gray-800">
            Painel Principal
          </h1>
          <Badge variant="outline" className="text-xs font-medium bg-gray-50">
            Tenant: {tenantId || "..."}
          </Badge>
        </header>

        <main className="flex-1 p-8">
          {noReportAccess && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              As métricas do painel estão disponíveis apenas para administradores e
              supervisores. Acesse o Atendimento para ver suas conversas.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <Card>
              <CardContent className="p-6 flex items-center">
                <div className="p-3 rounded-full bg-green-100 text-green-600 mr-4">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Ativas
                  </p>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {loadingOverview ? <Loader2 className="w-5 h-5 animate-spin mt-1" /> : overview?.live.active ?? 0}
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex items-center">
                <div className="p-3 rounded-full bg-amber-100 text-amber-600 mr-4">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Aguardando
                  </p>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {loadingOverview ? <Loader2 className="w-5 h-5 animate-spin mt-1" /> : overview?.live.waiting ?? 0}
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex items-center">
                <div className="p-3 rounded-full bg-blue-100 text-blue-600 mr-4">
                  <PhoneCall className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    No Robô (IVR)
                  </p>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {loadingOverview ? <Loader2 className="w-5 h-5 animate-spin mt-1" /> : overview?.live.inIvr ?? 0}
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex items-center">
                <div className="p-3 rounded-full bg-indigo-100 text-indigo-600 mr-4">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Agentes Online
                  </p>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {agents ? onlineAgents : <Loader2 className="w-5 h-5 animate-spin mt-1" />}
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex items-center">
                <div className="p-3 rounded-full bg-purple-100 text-purple-600 mr-4">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Resolvidos Hoje
                  </p>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {loadingOverview ? <Loader2 className="w-5 h-5 animate-spin mt-1" /> : overview?.live.closedToday ?? 0}
                  </h3>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base text-gray-800">Volume de Conversas (Hoje)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  {volumeError ? (
                    <div className="w-full h-full flex items-center justify-center text-red-500 text-sm">
                      Erro ao carregar o gráfico. Tentando novamente...
                    </div>
                  ) : !volume ? (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Loader2 className="w-8 h-8 animate-spin" />
                    </div>
                  ) : volume.length === 0 ? (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                      Sem dados para o período.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={volume} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#25D366" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorClosed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis 
                          dataKey="bucket" 
                          tickFormatter={formatBucketTime} 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#6B7280' }} 
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#6B7280' }} 
                        />
                        <Tooltip 
                          labelFormatter={(label) => formatBucketTime(label as string)}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="total" 
                          name="Total" 
                          stroke="#25D366" 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorTotal)" 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="closed" 
                          name="Resolvidas" 
                          stroke="#6366F1" 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorClosed)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-gray-800">Maior Tempo de Espera</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto">
                {!waitingRes ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : waitingConversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 py-8">
                    <CheckCircle2 className="w-10 h-10 text-green-400 mb-2" />
                    <p className="text-sm font-medium">Nenhuma conversa aguardando.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {waitingConversations.map((conv) => (
                      <Link key={conv.id} href={`/atendimento?c=${conv.id}`} className="block">
                        <div className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-green-200 hover:bg-green-50/50 transition-colors cursor-pointer mb-3 last:mb-0 group">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 border border-gray-100">
                              <AvatarImage src={conv.contact.avatarUrl || undefined} />
                              <AvatarFallback className="bg-gray-50 text-gray-600 text-xs font-medium">
                                {conv.contact.name ? conv.contact.name.substring(0, 2).toUpperCase() : "??"}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-medium text-gray-900 group-hover:text-green-700 transition-colors">
                                {conv.contact.name || conv.contact.phone}
                              </p>
                              {conv.departmentName && (
                                <Badge variant="secondary" className="mt-1 text-[10px] px-1.5 py-0 h-4 border-none bg-gray-100 text-gray-600">
                                  {conv.departmentName}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDistanceToNow(new Date(conv.createdAt), { locale: ptBR })}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}