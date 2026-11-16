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
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--foreground)_7%,transparent)_1px,transparent_0)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-sm rounded-2xl border bg-card p-7 [box-shadow:0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-24px_rgba(0,0,0,0.18)]"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-[16px] font-bold text-accent-foreground shadow-sm">A</div>
          <div>
            <div className="text-[16px] font-semibold tracking-tight">Afiliados</div>
            <div className="text-[12.5px] text-muted-foreground">Entre para gerenciar suas promoções</div>
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Senha do painel</span>
          <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </label>
        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <Button className="mt-5 w-full" loading={loading}>
          Entrar {!loading && <ArrowRight className="size-4" />}
        </Button>
      </motion.form>
    </div>
  );
}
