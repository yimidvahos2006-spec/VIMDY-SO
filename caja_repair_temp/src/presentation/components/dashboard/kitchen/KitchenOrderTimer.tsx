import React, { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";

interface Props {

  createdAt: Date;

  estimatedMinutes?: number;

  /** true en Modo TV: número de temporizador más grande, visible a distancia. */
  tvMode?: boolean;

}

export function KitchenOrderTimer({

  createdAt,

  estimatedMinutes = 15,

  tvMode = false

}: Props) {

  const [seconds, setSeconds] = useState(0);

  useEffect(() => {

    const interval = setInterval(() => {

      const elapsed = Math.floor(

        (Date.now() - new Date(createdAt).getTime()) / 1000

      );

      setSeconds(elapsed);

    }, 1000);

    return () => clearInterval(interval);

  }, [createdAt]);

  const minutes = Math.floor(seconds / 60);

  const remaining = seconds % 60;

  let color = "text-vimdy-success";

  if (minutes >= estimatedMinutes * 0.7) {

    color = "text-vimdy-warning";

  }

  if (minutes >= estimatedMinutes) {

    color = "text-vimdy-danger";

  }

  return (

    <div className="flex items-center gap-2">

      <Clock3

        size={tvMode ? 26 : 18}

        className={color}

      />

      <span className={`font-bold ${color} ${tvMode ? "text-2xl" : ""}`}>

        {minutes}m {remaining}s

      </span>

    </div>

  );

}