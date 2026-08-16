import { useState, useRef, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { Sidebar } from "../dashboard";
import { useCrmHooks, useContactDetail } from "@/hooks/use-crm";
import {
  ArrowLeft,
  Phone,
  Mail,
  Building2,
  Calendar,
  Save,
  Loader2,
  Plus,
  Trash2,
  MessageCircle,
  Clock,
  Briefcase,
  AlertCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function ContactDetailPage() {
  const [, params] = useRoute("/crm/contatos/:id");
  const id = params?.id ? Number(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { agents, tags, customFields } = useCrmHooks();
  const {
    query,
    updateContact,
    deleteContact,
    addTag,
    removeTag,
    updateCustomValues,
    createNote,
    deleteNote
  } = useContactDetail(id);

  const contact = query.data;

  // Local state for basic fields
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
    assignedTo: ""
  });

  useEffect(() => {
    if (contact && !isEditing) {
      setFormData({
        name: contact.name || "",
        phone: contact.phone || "",
        email: contact.email || "",
        company: contact.company || "",
        assignedTo: contact.assignedTo || ""
      });
    }
  }, [contact, isEditing]);

  const handleSaveBasic = () => {
    updateContact.mutate(
      {
        name: formData.name || null,
        phone: formData.phone,
        email: formData.email || null,
        company: formData.company || null,
        assignedTo: formData.assignedTo || null,
      },
      {
        onSuccess: () => {
          toast({ title: "Dados atualizados com sucesso" });
          setIsEditing(false);
        }
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Tem certeza que deseja excluir este contato? Esta ação não pode ser desfeita.")) {
      deleteContact.mutate(undefined, {
        onSuccess: () => {
          toast({ title: "Contato excluído" });
          setLocation("/crm");
        },
        onError: (err: any) => {
          if (err.status === 409) {
            toast({ 
              title: "Não é possível excluir", 
              description: "Este contato possui conversas vinculadas. Considere mesclar com outro contato em vez de excluir.",
              variant: "destructive"
            });
          } else {
            toast({ title: "Erro", description: err.message, variant: "destructive" });
          }
        }
      });
    }
  };

  if (query.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#F4F7F8]">
        <Sidebar />
        <div className="ml-64 flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 text-[#25D366] animate-spin" />
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="min-h-[100dvh] bg-[#F4F7F8]">
        <Sidebar />
        <div className="ml-64 p-8 flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
          <AlertCircle className="w-12 h-12 text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Contato não encontrado</h2>
          <Link href="/crm">
            <Button variant="outline">Voltar para Contatos</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8]">
      <Sidebar />

      <div className="ml-64 flex flex-col">
        <header className="bg-white shadow-sm z-0">
          <div className="h-16 flex items-center justify-between px-8">
            <div className="flex items-center gap-4">
              <Link href="/crm">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-gray-900">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={contact.avatarUrl || undefined} />
                  <AvatarFallback className="bg-[#25D366]/10 text-[#1f9d55] text-xs font-semibold">
                    {contact.name?.substring(0, 2).toUpperCase() || "??"}
                  </AvatarFallback>
                </Avatar>
                <h1 className="text-xl font-semibold text-gray-800">
                  {contact.name || contact.phone}
                </h1>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-transparent" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                Excluir
              </Button>
              {!isEditing ? (
                <Button onClick={() => setIsEditing(true)} className="bg-white text-gray-700 border-gray-200 hover:bg-gray-50">
                  Editar Perfil
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsEditing(false)}>Cancelar</Button>
                  <Button onClick={handleSaveBasic} className="bg-[#25D366] hover:bg-[#1ebe57] text-white" disabled={updateContact.isPending}>
                    {updateContact.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Salvar
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-8">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Left Column: Basic Info & Custom Fields */}
            <div className="space-y-6">
              <Card className="shadow-sm border-gray-200">
                <CardHeader className="pb-3 border-b border-gray-100">
                  <CardTitle className="text-base font-semibold text-gray-800">Dados Principais</CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</label>
                    {isEditing ? (
                      <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                    ) : (
                      <p className="text-sm font-medium text-gray-900">{contact.name || "—"}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Telefone (WhatsApp)</label>
                    {isEditing ? (
                      <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-900">
                        <Phone className="w-4 h-4 text-gray-400" />
                        {contact.phone}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</label>
                    {isEditing ? (
                      <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-900">
                        <Mail className="w-4 h-4 text-gray-400" />
                        {contact.email || "—"}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Empresa</label>
                    {isEditing ? (
                      <Input value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-900">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        {contact.company || "—"}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Responsável</label>
                    {isEditing ? (
                      <Select value={formData.assignedTo || "unassigned"} onValueChange={v => setFormData({...formData, assignedTo: v === "unassigned" ? "" : v})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Sem responsável</SelectItem>
                          {agents.data?.map(a => (
                            <SelectItem key={a.clerkUserId} value={a.clerkUserId}>
                              {a.firstName ? `${a.firstName} ${a.lastName || ""}` : a.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm font-medium text-gray-900">
                        {contact.assignedTo ? (() => {
                          const agent = agents.data?.find(a => a.clerkUserId === contact.assignedTo);
                          return agent ? (agent.firstName ? `${agent.firstName} ${agent.lastName || ""}` : agent.email) : "Desconhecido";
                        })() : "—"}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Tags Section */}
              <Card className="shadow-sm border-gray-200">
                <CardHeader className="pb-3 border-b border-gray-100 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-semibold text-gray-800">Tags</CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-900 hover:bg-gray-100">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {tags.data?.filter(t => !contact.tags.find(ct => ct.id === t.id)).length === 0 ? (
                        <div className="px-2 py-1 text-sm text-gray-500">Todas as tags adicionadas</div>
                      ) : (
                        tags.data?.filter(t => !contact.tags.find(ct => ct.id === t.id)).map(t => (
                          <DropdownMenuItem key={t.id} onClick={() => addTag.mutate(t.id)}>
                            <span className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: t.color || "#ccc" }} />
                            {t.name}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="flex flex-wrap gap-2">
                    {contact.tags.length === 0 ? (
                      <span className="text-sm text-gray-400">Nenhuma tag</span>
                    ) : (
                      contact.tags.map(t => (
                        <Badge
                          key={t.id}
                          variant="secondary"
                          className="border-none font-medium pr-1 group flex items-center gap-1"
                          style={{ backgroundColor: `${t.color}20`, color: t.color }}
                        >
                          {t.name}
                          <button
                            onClick={() => removeTag.mutate(t.id)}
                            className="p-0.5 rounded-full hover:bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Custom Fields */}
              {customFields.data && customFields.data.length > 0 && (
                <Card className="shadow-sm border-gray-200">
                  <CardHeader className="pb-3 border-b border-gray-100 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base font-semibold text-gray-800">Campos Customizados</CardTitle>
                    {isEditing ? null : (
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-[#25D366] hover:text-[#1ebe57]" onClick={() => setIsEditing(true)}>
                        Editar
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="p-5 space-y-4">
                    {contact.customFields.map(cf => (
                      <div key={cf.id} className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{cf.name}</label>
                        {isEditing ? (
                          cf.type === 'select' ? (
                            <Select
                              value={cf.value || ""}
                              onValueChange={(v) => {
                                const newValues = contact.customFields.map(f => f.id === cf.id ? { fieldId: f.id, value: v } : { fieldId: f.id, value: f.value });
                                updateCustomValues.mutate(newValues);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                {cf.options?.map(opt => (
                                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type={cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text'}
                              defaultValue={cf.value || ""}
                              onBlur={(e) => {
                                const newValues = contact.customFields.map(f => f.id === cf.id ? { fieldId: f.id, value: e.target.value } : { fieldId: f.id, value: f.value });
                                updateCustomValues.mutate(newValues);
                              }}
                            />
                          )
                        ) : (
                          <p className="text-sm font-medium text-gray-900">{cf.type === 'date' && cf.value ? format(new Date(cf.value), "dd/MM/yyyy") : cf.value || "—"}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right Column: Timeline & Notes & Deals */}
            <div className="xl:col-span-2 space-y-6">
              
              {/* Linked Deals */}
              <Card className="shadow-sm border-gray-200">
                <CardHeader className="pb-3 border-b border-gray-100 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <Briefcase className="w-5 h-5 text-amber-500" />
                    Negócios no Funil
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {contact.deals.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                      Nenhum negócio vinculado. Crie no Funil de Vendas.
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {contact.deals.map(deal => (
                        <li key={deal.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900">{deal.title}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <Badge variant="outline" className="text-xs border-gray-200" style={{ backgroundColor: `${deal.stageColor}15`, color: deal.stageColor, borderColor: `${deal.stageColor}30` }}>
                                {deal.stageName}
                              </Badge>
                              {deal.value && (
                                <span className="text-sm font-medium text-gray-700">
                                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(deal.value))}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge className={
                            deal.status === 'won' ? "bg-green-100 text-green-700" :
                            deal.status === 'lost' ? "bg-red-100 text-red-700" :
                            "bg-blue-100 text-blue-700"
                          } variant="secondary">
                            {deal.status === 'won' ? 'Ganho' : deal.status === 'lost' ? 'Perdido' : 'Em andamento'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Timeline (Notes & Conversations mixed conceptually, for now showing Notes + Conversation history) */}
              <Card className="shadow-sm border-gray-200 flex-1">
                <CardHeader className="pb-3 border-b border-gray-100">
                  <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-500" />
                    Histórico e Notas
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  
                  {/* Note input */}
                  <div className="mb-8 bg-gray-50 rounded-lg p-1">
                    <textarea 
                      id="note-input"
                      className="w-full bg-transparent border-0 focus:ring-0 resize-none p-3 text-sm text-gray-800 placeholder:text-gray-400"
                      rows={3}
                      placeholder="Adicione uma nota interna..."
                    />
                    <div className="flex justify-end p-2 border-t border-gray-200/50">
                      <Button 
                        size="sm" 
                        className="bg-[#25D366] hover:bg-[#1ebe57] text-white"
                        onClick={() => {
                          const el = document.getElementById("note-input") as HTMLTextAreaElement;
                          if (el.value.trim()) {
                            createNote.mutate({ content: el.value.trim() }, {
                              onSuccess: () => { el.value = ""; toast({ title: "Nota adicionada" }); }
                            });
                          }
                        }}
                      >
                        Salvar Nota
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
                    
                    {/* Notes */}
                    {contact.notes.map(note => (
                      <div key={`note-${note.id}`} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-amber-100 text-amber-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                          <MessageCircle className="w-4 h-4" />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow relative">
                          <div className="flex justify-between items-start mb-2">
                            <div className="text-xs font-medium text-gray-500">
                              Nota Interna • {format(new Date(note.createdAt), "dd/MM/yyyy HH:mm")}
                            </div>
                            <button onClick={() => deleteNote.mutate(note.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                        </div>
                      </div>
                    ))}

                    {/* Conversations (stub mapped from API) */}
                    {contact.conversations.map(conv => (
                      <div key={`conv-${conv.id}`} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-green-100 text-green-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                          <Phone className="w-4 h-4" />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow relative">
                          <div className="flex justify-between items-start mb-1">
                            <div className="text-xs font-medium text-gray-500">
                              Conversa WhatsApp • {format(new Date(conv.createdAt), "dd/MM/yyyy HH:mm")}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-xs bg-gray-50">{conv.status}</Badge>
                            {conv.departmentName && <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">{conv.departmentName}</Badge>}
                          </div>
                          <div className="mt-3">
                            <Link href={`/atendimento`}>
                              <Button variant="link" size="sm" className="h-6 px-0 text-[#25D366] hover:text-[#1ebe57]">Ver no Atendimento &rarr;</Button>
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}

                  </div>
                </CardContent>
              </Card>

            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
