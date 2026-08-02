import React from "react";

interface Props {
  size?: number;
}

export function VimdyLogo({ size = 80 }: Props) {

  return (

    <div
      className="relative flex items-center justify-center animate-vimdy-float"
      style={{
        width: size,
        height: size
      }}
    >

      {/* Halo */}

      <div
        className="absolute inset-0 rounded-full blur-[45px] opacity-60 animate-vimdy-breath"
        style={{
          background:
            "radial-gradient(circle,#8FD7FF 0%,#2B5E78 45%,transparent 80%)"
        }}
      />

      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
      >

        <defs>

          <linearGradient
            id="vimdyFlow"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >

            <stop offset="0%">

              <animate
                attributeName="stop-color"
                values="#8FD7FF;#D9F6FF;#2B5E78;#8FD7FF"
                dur="4s"
                repeatCount="indefinite"
              />

            </stop>

            <stop offset="50%">

              <animate
                attributeName="stop-color"
                values="#2B5E78;#8FD7FF;#D9F6FF;#2B5E78"
                dur="4s"
                repeatCount="indefinite"
              />

            </stop>

            <stop offset="100%">

              <animate
                attributeName="stop-color"
                values="#12384A;#8FD7FF;#2B5E78;#12384A"
                dur="4s"
                repeatCount="indefinite"
              />

            </stop>

          </linearGradient>

          <filter id="glow">

            <feGaussianBlur stdDeviation="8" result="coloredBlur"/>

            <feMerge>

              <feMergeNode in="coloredBlur"/>

              <feMergeNode in="SourceGraphic"/>

            </feMerge>

          </filter>

        </defs>

        <path

          d="M80 70L256 430L432 70"

          stroke="url(#vimdyFlow)"

          strokeWidth="42"

          strokeLinecap="round"

          strokeLinejoin="round"

          filter="url(#glow)"

        >

          <animate
            attributeName="stroke-dasharray"
            values="0 900;450 450;900 0;0 900"
            dur="7s"
            repeatCount="indefinite"
          />

          <animate
            attributeName="stroke-dashoffset"
            values="0;-900"
            dur="7s"
            repeatCount="indefinite"
          />

        </path>

      </svg>

      {/* Reflejo */}

      <div
        className="absolute w-3 h-3 rounded-full bg-white blur-sm animate-ping"
        style={{
          top: "18%",
          left: "60%"
        }}
      />

      <div
        className="absolute w-2 h-2 rounded-full bg-cyan-300 blur-sm animate-pulse"
        style={{
          bottom: "18%",
          right: "25%"
        }}
      />

    </div>

  );

}