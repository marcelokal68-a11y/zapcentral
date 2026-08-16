/**
 * Contact context panel shown alongside the chat thread.
 * Shows CRM data for the conversation's contact: profile, tags,
 * conversation tags, notes and open deals — with quick actions.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Loader2,
  Plus,
  Tag as TagIcon,
  StickyNote,
  Trash2,
  ExternalLink,
  Briefcase,
  Building2,
  Mail,
  Pencil,
  IdCard,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getContact,
  updateContact,
  listTags,
  createTag,
  addContactTag,
  removeContactTag,
  listConversationTags,
  addConversationTag,
  removeConversationTag,
  createContactNote,
  deleteNote,
  type Tag,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isValidCpf, formatCpf, normalizeCpf } from "@/lib/cpf";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-white"
      style={{ backgroundColor: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-70 hover:opacity-100 leading-none">
          ×
        </button>
      )}
    </span>
  );
}

function TagPicker({
  tenantId,
  assigned,
  onAdd,
}: {
  tenantId: number;
  assigned: Tag[];
  onAdd: (tagId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const qc = useQueryClient();
  const { data: tags } = useQuery({
    queryKey: ["crm", "tags", tenantId],
    queryFn: () => listTags(tenantId),
    enabled: open,
  });
  const createMutation = useMutation({
    mutationFn: (name: string) => createTag(tenantId, { name }),
    onSuccess: (tag) => {
      void qc.invalidateQueries({ queryKey: ["crm", "tags", tenantId] });
      onAdd(tag.id);
      setNewName("");
      setOpen(false);
    },
  });
  const assignedIds = new Set(assigned.map((t) => t.id));
  const available = (tags ?? []).filter((t) => !assignedIds.has(t.id));

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-dashed border-white/20 text-[#8899A6] hover:text-white hover:border-white/40 transition-colors"
      >
        <Plus className="w-3 h-3" /> tag
      </button>
      {open && (
        <div className="absolute z-50 top-6 left-0 bg-[#1A2B38] border border-white/10 rounded-lg shadow-xl p-2 w-48 space-y-1">
          {available.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onAdd(t.id);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1 rounded hover:bg-white/5 text-xs text-white flex items-center gap-2"
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
          {available.length === 0 && (
            <p className="text-[11px] text-[#8899A6] px-2 py-1">Sem tags disponíveis</p>
          )}
          <div className="flex gap-1 pt-1 border-t border-white/10">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim())
                  createMutation.mutate(newName.trim());
              }}
              placeholder="Nova tag..."
              className="flex-1 bg-[#0F1923] border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-[#8899A6] focus:outline-none"
            />
            <button
              onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
              disabled={createMutation.isPending || !newName.trim()}
              className="text-xs text-[#25D366] px-1.5 disabled:opacity-40"
            >
              {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactPanel({
  tenantId,
  contactId,
  conversationId,
}: {
  tenantId: number;
  contactId: number;
  conversationId: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCpf, setEditCpf] = useState("");

  const { data: contact, isLoading } = useQuery({
    queryKey: ["crm", "contact", tenantId, contactId],
    queryFn: () => getContact(tenantId, contactId),
  });

  const { data: convTags } = useQuery({
    queryKey: ["conversation-tags", tenantId, conversationId],
    queryFn: () => listConversationTags(tenantId, conversationId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId, contactId] });
    void qc.invalidateQueries({ queryKey: ["conversation-tags", tenantId, conversationId] });
  };

  const updateContactM = useMutation({
    mutationFn: () => {
      const cpfDigits = normalizeCpf(editCpf);
      return updateContact(tenantId, contactId, {
        name: editName.trim() || null,
        cpf: cpfDigits || null,
      });
    },
    onSuccess: () => {
      setEditing(false);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["conversations", tenantId] });
      toast({ title: "Cadastro atualizado" });
    },
    onError: (err: Error) =>
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" }),
  });

  const startEditing = () => {
    setEditName(contact?.name ?? "");
    setEditCpf(contact?.cpf ? formatCpf(contact.cpf) : "");
    setEditing(true);
  };

  const saveEdit = () => {
    const cpfDigits = normalizeCpf(editCpf);
    if (cpfDigits && !isValidCpf(cpfDigits)) {
      toast({ title: "CPF inválido", variant: "destructive" });
      return;
    }
    updateContactM.mutate();
  };

  const addContactTagM = useMutation({
    mutationFn: (tagId: number) => addContactTag(tenantId, contactId, tagId),
    onSuccess: invalidate,
  });
  const removeContactTagM = useMutation({
    mutationFn: (tagId: number) => removeContactTag(tenantId, contactId, tagId),
    onSuccess: invalidate,
  });
  const addConvTagM = useMutation({
    mutationFn: (tagId: number) => addConversationTag(tenantId, conversationId, tagId),
    onSuccess: invalidate,
  });
  const removeConvTagM = useMutation({
    mutationFn: (tagId: number) => removeConversationTag(tenantId, conversationId, tagId),
    onSuccess: invalidate,
  });
  const addNoteM = useMutation({
    mutationFn: () =>
      createContactNote(tenantId, contactId, { content: noteText.trim(), conversationId }),
    onSuccess: () => {
      setNoteText("");
      invalidate();
    },
    onError: () => toast({ title: "Erro ao salvar nota", variant: "destructive" }),
  });
  const deleteNoteM = useMutation({
    mutationFn: (noteId: number) => deleteNote(tenantId, noteId),
    onSuccess: invalidate,
    onError: () =>
      toast({ title: "Apenas o autor pode excluir a nota", variant: "destructive" }),
  });

  if (isLoading || !contact) {
    return (
      <div className="w-72 shrink-0 border-l border-white/5 bg-[#0A1520] flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-[#25D366] animate-spin" />
      </div>
    );
  }

  const openDeals = contact.deals.filter((d) => d.status === "open");

  return (
    <div className="w-72 shrink-0 border-l border-white/5 bg-[#0A1520] overflow-y-auto">
      {/* Profile */}
      <div className="p-4 border-b border-white/5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-white truncate">
            {contact.name ?? contact.phone}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (editing ? setEditing(false) : startEditing())}
              className="text-[#8899A6] hover:text-[#25D366]"
              title="Completar cadastro"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <Link
              href={`/crm/contatos/${contact.id}`}
              className="text-[#8899A6] hover:text-[#25D366]"
              title="Abrir perfil no CRM"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
        <p className="text-xs text-[#8899A6]">{contact.phone}</p>
        {editing ? (
          <div className="mt-2 space-y-2">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nome completo"
              className="w-full bg-[#1A2B38] border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-[#8899A6] focus:outline-none focus:border-[#25D366]/50"
            />
            <input
              value={editCpf}
              onChange={(e) => setEditCpf(e.target.value)}
              placeholder="CPF (000.000.000-00)"
              className="w-full bg-[#1A2B38] border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-[#8899A6] focus:outline-none focus:border-[#25D366]/50"
            />
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                disabled={updateContactM.isPending}
                className="flex-1 bg-[#25D366] hover:bg-[#1ebe57] disabled:opacity-50 text-white text-xs py-1.5 rounded transition-colors"
              >
                {updateContactM.isPending ? "Salvando..." : "Salvar"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 text-xs text-[#8899A6] hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            {contact.cpf ? (
              <p className="text-xs text-[#8899A6] flex items-center gap-1.5 mt-1">
                <IdCard className="w-3 h-3" /> CPF: {formatCpf(contact.cpf)}
              </p>
            ) : (
              <button
                onClick={startEditing}
                className="text-xs text-amber-400/80 hover:text-amber-300 flex items-center gap-1.5 mt-1"
              >
                <IdCard className="w-3 h-3" /> Cadastro incompleto — adicionar CPF
              </button>
            )}
          </>
        )}
        {contact.email && (
          <p className="text-xs text-[#8899A6] flex items-center gap-1.5 mt-1">
            <Mail className="w-3 h-3" /> {contact.email}
          </p>
        )}
        {contact.company && (
          <p className="text-xs text-[#8899A6] flex items-center gap-1.5 mt-1">
            <Building2 className="w-3 h-3" /> {contact.company}
          </p>
        )}
      </div>

      {/* Contact tags */}
      <div className="p-4 border-b border-white/5">
        <p className="text-[11px] uppercase tracking-wide text-[#8899A6] mb-2 flex items-center gap-1.5">
          <TagIcon className="w-3 h-3" /> Tags do contato
        </p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {contact.tags.map((t) => (
            <TagChip key={t.id} tag={t} onRemove={() => removeContactTagM.mutate(t.id)} />
          ))}
          <TagPicker
            tenantId={tenantId}
            assigned={contact.tags}
            onAdd={(id) => addContactTagM.mutate(id)}
          />
        </div>
      </div>

      {/* Conversation tags */}
      <div className="p-4 border-b border-white/5">
        <p className="text-[11px] uppercase tracking-wide text-[#8899A6] mb-2 flex items-center gap-1.5">
          <TagIcon className="w-3 h-3" /> Tags da conversa
        </p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {(convTags ?? []).map((t) => (
            <TagChip key={t.id} tag={t} onRemove={() => removeConvTagM.mutate(t.id)} />
          ))}
          <TagPicker
            tenantId={tenantId}
            assigned={convTags ?? []}
            onAdd={(id) => addConvTagM.mutate(id)}
          />
        </div>
      </div>

      {/* Open deals */}
      {openDeals.length > 0 && (
        <div className="p-4 border-b border-white/5">
          <p className="text-[11px] uppercase tracking-wide text-[#8899A6] mb-2 flex items-center gap-1.5">
            <Briefcase className="w-3 h-3" /> Negócios abertos
          </p>
          <div className="space-y-2">
            {openDeals.map((d) => (
              <div key={d.id} className="bg-[#111E28] rounded-lg p-2.5">
                <p className="text-xs font-medium text-white truncate">{d.title}</p>
                <div className="flex items-center justify-between mt-1">
                  <Badge
                    className="text-[10px] border-none px-1.5 py-0 text-white"
                    style={{ backgroundColor: d.stageColor ?? "#4b5563" }}
                  >
                    {d.stageName}
                  </Badge>
                  {d.value && (
                    <span className="text-[11px] text-[#25D366]">
                      {brl.format(Number(d.value))}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-[#8899A6] mb-2 flex items-center gap-1.5">
          <StickyNote className="w-3 h-3" /> Notas internas
        </p>
        <div className="flex gap-1.5 mb-3">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && noteText.trim()) addNoteM.mutate();
            }}
            placeholder="Adicionar nota..."
            className="flex-1 bg-[#1A2B38] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#8899A6] focus:outline-none focus:border-[#25D366]/50"
          />
          <button
            onClick={() => noteText.trim() && addNoteM.mutate()}
            disabled={addNoteM.isPending || !noteText.trim()}
            className={cn(
              "bg-[#25D366] hover:bg-[#1ebe57] text-white rounded-lg px-2.5 disabled:opacity-40",
            )}
          >
            {addNoteM.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <div className="space-y-2">
          {contact.notes.length === 0 && (
            <p className="text-xs text-[#8899A6]">Nenhuma nota ainda</p>
          )}
          {contact.notes.map((n) => (
            <div key={n.id} className="bg-[#111E28] rounded-lg p-2.5 group">
              <p className="text-xs text-white whitespace-pre-wrap">{n.content}</p>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-[#8899A6]">
                  {new Date(n.createdAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  onClick={() => deleteNoteM.mutate(n.id)}
                  className="opacity-0 group-hover:opacity-100 text-[#8899A6] hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
