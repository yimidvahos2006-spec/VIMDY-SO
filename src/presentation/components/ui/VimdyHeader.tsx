import React from "react";
import {
  Bell,
  Search,
  BrainCircuit
} from "lucide-react";

import { VimdyLogo } from "./VimdyLogo";

export function VimdyHeader() {

  const now = new Date();

  return (

    <header className="flex items-center justify-between p-8">

      <div className="flex items-center gap-5">

        <VimdyLogo size={52} />

        <div>

          <h1 className="text-3xl font-black text-vimdy-text">

            VIMDY OS

          </h1>

          <p className="text-vimdy-blue">

            El futuro de los negocios comienza hoy

          </p>

        </div>

      </div>

      <div className="flex items-center gap-5">

        <div className="relative">

          <Search

            size={20}

            className="absolute left-4 top-1/2 -translate-y-1/2 text-vimdy-blue"

          />

          <input

            placeholder="Buscar..."

            className="w-80 rounded-2xl bg-vimdy-surface border border-vimdy-border py-3 pl-12 pr-4 text-vimdy-text outline-none focus:border-vimdy-blue transition"

          />

        </div>

        <button className="relative p-3 rounded-2xl bg-vimdy-surface border border-vimdy-border hover:border-vimdy-blue transition">

          <Bell

            size={22}

            className="text-vimdy-text"

          />

          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-vimdy-danger"></span>

        </button>

        <button className="flex items-center gap-3 rounded-2xl bg-vimdy-surface border border-vimdy-border px-5 py-3 hover:border-vimdy-blue transition">

          <BrainCircuit

            size={22}

            className="text-vimdy-blue"

          />

          <div className="text-left">

            <p className="text-vimdy-text font-bold">

              IA VIMDY

            </p>

            <p className="text-vimdy-blue text-xs">

              En línea

            </p>

          </div>

        </button>

      </div>

    </header>

  );

}