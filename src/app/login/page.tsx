"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) window.location.href = "/";
    else setError("Senha incorreta");
  };

  return (
    <main className="bg-white dark:bg-gray-900">
      <div className="relative md:flex">
        {/* formulário, no estilo da tela de entrada do Mosaic */}
        <div className="md:w-1/2">
          <div className="flex min-h-dvh flex-col after:flex-1">
            <div className="flex-1">
              <div className="flex h-16 items-center px-4 sm:px-6 lg:px-8">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">A</span>
                <span className="ml-3 font-bold text-gray-800 dark:text-gray-100">2R PROMOS</span>
              </div>
            </div>
            <motion.form
              onSubmit={submit}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
              className="mx-auto w-full max-w-sm px-4 py-8"
            >
              <h1 className="mb-6 text-3xl font-bold text-gray-800 dark:text-gray-100">Bem-vindo de volta! ✨</h1>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Senha do painel</span>
                <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </label>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
              <div className="mt-6 flex items-center justify-between">
                <span className="text-sm text-gray-500">Promoções de perfume no WhatsApp</span>
                <Button variant="accent" loading={loading}>
                  Entrar {!loading && <ArrowRight className="size-4" />}
                </Button>
              </div>
            </motion.form>
          </div>
        </div>
        {/* lado decorativo */}
        <div className="absolute top-0 right-0 bottom-0 hidden md:block md:w-1/2" aria-hidden="true">
          <div className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,#b7acff_0,transparent_45%),radial-gradient(circle_at_80%_70%,#67bfff_0,transparent_40%),linear-gradient(135deg,#755ff8,#4634b1)]" />
        </div>
      </div>
    </main>
  );
}
