import React from "react";
import { VimdyAppLayout } from "./VimdyAppLayout";

interface Props {
  children: React.ReactNode;
}

export function MainLayout({ children }: Props) {
  return (
    <VimdyAppLayout>
      {children}
    </VimdyAppLayout>
  );
}

export default MainLayout;