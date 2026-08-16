import { SignIn } from "@clerk/react";
import { MessageCircle } from "lucide-react";

export default function SignInPage() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#0F1923] to-[#1a2735]">
      <div className="mb-8 flex flex-col items-center">
        <div className="w-16 h-16 bg-[#25D366]/10 rounded-full flex items-center justify-center mb-4">
          <MessageCircle className="w-10 h-10 text-[#25D366]" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">ZapCentral</h1>
        <p className="text-[#8899A6] mt-2">Central Operacional Inteligente</p>
      </div>
      <SignIn />
    </div>
  );
}
