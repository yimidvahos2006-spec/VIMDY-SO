import React from "react";

interface Props {
  children: React.ReactNode;
}

export function VimdyBackground({ children }: Props) {

  return (

    <div className="relative min-h-screen overflow-hidden bg-[#070C14]">

      {/* Fondo principal */}

      <div className="absolute inset-0 vimdy-gradient" />

      {/* Luz superior */}

      <div
        className="absolute -top-64 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full blur-[220px] opacity-20 animate-vimdy-breath"
        style={{
          background: "#8FD7FF"
        }}
      />

      {/* Luz inferior derecha */}

      <div
        className="absolute -bottom-60 -right-48 w-[700px] h-[700px] rounded-full blur-[220px] opacity-10 animate-vimdy-breath"
        style={{
          background: "#2B5E78",
          animationDelay: "2s"
        }}
      />

      {/* Luz izquierda */}

      <div
        className="absolute top-1/3 -left-48 w-[500px] h-[500px] rounded-full blur-[180px] opacity-10 animate-vimdy-breath"
        style={{
          background: "#12384A",
          animationDelay: "4s"
        }}
      />

      {/* Neblina */}

      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: `
          radial-gradient(circle at 20% 20%, rgba(143,215,255,.15), transparent 30%),
          radial-gradient(circle at 80% 70%, rgba(43,94,120,.12), transparent 35%),
          radial-gradient(circle at 50% 100%, rgba(18,56,74,.18), transparent 40%)
          `
        }}
      />

      {/* Rejilla futurista */}

      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
          linear-gradient(rgba(255,255,255,.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.12) 1px, transparent 1px)
          `,
          backgroundSize: "70px 70px"
        }}
      />

      {/* Contenido */}

      <div className="relative z-10">

        {children}

      </div>

    </div>

  );

}