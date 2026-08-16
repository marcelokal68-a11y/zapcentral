/**
 * Chat page — main agent interface.
 * Left panel: conversation list. Right panel: message thread + input.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { initSocket, getSocket } from "@/lib/socket";
import { Send, Phone, X, ArrowRightLeft, Loader2, Wifi, WifiOff, ChevronDown, MessageCircle, PanelRightOpen, PanelRightClose } from "lucide-react";
import { Sidebar } from "./dashboard";
import { ContactPanel } from "@/components/ContactPanel";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  listConversations,
  listMessages,
  sendMessage,
  pickConversation,
  closeConversation,
  updateMyStatus,
  getMyStatus,
  type Conversation,
  type Message,
} from "@/lib/api";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCpf } from "@/lib/cpf";

const STATUS_LABELS: Record<string, string> = {
  new: "Novo",
  ivr: "URA",
  waiting: "Na Fila",
  active: "Ativo",
  closed: "Fechado",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  ivr: "bg-purple-100 text-purple-700",
  waiting: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-600",
};

const AGENT_STATUS_COLORS: Record<string, string> = {
  available: "bg-green-500",
  busy: "bg-amber-500",
  away: "bg-yellow-400",
  offline: "bg-gray-400",
};

const AGENT_STATUS_LABELS: Record<string, string> = {
  available: "Disponível",
  busy: "Ocupado",
  away: "Ausente",
  offline: "Offline",
};

function formatTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "Agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function ConversationItem({
  conv,
  active,
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const initials = conv.contact.name
    ? conv.contact.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : conv.contact.phone.slice(-2);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-white/5",
        active && "bg-[#25D366]/10",
      )}
    >
      <Avatar className="h-10 w-10 shrink-0 mt-0.5">
        <AvatarFallback className="bg-[#1A2B38] text-[#25D366] font-semibold text-sm">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-white text-sm truncate">
            {conv.contact.name ?? conv.contact.phone}
          </span>
          <span className="text-xs text-[#8899A6] shrink-0">
            {formatTime(conv.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge
            className={cn(
              "text-[10px] px-1.5 py-0 border-none rounded",
              STATUS_COLORS[conv.status],
            )}
          >
            {STATUS_LABELS[conv.status]}
          </Badge>
          {conv.departmentName && (
            <span className="text-xs text-[#8899A6] truncate">
              {conv.departmentName}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "outbound";
  return (
    <div className={cn("flex mb-3", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-xl px-4 py-2.5 shadow-sm",
          isOut
            ? "bg-[#25D366] text-white rounded-br-sm"
            : "bg-white text-gray-900 rounded-bl-sm",
        )}
      >
        {msg.type === "image" && msg.mediaUrl && (
          <img
            src={msg.mediaUrl}
            alt={msg.mediaCaption ?? "imagem"}
            className="rounded-lg mb-1 max-w-full"
          />
        )}
        {msg.type === "audio" && (
          <div className="flex items-center gap-2 text-sm opacity-80 py-1">
            <span>🎵</span>
            <span>Mensagem de áudio</span>
          </div>
        )}
        {msg.type === "document" && (
          <div className="flex items-center gap-2 text-sm opacity-80 py-1">
            <span>📄</span>
            <span>{msg.content ?? "Documento"}</span>
          </div>
        )}
        {msg.type === "video" && (
          <div className="flex items-center gap-2 text-sm opacity-80 py-1">
            <span>🎥</span>
            <span>Vídeo{msg.mediaCaption ? `: ${msg.mediaCaption}` : ""}</span>
          </div>
        )}
        {msg.content && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        )}
        {msg.mediaCaption && msg.type === "image" && (
          <p className="text-xs mt-1 opacity-80">{msg.mediaCaption}</p>
        )}
        <span
          className={cn(
            "text-[10px] mt-1 block text-right opacity-60",
          )}
        >
          {new Date(msg.timestamp).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {isOut && msg.status === "read" && " ✓✓"}
          {isOut && msg.status === "delivered" && " ✓✓"}
          {isOut && msg.status === "sent" && " ✓"}
        </span>
      </div>
    </div>
  );
}

type FilterTab = "all" | "mine" | "queue";

export default function ChatPage() {
  const tenantId = useTenantId();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inputText, setInputText] = useState("");
  const [agentStatus, setAgentStatus] = useState<"available" | "busy" | "away" | "offline">("offline");
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);

  // Load agent status
  const { data: myStatus } = useQuery({
    queryKey: ["agent-status-me", tenantId],
    queryFn: () => (tenantId ? getMyStatus(tenantId) : null),
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (myStatus?.status) setAgentStatus(myStatus.status);
  }, [myStatus]);

  // Load conversations
  const statusFilter =
    activeTab === "queue" ? "waiting" : activeTab === "mine" ? "active" : undefined;

  const { data: convData, isLoading: convsLoading } = useQuery({
    queryKey: ["conversations", tenantId, statusFilter],
    queryFn: () => (tenantId ? listConversations(tenantId, { status: statusFilter }) : null),
    enabled: !!tenantId,
    refetchInterval: 10_000,
  });

  const conversations = convData?.conversations ?? [];

  // Load messages for selected conversation
  const { data: messages, isLoading: msgsLoading } = useQuery({
    queryKey: ["messages", tenantId, selectedId],
    queryFn: () =>
      tenantId && selectedId ? listMessages(tenantId, selectedId) : [],
    enabled: !!tenantId && !!selectedId,
    refetchInterval: 5_000,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Socket.io — authenticated with Clerk session token
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    getToken().then((token) => {
      if (cancelled) return;
      const socket = initSocket(token);

      socket.on("connect", () => setIsConnected(true));
      socket.on("disconnect", () => setIsConnected(false));

      // Server verifies tenant membership on join_tenant; join_agent uses server-derived userId
      socket.emit("join_tenant", tenantId);
      socket.emit("join_agent");

      socket.on("new_message", (data: { conversationId: number }) => {
        void qc.invalidateQueries({ queryKey: ["messages", tenantId, data.conversationId] });
        void qc.invalidateQueries({ queryKey: ["conversations", tenantId] });
      });
      socket.on("conversation_updated", () => {
        void qc.invalidateQueries({ queryKey: ["conversations", tenantId] });
      });
      socket.on("conversation_assigned", (data: { conversation: { id: number } }) => {
        void qc.invalidateQueries({ queryKey: ["conversations", tenantId] });
        toast({ title: "Nova conversa atribuída", description: `Conversa #${data.conversation.id}` });
      });

      setIsConnected(socket.connected);
    });

    return () => {
      cancelled = true;
      const socket = getSocket();
      if (socket) {
        socket.off("connect");
        socket.off("disconnect");
        socket.off("new_message");
        socket.off("conversation_updated");
        socket.off("conversation_assigned");
      }
    };
  }, [tenantId, getToken, qc, toast]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: () =>
      sendMessage(tenantId!, selectedId!, { type: "text", content: inputText }),
    onSuccess: (msg) => {
      setInputText("");
      qc.setQueryData(
        ["messages", tenantId, selectedId],
        (old: Message[] = []) => [...old, msg],
      );
    },
    onError: () => {
      toast({ title: "Erro ao enviar mensagem", variant: "destructive" });
    },
  });

  // Pick conversation mutation
  const pickMutation = useMutation({
    mutationFn: (convId: number) => pickConversation(tenantId!, convId),
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["conversations", tenantId] });
      setSelectedId(conv.id);
      setActiveTab("mine");
    },
    onError: () => toast({ title: "Erro ao pegar conversa", variant: "destructive" }),
  });

  // Close conversation
  const closeMutation = useMutation({
    mutationFn: () => closeConversation(tenantId!, selectedId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations", tenantId] });
      setSelectedId(null);
      toast({ title: "Conversa encerrada" });
    },
    onError: () => toast({ title: "Erro ao fechar conversa", variant: "destructive" }),
  });

  // Update agent status
  const statusMutation = useMutation({
    mutationFn: (status: typeof agentStatus) =>
      updateMyStatus(tenantId!, { status }),
    onSuccess: (data) => setAgentStatus(data.status),
  });

  const selectedConv = conversations.find((c) => c.id === selectedId);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !selectedId || !tenantId) return;
    sendMutation.mutate();
  }, [inputText, selectedId, tenantId, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-[100dvh] bg-[#0F1923]">
      <Sidebar />

      {/* Conversation list */}
      <div className="ml-64 flex flex-col w-80 shrink-0 border-r border-white/5 h-full">
        {/* Agent status bar */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-white/5 bg-[#0A1520]">
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="flex items-center gap-2 text-sm text-white/80 hover:text-white"
            >
              <span
                className={cn(
                  "w-2.5 h-2.5 rounded-full",
                  AGENT_STATUS_COLORS[agentStatus],
                )}
              />
              {AGENT_STATUS_LABELS[agentStatus]}
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            {showStatusMenu && (
              <div className="absolute top-8 left-0 bg-[#1A2B38] border border-white/10 rounded-lg shadow-xl z-50 py-1 w-40">
                {(["available", "busy", "away", "offline"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      statusMutation.mutate(s);
                      setShowStatusMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-white/5"
                  >
                    <span className={cn("w-2 h-2 rounded-full", AGENT_STATUS_COLORS[s])} />
                    {AGENT_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isConnected ? (
            <Wifi className="w-3.5 h-3.5 text-[#25D366]" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-400" />
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5">
          {(["all", "mine", "queue"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex-1 py-2.5 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "text-[#25D366] border-b-2 border-[#25D366]"
                  : "text-[#8899A6] hover:text-white",
              )}
            >
              {tab === "all" ? "Todos" : tab === "mine" ? "Minhas" : "Fila"}
            </button>
          ))}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-[#25D366] animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-[#8899A6] text-sm gap-2">
              <MessageCircle className="w-6 h-6" />
              <span>Nenhuma conversa</span>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                active={conv.id === selectedId}
                onClick={() => setSelectedId(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {!selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[#8899A6] gap-3">
            <MessageCircle className="w-12 h-12 opacity-30" />
            <span className="text-sm">Selecione uma conversa</span>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="h-14 bg-[#0A1520] border-b border-white/5 flex items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-[#1A2B38] text-[#25D366] font-semibold text-xs">
                    {(selectedConv.contact.name ?? selectedConv.contact.phone)
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {selectedConv.contact.name ?? selectedConv.contact.phone}
                  </p>
                  <p className="text-xs text-[#8899A6]">
                    {selectedConv.contact.phone}
                    {selectedConv.contact.cpf && ` · CPF: ${formatCpf(selectedConv.contact.cpf)}`}
                    {selectedConv.departmentName && ` · ${selectedConv.departmentName}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge className={cn("text-xs border-none", STATUS_COLORS[selectedConv.status])}>
                  {STATUS_LABELS[selectedConv.status]}
                </Badge>

                <button
                  onClick={() => setShowContactPanel((v) => !v)}
                  className="text-[#8899A6] hover:text-white p-1.5 rounded-md hover:bg-white/5 transition-colors"
                  title={showContactPanel ? "Ocultar dados do contato" : "Mostrar dados do contato"}
                >
                  {showContactPanel ? (
                    <PanelRightClose className="w-4 h-4" />
                  ) : (
                    <PanelRightOpen className="w-4 h-4" />
                  )}
                </button>

                {selectedConv.status === "waiting" && (
                  <button
                    onClick={() => pickMutation.mutate(selectedConv.id)}
                    disabled={pickMutation.isPending}
                    className="text-xs bg-[#25D366] hover:bg-[#1ebe57] text-white px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
                  >
                    {pickMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Phone className="w-3 h-3" />
                    )}
                    Pegar
                  </button>
                )}

                {["active", "waiting"].includes(selectedConv.status) && (
                  <button
                    onClick={() => closeMutation.mutate()}
                    disabled={closeMutation.isPending}
                    className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
                  >
                    <X className="w-3 h-3" />
                    Fechar
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 bg-[#111E28]">
              {msgsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 text-[#25D366] animate-spin" />
                </div>
              ) : (messages ?? []).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-[#8899A6] text-sm gap-2">
                  <MessageCircle className="w-6 h-6 opacity-40" />
                  <span>Nenhuma mensagem ainda</span>
                </div>
              ) : (
                (messages ?? []).map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {selectedConv.status === "active" && (
              <div className="bg-[#0A1520] border-t border-white/5 px-4 py-3 flex items-end gap-3">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite uma mensagem... (Enter para enviar)"
                  rows={1}
                  className="flex-1 bg-[#1A2B38] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#8899A6] resize-none focus:outline-none focus:border-[#25D366]/50 transition-colors min-h-[40px] max-h-32"
                  style={{ resize: "none" }}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || sendMutation.isPending}
                  className="bg-[#25D366] hover:bg-[#1ebe57] disabled:opacity-40 text-white p-2.5 rounded-xl transition-colors shrink-0"
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}

            {selectedConv.status !== "active" && (
              <div className="bg-[#0A1520] border-t border-white/5 px-6 py-3 text-xs text-[#8899A6] text-center">
                {selectedConv.status === "waiting"
                  ? "Pegue a conversa para começar a atender"
                  : selectedConv.status === "closed"
                  ? "Conversa encerrada"
                  : "Aguardando o cliente passar pelo IVR"}
              </div>
            )}
          </>
        )}
      </div>

      {/* Contact context panel */}
      {selectedConv && showContactPanel && tenantId && (
        <ContactPanel
          tenantId={tenantId}
          contactId={selectedConv.contactId}
          conversationId={selectedConv.id}
        />
      )}
    </div>
  );
}
