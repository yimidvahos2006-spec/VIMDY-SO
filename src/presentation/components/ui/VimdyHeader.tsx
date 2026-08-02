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

          <h1 className="text-3xl font-black text-[#F4FAFF]">

            VIMDY OS

          </h1>

          <p className="text-[#8FD7FF]">

            El futuro de los negocios comienza hoy

          </p>

        </div>

      </div>

      <div className="flex items-center gap-5">

        <div className="relative">

          <Search

            size={20}

            className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8FD7FF]"

          />

          <input

            placeholder="Buscar..."

            className="w-80 rounded-2xl bg-[#12384A] border border-[#2B5E78] py-3 pl-12 pr-4 text-[#F4FAFF] outline-none focus:border-[#8FD7FF] transition"

          />

        </div>

        <button className="relative p-3 rounded-2xl bg-[#12384A] border border-[#2B5E78] hover:border-[#8FD7FF] transition">

          <Bell

            size={22}

            className="text-[#F4FAFF]"

          />

          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500"></span>

        </button>

        <button className="flex items-center gap-3 rounded-2xl bg-[#12384A] border border-[#2B5E78] px-5 py-3 hover:border-[#8FD7FF] transition">

          <BrainCircuit

            size={22}

            className="text-[#8FD7FF]"

          />

          <div className="text-left">

            <p className="text-[#F4FAFF] font-bold">

              IA VIMDY

            </p>

            <p className="text-[#8FD7FF] text-xs">

              En línea

            </p>

          </div>

        </button>

      </div>

    </header>

  );

}