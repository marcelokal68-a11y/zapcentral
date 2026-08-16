import { useState } from "react";
import { Sidebar } from "../dashboard";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { useCrmHooks, useDeals, useContacts } from "@/hooks/use-crm";
import {
  KanbanSquare,
  Plus,
  Loader2,
  DollarSign,
  Calendar,
  MoreVertical,
  GripHorizontal,
  Settings2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";

export default function KanbanPage() {
  const { tenantId, dealStages, agents } = useCrmHooks();
  const { query: dealsQuery, updateDeal } = useDeals({ status: "open" });
  const { toast } = useToast();

  const [draggedDealId, setDraggedDealId] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, dealId: number) => {
    setDraggedDealId(dealId);
    e.dataTransfer.effectAllowed = "move";
    // Slight delay to allow visual drag clone before hiding
    setTimeout(() => {
      const el = document.getElementById(`deal-${dealId}`);
      if (el) el.style.opacity = "0.5";
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent, dealId: number) => {
    setDraggedDealId(null);
    const el = document.getElementById(`deal-${dealId}`);
    if (el) el.style.opacity = "1";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    if (!draggedDealId) return;
    
    const deal = dealsQuery.data?.find(d => d.id === draggedDealId);
    if (deal && deal.stageId !== stageId) {
      updateDeal.mutate({ id: draggedDealId, data: { stageId } }, {
        onError: () => toast({ title: "Erro ao mover", variant: "destructive" })
      });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8] flex flex-col">
      <Sidebar />
      <div className="ml-64 flex flex-col flex-1 h-screen overflow-hidden">
        <header className="bg-white shadow-sm z-10 flex-shrink-0">
          <div className="h-16 flex items-center justify-between px-8">
            <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <KanbanSquare className="w-5 h-5 text-[#25D366]" />
              Funil de Vendas
            </h1>
            <div className="flex items-center gap-3">
              <ManageStagesDialog />
              <CreateDealDialog />
            </div>
          </div>
          <CrmTabs />
        </header>

        <main className="flex-1 overflow-x-auto overflow-y-hidden p-6">
          {dealStages.isLoading || dealsQuery.isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#25D366]" />
            </div>
          ) : (
            <div className="flex h-full gap-6 items-start">
              {dealStages.data?.sort((a,b) => a.position - b.position).map(stage => {
                const stageDeals = dealsQuery.data?.filter(d => d.stageId === stage.id) || [];
                const stageTotal = stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
                
                return (
                  <div
                    key={stage.id}
                    className="flex-shrink-0 w-80 max-h-full flex flex-col bg-gray-100/50 rounded-xl border border-gray-200/60"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, stage.id)}
                  >
                    <div className="p-3 border-b border-gray-200/60">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color || "#ccc" }} />
                          {stage.name}
                        </h3>
                        <span className="text-xs font-medium bg-white px-2 py-0.5 rounded-full text-gray-500 shadow-sm border border-gray-100">
                          {stageDeals.length}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-gray-500 pl-4.5">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stageTotal)}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[150px]">
                      {stageDeals.map(deal => (
                        <div
                          key={deal.id}
                          id={`deal-${deal.id}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, deal.id)}
                          onDragEnd={(e) => handleDragEnd(e, deal.id)}
                          className="bg-white rounded-lg shadow-sm border border-gray-200 p-3.5 cursor-grab active:cursor-grabbing hover:border-[#25D366]/50 transition-colors group relative"
                        >
                          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <DealActionsMenu deal={deal} />
                          </div>
                          
                          <h4 className="font-medium text-gray-900 text-sm mb-1 pr-6">{deal.title}</h4>
                          
                          <Link href={`/crm/contatos/${deal.contactId}`}>
                            <p className="text-xs text-blue-600 hover:underline mb-3">{deal.contactName}</p>
                          </Link>

                          <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
                            {deal.value ? (
                              <span className="text-xs font-semibold text-gray-700 flex items-center">
                                <DollarSign className="w-3 h-3 text-green-600 mr-0.5" />
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(deal.value))}
                              </span>
                            ) : <span />}
                            
                            {deal.assignedTo && (
                              <Avatar className="h-5 w-5 border border-gray-100">
                                {(() => {
                                  const agent = agents.data?.find(a => a.clerkUserId === deal.assignedTo);
                                  return (
                                    <>
                                      <AvatarImage src={agent?.avatarUrl || undefined} />
                                      <AvatarFallback className="bg-gray-100 text-[10px] font-medium text-gray-600">
                                        {agent?.firstName?.[0] || agent?.email[0].toUpperCase() || "?"}
                                      </AvatarFallback>
                                    </>
                                  );
                                })()}
                              </Avatar>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {dealStages.data?.length === 0 && (
                <div className="w-full text-center py-20 text-gray-500">
                  Nenhuma etapa de funil configurada. Crie as etapas em "Gerenciar Etapas".
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ManageStagesDialog() {
  const [open, setOpen] = useState(false);
  const { dealStages, createDealStage, deleteDealStage } = useCrmHooks();
  const { toast } = useToast();

  const [newStage, setNewStage] = useState({ name: "", color: "#25D366" });

  const handleAdd = () => {
    if (!newStage.name) return;
    createDealStage.mutate({ name: newStage.name, color: newStage.color, position: (dealStages.data?.length || 0) + 1 }, {
      onSuccess: () => {
        setNewStage({ name: "", color: "#25D366" });
        toast({ title: "Etapa adicionada" });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteDealStage.mutate(id, {
      onSuccess: () => toast({ title: "Etapa excluída" }),
      onError: (err: any) => {
        if (err.status === 409) {
          toast({ title: "Não é possível excluir", description: "A etapa possui negócios. Mova-os primeiro.", variant: "destructive" });
        }
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="bg-white border-gray-200 text-gray-700">
          <Settings2 className="w-4 h-4 mr-2" />
          Gerenciar Etapas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Etapas do Funil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <ul className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {dealStages.data?.sort((a,b) => a.position - b.position).map(stage => (
              <li key={stage.id} className="flex items-center justify-between p-2 border rounded-md bg-gray-50">
                <div className="flex items-center gap-2">
                  <GripHorizontal className="w-4 h-4 text-gray-400 cursor-move" />
                  <input type="color" value={stage.color || "#000"} disabled className="w-6 h-6 p-0 border-0 rounded cursor-default" />
                  <span className="text-sm font-medium">{stage.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:bg-red-50" onClick={() => handleDelete(stage.id)}>
                  &times;
                </Button>
              </li>
            ))}
          </ul>
          
          <div className="flex gap-2 items-center pt-4 border-t">
            <input 
              type="color" 
              value={newStage.color} 
              onChange={e => setNewStage({...newStage, color: e.target.value})}
              className="w-8 h-8 p-0 border-0 rounded cursor-pointer shrink-0" 
            />
            <Input 
              placeholder="Nova etapa..." 
              value={newStage.name} 
              onChange={e => setNewStage({...newStage, name: e.target.value})} 
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={createDealStage.isPending || !newStage.name}>Adicionar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateDealDialog() {
  const [open, setOpen] = useState(false);
  const { createDeal } = useDeals({});
  const { dealStages, agents } = useCrmHooks();
  const { query: contactsQuery } = useContacts({ limit: 100 }); // Quick list for select
  const { toast } = useToast();

  const [form, setForm] = useState<{
    title: string;
    contactId: string;
    stageId: string;
    value: string;
    assignedTo: string;
  }>({ title: "", contactId: "", stageId: "", value: "", assignedTo: "unassigned" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.contactId || !form.stageId) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    
    createDeal.mutate({
      title: form.title,
      contactId: Number(form.contactId),
      stageId: Number(form.stageId),
      value: form.value ? Number(form.value) : null,
      assignedTo: form.assignedTo === "unassigned" ? null : form.assignedTo,
    }, {
      onSuccess: () => {
        toast({ title: "Negócio criado!" });
        setOpen(false);
        setForm({ title: "", contactId: "", stageId: "", value: "", assignedTo: "unassigned" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#25D366] hover:bg-[#1ebe57] text-white">
          <Plus className="w-4 h-4 mr-2" />
          Novo Negócio
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar Negócio</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Título (Obrigatório)</label>
            <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="Ex: Projeto XPTO" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Contato (Obrigatório)</label>
              <Select value={form.contactId} onValueChange={v => setForm({...form, contactId: v})}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {contactsQuery.data?.contacts.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name || c.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Etapa (Obrigatório)</label>
              <Select value={form.stageId} onValueChange={v => setForm({...form, stageId: v})}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {dealStages.data?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Valor Estimado (R$)</label>
              <Input type="number" step="0.01" value={form.value} onChange={e => setForm({...form, value: e.target.value})} placeholder="Ex: 5000.00" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Responsável</label>
              <Select value={form.assignedTo} onValueChange={v => setForm({...form, assignedTo: v})}>
                <SelectTrigger><SelectValue placeholder="Responsável..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Sem responsável</SelectItem>
                  {agents.data?.map(a => (
                    <SelectItem key={a.clerkUserId} value={a.clerkUserId}>
                      {a.firstName ? `${a.firstName} ${a.lastName || ""}` : a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" className="bg-[#25D366] hover:bg-[#1ebe57] text-white" disabled={createDeal.isPending}>
              {createDeal.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DealActionsMenu({ deal }: { deal: any }) {
  const { updateDeal, deleteDeal } = useDeals({});
  const { toast } = useToast();

  const handleStatus = (status: "won" | "lost") => {
    updateDeal.mutate({ id: deal.id, data: { status } }, {
      onSuccess: () => toast({ title: status === 'won' ? "Negócio Ganho! 🎉" : "Negócio Perdido" })
    });
  };

  const handleDelete = () => {
    if(confirm("Excluir este negócio?")) {
      deleteDeal.mutate(deal.id, {
        onSuccess: () => toast({ title: "Negócio excluído" })
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 bg-white/80 hover:bg-white shadow-sm border border-gray-100">
          <MoreVertical className="w-3 h-3 text-gray-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => handleStatus("won")} className="text-green-600 font-medium focus:text-green-700">
          Marcar como Ganho
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleStatus("lost")} className="text-red-600 font-medium focus:text-red-700">
          Marcar como Perdido
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDelete} className="text-gray-500 mt-2 border-t">
          Excluir negócio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
