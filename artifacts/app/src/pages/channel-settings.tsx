/**
 * Channel settings page — IVR, working hours, distribution, messages.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Plus, Trash2, Loader2, Save } from "lucide-react";
import { Sidebar } from "./dashboard";
import { getChannelSettings, updateChannelSettings, type ChannelSettings } from "@/lib/api";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";

const DAYS = [
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terça" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

const DEFAULT_WORKING_HOURS = Object.fromEntries(
  DAYS.map((d) => [
    d.key,
    { start: "08:00", end: "18:00", active: !["saturday", "sunday"].includes(d.key) },
  ]),
);

function FormField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      {children}
    </div>
  );
}

export default function ChannelSettingsPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["channel-settings", tenantId],
    queryFn: () => (tenantId ? getChannelSettings(tenantId) : null),
    enabled: !!tenantId,
  });

  const [form, setForm] = useState<Partial<ChannelSettings>>({});
  const [menuOptions, setMenuOptions] = useState<
    { key: string; label: string; departmentId: number }[]
  >([]);

  useEffect(() => {
    if (data) {
      setForm(data);
      setMenuOptions(
        Array.isArray(data.menuOptions) ? data.menuOptions : [],
      );
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateChannelSettings(tenantId!, { ...form, menuOptions }),
    onSuccess: (updated) => {
      qc.setQueryData(["channel-settings", tenantId], updated);
      toast({ title: "Configurações salvas!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const field = <K extends keyof ChannelSettings>(key: K) => ({
    value: form[key] as string ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const wh = (form.workingHours as ChannelSettings["workingHours"]) ?? DEFAULT_WORKING_HOURS;

  if (isLoading || !tenantId) {
    return (
      <div className="min-h-[100dvh] bg-[#F4F7F8]">
        <Sidebar />
        <div className="ml-64 flex items-center justify-center h-screen">
          <Loader2 className="w-6 h-6 text-[#25D366] animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8]">
      <Sidebar />

      <div className="ml-64 flex flex-col">
        <header className="h-16 bg-white shadow-sm flex items-center justify-between px-8">
          <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#25D366]" />
            Configurações do Canal
          </h1>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-[#25D366] hover:bg-[#1ebe57] disabled:opacity-60 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Salvar
          </button>
        </header>

        <main className="p-8 max-w-3xl space-y-6">
          {/* Messages */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-semibold text-gray-800">Mensagens Automáticas</h2>

              <FormField
                label="Mensagem de boas-vindas"
                description="Enviada quando um cliente envia a primeira mensagem"
              >
                <textarea
                  {...field("welcomeMessage")}
                  rows={3}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] resize-none"
                  placeholder="Olá! Seja bem-vindo ao nosso atendimento. Como podemos ajudá-lo?"
                />
              </FormField>

              <FormField label="Texto do menu IVR" description="Pergunta exibida antes das opções">
                <input
                  type="text"
                  {...field("menuPrompt")}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366]"
                  placeholder="Por favor, escolha uma opção:"
                />
              </FormField>

              <FormField
                label="Mensagem fora do horário"
                description="Enviada quando o cliente contata fora do horário de atendimento"
              >
                <textarea
                  {...field("offHoursMessage")}
                  rows={2}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] resize-none"
                  placeholder="No momento estamos fora do horário de atendimento. Retornaremos em breve!"
                />
              </FormField>

              <FormField
                label="Mensagem de encerramento"
                description="Enviada quando o agente fecha a conversa"
              >
                <textarea
                  {...field("closingMessage")}
                  rows={2}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366] resize-none"
                  placeholder="Obrigado pelo contato! Se precisar de mais ajuda, estamos à disposição."
                />
              </FormField>
            </CardContent>
          </Card>

          {/* IVR Menu Options */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Opções do Menu IVR</h2>
                <button
                  onClick={() =>
                    setMenuOptions((prev) => [
                      ...prev,
                      { key: String(prev.length + 1), label: "", departmentId: 0 },
                    ])
                  }
                  className="text-sm text-[#25D366] hover:text-[#1ebe57] flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar opção
                </button>
              </div>

              {menuOptions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  Nenhuma opção configurada. Sem IVR, as conversas vão direto para a fila.
                </p>
              ) : (
                <div className="space-y-2">
                  {menuOptions.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <input
                        type="text"
                        value={opt.key}
                        onChange={(e) => {
                          const next = [...menuOptions];
                          next[idx] = { ...opt, key: e.target.value };
                          setMenuOptions(next);
                        }}
                        placeholder="1"
                        className="w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:border-[#25D366]"
                      />
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                          const next = [...menuOptions];
                          next[idx] = { ...opt, label: e.target.value };
                          setMenuOptions(next);
                        }}
                        placeholder="Vendas"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#25D366]"
                      />
                      <input
                        type="number"
                        value={opt.departmentId || ""}
                        onChange={(e) => {
                          const next = [...menuOptions];
                          next[idx] = { ...opt, departmentId: Number(e.target.value) };
                          setMenuOptions(next);
                        }}
                        placeholder="ID Depto"
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#25D366]"
                      />
                      <button
                        onClick={() => setMenuOptions((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Distribution & Timing */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-semibold text-gray-800">Distribuição e Tempo</h2>

              <FormField label="Modo de distribuição">
                <select
                  value={form.distributionMode ?? "manual"}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      distributionMode: e.target.value as "manual" | "round_robin" | "least_load",
                    }))
                  }
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366]"
                >
                  <option value="manual">Manual — agente escolhe da fila</option>
                  <option value="round_robin">Round Robin — distribuição circular</option>
                  <option value="least_load">Menor Carga — agente com menos conversas</option>
                </select>
              </FormField>

              <FormField
                label="Tempo de inatividade (minutos)"
                description="Fechar automaticamente conversas inativas após este tempo (0 = desabilitado)"
              >
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="number"
                    value={form.inactivityTimeoutMinutes ?? 60}
                    min={0}
                    max={1440}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        inactivityTimeoutMinutes: Number(e.target.value),
                      }))
                    }
                    className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#25D366]"
                  />
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={form.autoCloseEnabled ?? false}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, autoCloseEnabled: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#25D366]"
                    />
                    Fechar automaticamente
                  </label>
                </div>
              </FormField>
            </CardContent>
          </Card>

          {/* Working Hours */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Horário de Atendimento</h2>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={form.workingHoursEnabled ?? false}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, workingHoursEnabled: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#25D366]"
                  />
                  Habilitar
                </label>
              </div>

              {form.workingHoursEnabled && (
                <div className="space-y-2">
                  {DAYS.map((day) => {
                    const dayConfig = (wh?.[day.key] ?? DEFAULT_WORKING_HOURS[day.key])!;
                    return (
                      <div key={day.key} className="flex items-center gap-4">
                        <label className="flex items-center gap-2 w-28 text-sm">
                          <input
                            type="checkbox"
                            checked={dayConfig.active}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                workingHours: {
                                  ...wh,
                                  [day.key]: { ...dayConfig, active: e.target.checked },
                                },
                              }))
                            }
                            className="w-4 h-4 accent-[#25D366]"
                          />
                          <span className={dayConfig.active ? "text-gray-800" : "text-gray-400"}>
                            {day.label}
                          </span>
                        </label>
                        {dayConfig.active && (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={dayConfig.start}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  workingHours: {
                                    ...wh,
                                    [day.key]: { ...dayConfig, start: e.target.value },
                                  },
                                }))
                              }
                              className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#25D366]"
                            />
                            <span className="text-gray-400 text-sm">até</span>
                            <input
                              type="time"
                              value={dayConfig.end}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  workingHours: {
                                    ...wh,
                                    [day.key]: { ...dayConfig, end: e.target.value },
                                  },
                                }))
                              }
                              className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#25D366]"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
