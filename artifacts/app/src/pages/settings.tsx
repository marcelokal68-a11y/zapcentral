import { useUser } from "@clerk/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sidebar } from "@/pages/dashboard";

export default function SettingsPage() {
  const { user } = useUser();

  return (
    <div className="min-h-[100dvh] bg-[#F4F7F8]">
      <Sidebar />
      
      <div className="ml-64 flex flex-col min-h-screen">
        <header className="h-16 bg-white shadow-sm flex items-center px-8 z-0">
          <h1 className="text-xl font-semibold text-gray-800">Configurações</h1>
        </header>

        <main className="flex-1 p-8 max-w-4xl">
          <div className="space-y-6">
            
            <Card>
              <CardHeader>
                <CardTitle>Meu Perfil</CardTitle>
                <CardDescription>Informações da sua conta de usuário.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-4">
                  <Avatar className="w-16 h-16 border-2 border-gray-100">
                    <AvatarImage src={user?.imageUrl} />
                    <AvatarFallback className="text-lg bg-gray-100 text-gray-700">
                      {user?.fullName?.substring(0, 2).toUpperCase() || "US"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-medium text-lg text-gray-900">{user?.fullName || "Usuário"}</h3>
                    <p className="text-gray-500">{user?.primaryEmailAddress?.emailAddress || "email@exemplo.com"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Plano Atual</CardTitle>
                <CardDescription>Gerencie sua assinatura e limites de uso.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50/50">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">Professional</h3>
                      <Badge className="bg-[#25D366] hover:bg-[#25D366]/90 border-none text-white">Ativo</Badge>
                    </div>
                    <p className="text-sm text-gray-500">50 agentes disponíveis • Faturamento mensal</p>
                  </div>
                  <button className="text-sm font-medium text-[#25D366] hover:underline">
                    Fazer Upgrade
                  </button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notificações</CardTitle>
                <CardDescription>Configure como e quando você deseja ser alertado.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-medium text-gray-900">Novas Mensagens</div>
                    <div className="text-sm text-gray-500">Notificar quando um cliente iniciar uma conversa.</div>
                  </div>
                  <Switch checked={true} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-medium text-gray-900">Sons de Alerta</div>
                    <div className="text-sm text-gray-500">Tocar um som curto para notificações de desktop.</div>
                  </div>
                  <Switch checked={false} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-medium text-gray-900">Relatório Diário</div>
                    <div className="text-sm text-gray-500">Receber um resumo por email no fim do dia.</div>
                  </div>
                  <Switch checked={true} />
                </div>
              </CardContent>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
}
