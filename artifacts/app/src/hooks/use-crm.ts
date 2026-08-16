import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenantId } from "./useTenantId";
import * as api from "@/lib/api";

export function useCrmHooks() {
  const tenantId = useTenantId();
  const qc = useQueryClient();

  // Tags
  const tags = useQuery({
    queryKey: ["crm", "tags", tenantId],
    queryFn: () => api.listTags(tenantId!),
    enabled: !!tenantId,
  });

  const createTag = useMutation({
    mutationFn: (data: { name: string; color?: string }) => api.createTag(tenantId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "tags", tenantId] }),
  });

  const deleteTag = useMutation({
    mutationFn: (tagId: number) => api.deleteTag(tenantId!, tagId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "tags", tenantId] }),
  });

  // Custom Fields
  const customFields = useQuery({
    queryKey: ["crm", "custom-fields", tenantId],
    queryFn: () => api.listCustomFields(tenantId!),
    enabled: !!tenantId,
  });

  const createCustomField = useMutation({
    mutationFn: (data: { name: string; type?: "text" | "number" | "date" | "select"; options?: string[]; position?: number }) => api.createCustomField(tenantId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "custom-fields", tenantId] }),
  });

  const deleteCustomField = useMutation({
    mutationFn: (fieldId: number) => api.deleteCustomField(tenantId!, fieldId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "custom-fields", tenantId] }),
  });

  // Deal Stages
  const dealStages = useQuery({
    queryKey: ["crm", "deal-stages", tenantId],
    queryFn: () => api.listDealStages(tenantId!),
    enabled: !!tenantId,
  });

  const createDealStage = useMutation({
    mutationFn: (data: { name: string; color?: string; position?: number }) => api.createDealStage(tenantId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "deal-stages", tenantId] }),
  });

  const updateDealStage = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ name: string; color: string; position: number }> }) => api.updateDealStage(tenantId!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "deal-stages", tenantId] }),
  });

  const deleteDealStage = useMutation({
    mutationFn: (stageId: number) => api.deleteDealStage(tenantId!, stageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "deal-stages", tenantId] }),
  });

  // Agents
  const agents = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => api.listAgentStatuses(tenantId!),
    enabled: !!tenantId,
  });

  return {
    tenantId,
    tags,
    createTag,
    deleteTag,
    customFields,
    createCustomField,
    deleteCustomField,
    dealStages,
    createDealStage,
    updateDealStage,
    deleteDealStage,
    agents,
  };
}

export function useContacts(params: { q?: string; tagId?: number; assignedTo?: string; page?: number; limit?: number }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["crm", "contacts", tenantId, params],
    queryFn: () => api.listContacts(tenantId!, params),
    enabled: !!tenantId,
  });

  const createContact = useMutation({
    mutationFn: (data: { phone: string; name?: string | null; email?: string | null; cpf?: string | null; origin?: "invite" | "qr" | "organic"; company?: string | null; notes?: string | null }) => api.createContact(tenantId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contacts", tenantId] }),
  });

  const mergeContacts = useMutation({
    mutationFn: (data: { primaryId: number; duplicateId: number }) => api.mergeContacts(tenantId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contacts", tenantId] }),
  });

  const bulkContacts = useMutation({
    mutationFn: (data: { contactIds: number[]; addTagId?: number; assignedTo?: string | null }) => api.bulkContacts(tenantId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contacts", tenantId] }),
  });

  const importCsv = useMutation({
    mutationFn: (csv: string) => api.importContactsCsv(tenantId!, csv),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contacts", tenantId] }),
  });

  return { query, createContact, mergeContacts, bulkContacts, importCsv };
}

export function useContactDetail(contactId: number) {
  const tenantId = useTenantId();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["crm", "contact", tenantId, contactId],
    queryFn: () => api.getContact(tenantId!, contactId),
    enabled: !!tenantId && !!contactId,
  });

  const updateContact = useMutation({
    mutationFn: (data: Partial<{ phone: string; name: string | null; email: string | null; cpf: string | null; company: string | null; notes: string | null; assignedTo: string | null }>) => api.updateContact(tenantId!, contactId, data),
    onSuccess: (updated) => {
      qc.setQueryData(["crm", "contact", tenantId, contactId], (old: any) => old ? { ...old, ...updated } : old);
      qc.invalidateQueries({ queryKey: ["crm", "contacts", tenantId] });
    },
  });

  const deleteContact = useMutation({
    mutationFn: () => api.deleteContact(tenantId!, contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contacts", tenantId] }),
  });

  const addTag = useMutation({
    mutationFn: (tagId: number) => api.addContactTag(tenantId!, contactId, tagId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId, contactId] }),
  });

  const removeTag = useMutation({
    mutationFn: (tagId: number) => api.removeContactTag(tenantId!, contactId, tagId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId, contactId] }),
  });

  const updateCustomValues = useMutation({
    mutationFn: (values: { fieldId: number; value: string | null }[]) => api.setContactCustomValues(tenantId!, contactId, values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId, contactId] }),
  });

  const createNote = useMutation({
    mutationFn: (data: { content: string; conversationId?: number | null }) => api.createContactNote(tenantId!, contactId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId, contactId] }),
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: number) => api.deleteNote(tenantId!, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId, contactId] }),
  });

  return { query, updateContact, deleteContact, addTag, removeTag, updateCustomValues, createNote, deleteNote };
}

export function useDeals(params: { stageId?: number; assignedTo?: string; status?: string; from?: string; to?: string }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["crm", "deals", tenantId, params],
    queryFn: () => api.listDeals(tenantId!, params),
    enabled: !!tenantId,
  });

  const createDeal = useMutation({
    mutationFn: (data: { contactId: number; stageId: number; title: string; value?: number | null; assignedTo?: string | null; description?: string | null; expectedCloseAt?: string | null }) => api.createDeal(tenantId!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "deals", tenantId] });
      qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId] });
    },
  });

  const updateDeal = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ stageId: number; title: string; value: number | null; assignedTo: string | null; description: string | null; expectedCloseAt: string | null; status: "open" | "won" | "lost" }> }) => api.updateDeal(tenantId!, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "deals", tenantId] });
      qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId] });
    },
  });

  const deleteDeal = useMutation({
    mutationFn: (dealId: number) => api.deleteDeal(tenantId!, dealId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "deals", tenantId] });
      qc.invalidateQueries({ queryKey: ["crm", "contact", tenantId] });
    },
  });

  return { query, createDeal, updateDeal, deleteDeal };
}
