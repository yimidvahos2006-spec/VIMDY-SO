import React from 'react';

export const AiAvatar: React.FC = () => {
  return (
    <div className="relative flex items-center justify-center w-10 h-10 group select-none">
      {/* 1. Aura energética exterior con pulso suave */}
      <div className="absolute inset-0 rounded-full bg-cyan-500/20 blur-md animate-pulse"></div>

      {/* 2. Esfera principal con efecto Glassmorphism 3D */}
      <div className="relative w-8 h-8 rounded-full overflow-hidden shadow-2xl shadow-cyan-950/90 bg-gradient-to-br from-slate-950 via-black to-cyan-950 border border-cyan-400/40 backdrop-blur-md">

        {/* 3. Núcleo interno con movimiento fluido tipo shader */}
        <div className="absolute -inset-3 bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-950 rounded-full opacity-85 blur-[2.5px] animate-shader-spin"></div>

        {/* 4. Capa de refracción líquida secundaria */}
        <div className="absolute inset-0 bg-gradient-to-bl from-transparent via-cyan-400/25 to-blue-900/60 rounded-full mix-blend-screen animate-pulse"></div>

        {/* 5. Reflejo especular superior (Efecto brillo de cristal real) */}
        <div className="absolute top-1 left-1.5 w-2.5 h-1 bg-white/70 rounded-full blur-[0.4px] -rotate-45"></div>

        {/* 6. Reflejo secundario inferior para dar volumen */}
        <div className="absolute bottom-1 right-1.5 w-1.5 h-0.5 bg-cyan-300/40 rounded-full blur-[0.8px]"></div>
      </div>
    </div>
  );
};